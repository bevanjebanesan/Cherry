const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
require('dotenv').config();

// Import MongoDB connection and models
const connectDB = require('./db/mongoose');
const Meeting = require('./models/Meeting');
const User = require('./models/User');

const app = express();
app.use(cors({
  origin: process.env.FRONTEND_URL 
    ? [process.env.FRONTEND_URL, process.env.FRONTEND_URL.replace(/\/$/, '')]
    : [
      'http://localhost:3000',
      'https://cherry-coral.vercel.app',
      'https://cherry-coral.vercel.app/'
    ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true
}));
app.use(express.json());

const server = http.createServer(app);

const allowedOrigins = process.env.FRONTEND_URL 
  ? [process.env.FRONTEND_URL, process.env.FRONTEND_URL.replace(/\/$/, '')]
  : [
    'http://localhost:3000',
    'https://cherry-coral.vercel.app',
    'https://cherry-coral.vercel.app/'
  ];

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true
  },
});

// In-memory storage for meetings
const meetings = {};
const users = {};

// Socket.io event handlers
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  
  // Join a meeting room
  socket.on('join-room', async (meetingId, userId, userName) => {
    console.log(`User ${userName} (${userId}) joining meeting ${meetingId}`);
    
    try {
      // Create a guest user in MongoDB
      const guestUser = new User({
        name: userName,
        email: `guest-${uuidv4()}@cherry.app`,
        password: uuidv4(),
        isGuest: true
      });
      
      // Save the guest user to MongoDB
      const savedUser = await guestUser.save();
      
      // Try to find the meeting in MongoDB
      let meeting = await Meeting.findOne({ meetingId });
      
      if (meeting) {
        // Add the user to the meeting participants
        meeting.participants.push(savedUser._id);
        await meeting.save();
        console.log(`Added ${userName} to MongoDB meeting ${meetingId}`);
      }
      
      // Also update in-memory data for backward compatibility
      if (!meetings[meetingId]) {
        meetings[meetingId] = {
          id: meetingId,
          participants: {},
          messages: [],
        };
      }
      
      // Add the participant to the in-memory meeting
      meetings[meetingId].participants[socket.id] = {
        id: socket.id,
        userName,
        mongoUserId: savedUser._id
      };
      
      // Store user info
      users[socket.id] = {
        userId: socket.id,
        userName: userName,
        meetingId: meetingId
      };
      
      // Join the socket room
      socket.join(meetingId);
      socket.meetingId = meetingId;
      socket.userName = userName;
      
      // Get all users in this room
      const usersInThisRoom = [];
      for (let id in meetings[meetingId].participants) {
        if (id !== socket.id) {
          usersInThisRoom.push({
            id,
            userName: meetings[meetingId].participants[id].userName
          });
        }
      }
      
      // Send the list of existing users to the new user
      socket.emit('get-users', usersInThisRoom);
      
      // Notify others that a new user has connected
      socket.to(meetingId).emit('user-connected', socket.id, userName);
      
      console.log(`User ${userName} joined meeting ${meetingId}`);
    } catch (error) {
      console.error('Error joining meeting:', error);
      
      // Fallback to in-memory only if MongoDB fails
      if (!meetings[meetingId]) {
        meetings[meetingId] = {
          id: meetingId,
          participants: {},
          messages: [],
        };
      }
      
      // Add the participant to the in-memory meeting
      meetings[meetingId].participants[socket.id] = {
        id: socket.id,
        userName,
      };
      
      // Store user info
      users[socket.id] = {
        userId: socket.id,
        userName: userName,
        meetingId: meetingId
      };
      
      // Join the socket room
      socket.join(meetingId);
      socket.meetingId = meetingId;
      socket.userName = userName;
      
      // Get all users in this room
      const usersInThisRoom = [];
      for (let id in meetings[meetingId].participants) {
        if (id !== socket.id) {
          usersInThisRoom.push({
            id,
            userName: meetings[meetingId].participants[id].userName
          });
        }
      }
      
      // Send the list of existing users to the new user
      socket.emit('get-users', usersInThisRoom);
      
      // Notify others that a new user has connected
      socket.to(meetingId).emit('user-connected', socket.id, userName);
      
      console.log(`Fallback: User ${userName} joined meeting ${meetingId} (in-memory only)`);
    }
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
  
  socket.on('disconnect', async () => {
    console.log(`User disconnected: ${socket.id}`);
    
    if (socket.meetingId) {
      const meetingId = socket.meetingId;
      const userName = socket.userName;
      
      try {
        // Update MongoDB if possible
        if (meetings[meetingId]?.participants[socket.id]?.mongoUserId) {
          const userId = meetings[meetingId].participants[socket.id].mongoUserId;
          const meeting = await Meeting.findOne({ meetingId });
          
          if (meeting) {
            // Remove the user from the meeting participants
            meeting.participants = meeting.participants.filter(
              participant => participant.toString() !== userId.toString()
            );
            await meeting.save();
            console.log(`Removed ${userName} from MongoDB meeting ${meetingId}`);
          }
        }
        
        // Remove from in-memory storage
        if (meetings[meetingId] && meetings[meetingId].participants[socket.id]) {
          delete meetings[meetingId].participants[socket.id];
          console.log(`Removed ${userName} from in-memory meeting ${meetingId}`);
          
          // Notify others that the user has disconnected
          socket.to(meetingId).emit('user-disconnected', socket.id);
        }
      } catch (error) {
        console.error('Error handling disconnect:', error);
        
        // Fallback to in-memory only
        if (meetings[meetingId] && meetings[meetingId].participants[socket.id]) {
          delete meetings[meetingId].participants[socket.id];
          console.log(`Fallback: Removed ${userName} from in-memory meeting ${meetingId}`);
          
          // Notify others that the user has disconnected
          socket.to(meetingId).emit('user-disconnected', socket.id);
        }
      }
    }
  });
});

// Test endpoint to verify API connectivity
app.get('/api/test', (req, res) => {
  console.log('Test endpoint called');
  res.header('Access-Control-Allow-Origin', '*');
  res.json({ message: 'Backend API is working!' });
});

// API routes
app.post('/api/meetings/create', async (req, res) => {
  console.log('Received request to create meeting');
  console.log('Request headers:', req.headers);
  
  try {
    const meetingId = uuidv4();
    
    // Create a guest user for the host (since we don't have authentication yet)
    const guestUser = new User({
      name: 'Guest Host',
      email: `guest-${uuidv4()}@cherry.app`,
      password: uuidv4(),
      isGuest: true
    });
    
    // Save the guest user to MongoDB
    const savedUser = await guestUser.save();
    
    // Create a new meeting in MongoDB
    const meeting = new Meeting({
      meetingId: meetingId,
      host: savedUser._id,
      participants: [savedUser._id],
      startTime: new Date(),
      isActive: true
    });
    
    // Save the meeting to MongoDB
    await meeting.save();
    
    console.log(`Created new meeting in MongoDB: ${meetingId}`);
    
    // Also keep in memory for backward compatibility
    meetings[meetingId] = {
      id: meetingId,
      participants: {},
      messages: [],
    };
    
    // Set CORS headers explicitly for this route
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    res.json({ meetingId });
  } catch (error) {
    console.error('Error creating meeting:', error);
    
    // Fallback to in-memory if MongoDB fails
    const meetingId = uuidv4();
    meetings[meetingId] = {
      id: meetingId,
      participants: {},
      messages: [],
    };
    console.log(`Fallback: Created new meeting in memory: ${meetingId}`);
    
    res.json({ meetingId });
  }
});

app.get('/api/meetings/:meetingId', async (req, res) => {
  const { meetingId } = req.params;
  
  try {
    // Try to find the meeting in MongoDB
    const meeting = await Meeting.findOne({ meetingId }).populate('host participants');
    
    if (meeting) {
      console.log(`Found meeting in MongoDB: ${meetingId}`);
      return res.json({
        id: meeting.meetingId,
        host: meeting.host,
        participants: meeting.participants,
        startTime: meeting.startTime,
        isActive: meeting.isActive
      });
    }
    
    // Fallback to in-memory if not found in MongoDB
    if (meetings[meetingId]) {
      console.log(`Found meeting in memory: ${meetingId}`);
      return res.json(meetings[meetingId]);
    }
    
    console.log(`Meeting not found: ${meetingId}`);
    return res.status(404).json({ error: 'Meeting not found' });
  } catch (error) {
    console.error('Error retrieving meeting:', error);
    
    // Fallback to in-memory if MongoDB fails
    if (meetings[meetingId]) {
      console.log(`Fallback: Found meeting in memory: ${meetingId}`);
      return res.json(meetings[meetingId]);
    }
    
    return res.status(404).json({ error: 'Meeting not found' });
  }
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  
  // Connect to MongoDB
  await connectDB();
});
