const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
require("dotenv").config();

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
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL 
      ? [process.env.FRONTEND_URL, process.env.FRONTEND_URL.replace(/\/$/, '')]
      : [
        'http://localhost:3000',
        'https://cherry-coral.vercel.app',
        'https://cherry-coral.vercel.app/'
      ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true
  },
  // Improved WebSocket configuration
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
  connectTimeout: 30000,
  allowUpgrades: true,
  upgradeTimeout: 10000,
  maxHttpBufferSize: 1e8 // 100MB
});

const PORT = process.env.PORT || 5000;

// In-memory store
let meetings = {}; // meetingId -> { users: [socketId1, socketId2, ...] }
let userNames = {}; // socketId -> userName

// Socket.IO events
io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Handle connection errors
  socket.on("error", (error) => {
    console.error(`Socket error for ${socket.id}:`, error);
  });

  socket.on("join-room", async (meetingId, userId, userName) => {
    try {
      console.log(`User ${userName} (${userId}) joined room ${meetingId}`);
      
      // Join the room
      socket.join(meetingId);
      
      // Store user info
      socket.userId = userId;
      socket.userName = userName;
      socket.meetingId = meetingId;
      
      // Update meetings store
      if (!meetings[meetingId]) {
        meetings[meetingId] = { users: [] };
      }
      
      // Check if user is already in the room to prevent duplicates
      if (!meetings[meetingId].users.includes(socket.id)) {
        meetings[meetingId].users.push(socket.id);
      }
      userNames[socket.id] = userName;
      
      // Get all users in the room
      const roomUsers = [];
      const socketsInRoom = await io.in(meetingId).fetchSockets();
      
      socketsInRoom.forEach((s) => {
        if (s.id !== socket.id) {
          roomUsers.push({
            id: s.id, // Use socket.id directly for consistency
            name: s.userName
          });
        }
      });
      
      // Send the list of existing users to the new user
      socket.emit("all-users", roomUsers);
      
      // Notify everyone else that a new user joined
      socket.to(meetingId).emit("user-joined", { id: socket.id, name: userName });
      
      // Update participant count
      io.to(meetingId).emit("participant-count", socketsInRoom.length);
      
      console.log(`Sent existing ${roomUsers.length} users to ${userName}`);
    } catch (error) {
      console.error("Error in join-room event:", error);
      socket.emit("error", { message: "Failed to join room. Please try again." });
    }
  });

  socket.on("sending-signal", ({ userToSignal, callerID, signal, callerName }) => {
    try {
      console.log(`Sending signal from ${callerName} (${callerID}) to ${userToSignal}`);
      io.to(userToSignal).emit("user-joined", { signal, id: callerID, name: callerName });
    } catch (error) {
      console.error("Error in sending-signal event:", error);
      socket.emit("error", { message: "Failed to send signal. Please try again." });
    }
  });

  socket.on("returning-signal", ({ signal, callerID }) => {
    try {
      console.log(`Returning signal from ${socket.id} to ${callerID}`);
      io.to(callerID).emit("receiving-returned-signal", {
        signal,
        id: socket.id,
        name: socket.userName
      });
    } catch (error) {
      console.error("Error in returning-signal event:", error);
      socket.emit("error", { message: "Failed to return signal. Please try again." });
    }
  });

  socket.on("send-message", (message) => {
    try {
      if (!socket.meetingId) {
        console.error("User not in a meeting, cannot send message");
        return;
      }
      
      const messageData = {
        sender: socket.userName || "Anonymous",
        message,
        time: new Date().toLocaleTimeString()
      };
      
      console.log(`Message from ${messageData.sender} in room ${socket.meetingId}: ${message}`);
      
      // Send to everyone in the room except the sender
      socket.to(socket.meetingId).emit("receive-message", messageData);
      
      // Send back to the sender with fromMe flag
      socket.emit("receive-message", {
        ...messageData,
        fromMe: true
      });
    } catch (error) {
      console.error("Error in send-message event:", error);
      socket.emit("error", { message: "Failed to send message. Please try again." });
    }
  });

  socket.on("disconnect", async () => {
    try {
      console.log(`User disconnected: ${socket.id}`);
      
      if (socket.meetingId) {
        const meetingId = socket.meetingId;
        
        // Remove from meetings store
        if (meetings[meetingId]) {
          meetings[meetingId].users = meetings[meetingId].users.filter(id => id !== socket.id);
          
          // Clean up empty meetings
          if (meetings[meetingId].users.length === 0) {
            delete meetings[meetingId];
          }
        }
        
        // Notify others in the room
        socket.to(meetingId).emit("user-left", socket.id);
        
        // Update participant count
        const socketsInRoom = await io.in(meetingId).fetchSockets();
        io.to(meetingId).emit("participant-count", socketsInRoom.length);
      }
      
      // Clean up user name
      delete userNames[socket.id];
    } catch (error) {
      console.error("Error handling disconnect:", error);
    }
  });
});

// Test endpoint to verify API connectivity
app.get('/api/test', (req, res) => {
  console.log('Test endpoint called');
  res.json({ message: 'API is working!' });
});

// Create meeting endpoint
app.post('/api/meetings/create', (req, res) => {
  console.log('Create meeting endpoint called');
  const meetingId = Math.random().toString(36).substring(2, 12);
  console.log(`Created meeting with ID: ${meetingId}`);
  res.json({ meetingId });
});

// MongoDB connection
if (process.env.MONGO_URI || process.env.MONGODB_URI) {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  mongoose
    .connect(mongoUri)
    .then(() => console.log("MongoDB connected"))
    .catch((err) => {
      console.error("MongoDB connection error:", err);
      console.log("Starting server without MongoDB...");
    });
} else {
  console.log("No MongoDB URI provided. Starting server without MongoDB...");
}

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
