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
  }
});

const PORT = process.env.PORT || 5000;

// In-memory store
let meetings = {}; // meetingId -> { users: [socketId1, socketId2, ...] }
let userNames = {}; // socketId -> userName

io.on("connection", (socket) => {
  console.log(`New connection: ${socket.id}`);

  socket.on("join-meeting", ({ meetingId, userName }) => {
    console.log(`User ${userName} joining meeting ${meetingId}`);
    socket.join(meetingId);
    socket.userName = userName;
    socket.meetingId = meetingId;
    userNames[socket.id] = userName;

    // Add user to meeting
    if (!meetings[meetingId]) meetings[meetingId] = [];
    meetings[meetingId].push(socket.id);

    // Send list of existing users in the meeting to the new user
    const otherUsers = meetings[meetingId].filter(id => id !== socket.id);
    console.log(`Sending ${otherUsers.length} existing users to new user ${socket.id}`);
    socket.emit("all-users", otherUsers);

    // Notify others
    otherUsers.forEach(userId => {
      console.log(`Notifying user ${userId} about new user ${socket.id}`);
      io.to(userId).emit("user-joined", { signal: null, callerID: socket.id });
    });
  });

  socket.on("sending-signal", ({ userToSignal, callerID, signal }) => {
    console.log(`User ${callerID} sending signal to ${userToSignal}`);
    io.to(userToSignal).emit("user-joined", { signal, callerID });
  });

  socket.on("returning-signal", ({ callerID, signal }) => {
    console.log(`User ${socket.id} returning signal to ${callerID}`);
    io.to(callerID).emit("receiving-returned-signal", { signal, id: socket.id });
  });

  // Handle chat messages
  socket.on("send-message", ({ roomID, message, sender, time }) => {
    console.log(`User ${sender} sending message to room ${roomID}: ${message}`);
    // Broadcast the message to all users in the room except the sender
    socket.to(roomID).emit("receive-message", { sender, message, time });
  });

  socket.on("disconnect", () => {
    console.log(`Disconnected: ${socket.id}`);
    const userName = userNames[socket.id];
    delete userNames[socket.id];
    
    for (const meetingId in meetings) {
      if (meetings[meetingId].includes(socket.id)) {
        console.log(`User ${userName || socket.id} left meeting ${meetingId}`);
        meetings[meetingId] = meetings[meetingId].filter(id => id !== socket.id);
        io.in(meetingId).emit("user-disconnected", socket.id);
        if (meetings[meetingId].length === 0) {
          console.log(`Meeting ${meetingId} is now empty, removing it`);
          delete meetings[meetingId];
        }
      }
    }
  });
});

// Test endpoint to verify API connectivity
app.get('/api/test', (req, res) => {
  console.log('Test endpoint called');
  res.json({ message: 'API is working!' });
});

// Optional MongoDB setup if you're persisting meetings
mongoose
  .connect(process.env.MONGO_URI || "mongodb://localhost:27017/videoapp")
  .then(() => {
    console.log("MongoDB connected");
    server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err);
    console.log("Starting server without MongoDB...");
    server.listen(PORT, () => console.log(`Server running on port ${PORT} (without MongoDB)`));
  });
