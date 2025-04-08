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
const users = [];

// Socket.io event handlers
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  
  // Join a meeting room
  socket.on('join-room', async (meetingId, userId, userName) => {
    console.log(`User ${userName} (${socket.id}) joining meeting ${meetingId}`);
    
    // Store socket meeting info for disconnect handling
    socket.meetingId = meetingId;
    socket.userName = userName;
    
    try {
      // Check if this user is already in the meeting (reconnection case)
      const existingUserIndex = users.findIndex(u => u.userId === socket.id);
      if (existingUserIndex !== -1) {
        console.log(`User ${userName} (${socket.id}) is reconnecting to meeting ${meetingId}`);
        // Update the existing user entry
        users[existingUserIndex].meetingId = meetingId;
        users[existingUserIndex].userName = userName;
      } else {
        // Add new user to the users array
        users.push({
          userId: socket.id,
          userName: userName,
          meetingId: meetingId
        });
        console.log(`Added new user ${userName} (${socket.id}) to users array`);
      }
      
      // Join the socket room
      socket.join(meetingId);
      
      // Create or update meeting in memory
      if (!meetings[meetingId]) {
        meetings[meetingId] = {
          meetingId,
          participants: [],
          messages: [],
          createdAt: new Date()
        };
      }
      
      // Check if user is already in the participants list
      const participantExists = meetings[meetingId].participants.some(p => p.userId === socket.id);
      
      if (!participantExists) {
        // Add user to meeting participants
        meetings[meetingId].participants.push({
          userId: socket.id,
          userName: userName,
          joinedAt: new Date()
        });
      }
      
      // Get all users in this meeting
      const usersInThisRoom = users.filter(user => user.meetingId === meetingId);
      
      // Emit to the client who just joined
      socket.emit('get-users', usersInThisRoom);
      
      // Notify other clients in the room
      socket.to(meetingId).emit('user-connected', socket.id, userName);
      
      console.log(`User ${userName} joined meeting ${meetingId} successfully`);
    } catch (error) {
      console.error('Error joining room:', error);
      
      // Fallback to in-memory only
      socket.join(meetingId);
      
      // Add user to users array if not already there
      if (!users.some(u => u.userId === socket.id)) {
        users.push({
          userId: socket.id,
          userName: userName,
          meetingId: meetingId
        });
      }
      
      // Create meeting if it doesn't exist
      if (!meetings[meetingId]) {
        meetings[meetingId] = {
          meetingId,
          participants: [],
          messages: [],
          createdAt: new Date()
        };
      }
      
      // Add user to meeting participants if not already there
      if (!meetings[meetingId].participants.some(p => p.userId === socket.id)) {
        meetings[meetingId].participants.push({
          userId: socket.id,
          userName: userName,
          joinedAt: new Date()
        });
      }
      
      // Get all users in this room
      const usersInThisRoom = users.filter(user => user.meetingId === meetingId);
      
      // Emit to the client who just joined
      socket.emit('get-users', usersInThisRoom);
      
      // Notify other clients in the room
      socket.to(meetingId).emit('user-connected', socket.id, userName);
      
      console.log(`Fallback: User ${userName} joined meeting ${meetingId} (in-memory only)`);
    }
  });
  
  // Handle sending signals between peers
  socket.on('sending-signal', (payload) => {
    const { userToSignal, callerID, signal, userName } = payload;
    console.log(`User ${callerID} (${userName}) is sending signal to ${userToSignal}`);
    
    // Find the user to signal
    const user = users.find(user => user.userId === userToSignal);
    
    if (user) {
      io.to(userToSignal).emit('user-joined', { 
        signal, 
        callerID, 
        userName 
      });
      console.log(`Signal sent to ${userToSignal} successfully`);
    } else {
      console.warn(`Cannot send signal to ${userToSignal} - user not found`);
    }
  });

  // Handle returning signals between peers
  socket.on('returning-signal', (payload) => {
    const { signal, callerID } = payload;
    console.log(`User ${socket.id} is returning signal to ${callerID}`);
    
    // Find the caller
    const caller = users.find(user => user.userId === callerID);
    
    if (caller) {
      io.to(callerID).emit('receiving-returned-signal', { 
        signal, 
        id: socket.id 
      });
      console.log(`Return signal sent to ${callerID} successfully`);
    } else {
      console.warn(`Cannot return signal to ${callerID} - user not found`);
    }
  });
  
  socket.on('send-message', ({ meetingId, message }) => {
    console.log(`Message in room ${meetingId} from ${message.senderName || 'Anonymous'}: ${message.content}`);
    
    // Ensure the message has a proper timestamp if it doesn't already
    if (!message.timestamp) {
      message.timestamp = new Date();
    }
    
    // Broadcast the message to all clients in the room
    io.in(meetingId).emit('receive-message', message);
    
    // Store message in meeting history
    if (meetings[meetingId]) {
      meetings[meetingId].messages.push(message);
    }
  });
  
  socket.on('send-transcription', ({ meetingId, text }) => {
    const user = users.find(user => user.userId === socket.id);
    if (user && meetings[meetingId]) {
      console.log(`Transcription in room ${meetingId} from ${user.userName}: ${text}`);
      io.to(meetingId).emit('receive-transcription', { 
        userId: user.userId, 
        text, 
        userName: user.userName 
      });
    }
  });
  
  // Handle user disconnection
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    // Find the user
    const userIndex = users.findIndex(user => user.userId === socket.id);
    
    if (userIndex !== -1) {
      const user = users[userIndex];
      const meetingId = user.meetingId;
      
      console.log(`User ${user.userName} (${socket.id}) disconnected from meeting ${meetingId}`);
      
      // Remove user from the users array
      users.splice(userIndex, 1);
      
      // Notify other users in the meeting
      socket.to(meetingId).emit('user-disconnected', socket.id);
      
      // Update meeting participants if the meeting exists
      if (meetings[meetingId]) {
        // Remove user from participants
        const participantIndex = meetings[meetingId].participants.findIndex(p => p.userId === socket.id);
        if (participantIndex !== -1) {
          meetings[meetingId].participants.splice(participantIndex, 1);
          console.log(`Removed user ${socket.id} from meeting ${meetingId} participants`);
        }
        
        // If no participants left, consider cleaning up the meeting
        if (meetings[meetingId].participants.length === 0) {
          console.log(`Meeting ${meetingId} has no participants left, marking for cleanup`);
          // You could delete the meeting here or mark it for cleanup
          // For now, we'll keep it for history
        }
      }
    } else {
      console.log(`User ${socket.id} disconnected but was not found in users array`);
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
