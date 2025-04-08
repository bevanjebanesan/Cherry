# Cherry Video Chat - Deployment Guide

This guide will help you deploy the Cherry video chat application to Vercel and Render while integrating MongoDB, without losing any of the existing functionality.

## Pre-Deployment Checklist

1. **Backup Your Code**
   ```bash
   git add .
   git commit -m "Working video chat with fixed issues - pre-deployment"
   git branch backup-working-video-chat
   ```

2. **Test Locally**
   Ensure all features are working locally before proceeding:
   - Video feeds for all participants
   - Chat functionality on both sides
   - Transcription features
   - Pink theme and UI elements

## MongoDB Integration

### 1. Install MongoDB Dependencies
```bash
# In the backend directory
cd backend
npm install mongoose --save
```

### 2. Create MongoDB Connection
Add this to your backend without modifying existing socket.io code:

```javascript
// Add at the top of server.js
const mongoose = require('mongoose');

// MongoDB connection - add this near the top, after imports
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/cherry', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('MongoDB connected'))
.catch(err => console.error('MongoDB connection error:', err));

// Keep all existing socket.io code unchanged
```

### 3. Create Models (Example)
Create a `models` directory in the backend and add models without changing existing functionality:

```javascript
// models/Message.js
const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  meetingId: { type: String, required: true, index: true },
  sender: { type: String, required: true },
  senderName: { type: String, default: 'Anonymous' },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Message', messageSchema);
```

### 4. Add Persistence to Existing Code
Modify the message handling to save to MongoDB WITHOUT changing the existing socket.io behavior:

```javascript
// In server.js, modify the send-message handler
const Message = require('./models/Message');

// Inside the socket.on('send-message') handler, after the existing code:
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
  
  // Add this part for MongoDB persistence
  // This doesn't affect the existing functionality
  try {
    const dbMessage = new Message({
      meetingId,
      sender: message.sender,
      senderName: message.senderName || 'Anonymous',
      content: message.content,
      timestamp: message.timestamp
    });
    
    dbMessage.save()
      .then(() => console.log('Message saved to database'))
      .catch(err => console.error('Error saving message to database:', err));
  } catch (err) {
    console.error('Error creating message document:', err);
    // Don't throw - this ensures the original functionality continues to work
  }
});
```

## Backend Deployment to Render

1. **Create a Render Web Service**
   - Sign up for Render and create a new Web Service
   - Connect your GitHub repository
   - Select the branch with your code
   - Set the build command: `cd backend && npm install`
   - Set the start command: `cd backend && node server.js`

2. **Environment Variables**
   - Add `MONGODB_URI` with your MongoDB connection string
   - Add `PORT` set to `5000` (or Render's default)
   - Add `NODE_ENV` set to `production`

3. **Update CORS Settings**
   ```javascript
   // In backend/server.js, update the CORS configuration
   const io = new Server(server, {
     cors: {
       origin: ['https://your-frontend-url.vercel.app', 'http://localhost:3000'],
       methods: ['GET', 'POST'],
     },
   });
   ```

## Frontend Deployment to Vercel

1. **Update Socket Connection URL**
   Create a `.env` file in the frontend directory:
   ```
   REACT_APP_SOCKET_URL=https://your-backend-url.onrender.com
   ```

2. **Modify Socket Connection in Meeting.tsx**
   ```javascript
   // In Meeting.tsx, update the socket connection
   const newSocket = io(process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000');
   ```

3. **Deploy to Vercel**
   - Sign up for Vercel and create a new project
   - Connect your GitHub repository
   - Set the root directory to `frontend`
   - Add environment variables:
     - `REACT_APP_SOCKET_URL` = your Render backend URL

## Post-Deployment Testing

After deployment, test all functionality again:

1. Video feeds for all participants
2. Chat messages appearing on both sides
3. Transcription features
4. Room creation and joining
5. User interface and pink theme

## Troubleshooting

If you encounter issues after deployment:

1. **Check Browser Console for Errors**
   - Look for connection issues or CORS errors

2. **Verify Environment Variables**
   - Make sure all environment variables are set correctly

3. **Check Network Requests**
   - Ensure socket connections are being established

4. **Rollback if Necessary**
   - If all else fails, return to your backup branch:
     ```bash
     git checkout backup-working-video-chat
     ```

## Maintaining Functionality

When adding new features:

1. Always test against the core functionality
2. Make incremental changes and test after each change
3. Keep the original socket.io and WebRTC code intact
4. Use feature branches for major changes

Remember: The most important thing is to preserve the working video chat, messaging, and transcription features that have been fixed.
