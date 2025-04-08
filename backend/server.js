const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://cherry-video-chat.vercel.app', 
    'https://cherry-git-main-bevanjebanesan.vercel.app',
    'https://cherry-bevanjebanesan.vercel.app',
    'https://cherry.vercel.app'
  ],
  methods: ['GET', 'POST'],
  credentials: true
}));
app.use(express.json());

const server = createServer(app);

const allowedOrigins = [
  'http://localhost:3000',
  'https://cherry-video-chat.vercel.app', 
  'https://cherry-git-main-bevanjebanesan.vercel.app',
  'https://cherry-bevanjebanesan.vercel.app',
  'https://cherry.vercel.app'
];

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  },
});

// In-memory storage for meetings
const meetings = {};
const users = {};

// Socket.io event handlers
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  
  socket.on('join-room', (meetingId, userId, userName) => {
    console.log(`User ${userId} (${userName || 'Anonymous'}) joining room ${meetingId}`);
    
    // Leave any previous rooms
    if (users[socket.id]) {
      const prevRoom = users[socket.id].meetingId;
      socket.leave(prevRoom);
      console.log(`User ${userId} left room ${prevRoom}`);
    }
    
    // Join the new room
    socket.join(meetingId);
    users[socket.id] = { userId, meetingId, userName: userName || 'Anonymous' };
    
    // Initialize meeting if it doesn't exist
    if (!meetings[meetingId]) {
      meetings[meetingId] = {
        id: meetingId,
        participants: {},
        messages: [],
      };
    }
    
    // Add user to meeting participants
    meetings[meetingId].participants[userId] = { 
      id: userId, 
      userName: userName || 'Anonymous' 
    };
    
    // Send list of existing users in the room to the new user
    const existingUsers = Object.values(meetings[meetingId].participants);
    socket.emit('get-users', existingUsers);
    console.log(`Sent existing users to ${userId}:`, existingUsers);
    
    // Notify other users in the room
    socket.to(meetingId).emit('user-connected', userId, userName);
    console.log(`Notified room ${meetingId} about new user ${userId} (${userName || 'Anonymous'})`);
  });
  
  socket.on('sending-signal', (payload) => {
    const { userToSignal, callerID, signal, userName } = payload;
    console.log(`User ${callerID} sending signal to ${userToSignal}`);
    io.to(userToSignal).emit('user-joined', { signal, callerID, userName });
  });
  
  socket.on('returning-signal', (payload) => {
    const { signal, callerID } = payload;
    console.log(`User ${socket.id} returning signal to ${callerID}`);
    io.to(callerID).emit('receiving-returned-signal', { signal, id: socket.id });
  });
  
  socket.on('send-message', ({ meetingId, message }) => {
    console.log(`Message in room ${meetingId} from ${message.senderName || 'Anonymous'}: ${message.content}`);
    
    // Ensure the message has a proper timestamp if it doesn't already
    if (!message.timestamp) {
      message.timestamp = new Date();
    }
    
    // Broadcast to ALL clients in the room (including sender for consistency)
    io.to(meetingId).emit('receive-message', message);
    
    // Store message in meeting history
    if (meetings[meetingId]) {
      meetings[meetingId].messages.push(message);
    }
  });
  
  socket.on('send-transcription', ({ meetingId, text }) => {
    const user = users[socket.id];
    if (user && meetings[meetingId]) {
      console.log(`Transcription in room ${meetingId} from ${user.userName}: ${text}`);
      io.to(meetingId).emit('receive-transcription', { 
        userId: user.userId, 
        text, 
        userName: user.userName 
      });
    }
  });
  
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    const user = users[socket.id];
    
    if (user) {
      const { meetingId, userId } = user;
      
      // Remove user from meeting participants
      if (meetings[meetingId] && meetings[meetingId].participants[userId]) {
        delete meetings[meetingId].participants[userId];
        
        // If no participants left, clean up the meeting
        if (Object.keys(meetings[meetingId].participants).length === 0) {
          delete meetings[meetingId];
          console.log(`Meeting ${meetingId} removed as it has no participants`);
        }
      }
      
      // Notify other users in the room
      socket.to(meetingId).emit('user-disconnected', userId);
      console.log(`Notified room ${meetingId} about user ${userId} disconnection`);
      
      // Remove user from users object
      delete users[socket.id];
    }
  });
});

// API routes
app.post('/api/meetings/create', (req, res) => {
  const meetingId = uuidv4();
  meetings[meetingId] = {
    id: meetingId,
    participants: {},
    messages: [],
  };
  console.log(`Created new meeting: ${meetingId}`);
  res.json({ meetingId });
});

app.get('/api/meetings/:meetingId', (req, res) => {
  const { meetingId } = req.params;
  const meeting = meetings[meetingId];
  
  if (!meeting) {
    return res.status(404).json({ error: 'Meeting not found' });
  }
  
  res.json({ 
    meetingId, 
    participantCount: Object.keys(meeting.participants).length,
    participants: Object.values(meeting.participants).map(p => ({ id: p.id, name: p.userName }))
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
