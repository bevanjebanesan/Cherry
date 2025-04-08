# Cherry Video Chat - Working Configuration

This document describes the current working configuration of the Cherry video chat application. Reference this document if you need to restore functionality after deployment changes.

## Core Functionality

### 1. Video Streaming
- Uses `simple-peer` for WebRTC peer connections
- Properly handles the 'stream' event from peer connections
- Uses CSS hardware acceleration to prevent video flickering
- Manages video elements with refs to ensure proper stream connection

### 2. Chat System
- Real-time messaging via socket.io
- Messages appear on both sides of the call
- Server broadcasts messages to all participants in a room
- Unread message indicators when chat is closed

### 3. Transcription
- Uses browser's SpeechRecognition API
- Transcriptions are broadcast to all participants
- UI for toggling transcription visibility

## Critical Files

### Frontend
- `src/pages/Meeting.tsx`: Core video chat functionality
- `src/components/Chat.tsx`: Chat component
- `src/App.css`: Styling with hardware acceleration for video
- `src/App.tsx`: Main application structure and routing

### Backend
- `server.js`: Socket.io server handling connections and messages

## Environment Setup
- Frontend runs on port 3000
- Backend runs on port 5000
- Socket connection URL: 'http://localhost:5000'

## Deployment Considerations

### MongoDB Integration
- Only add to existing functionality
- Don't modify core video/chat code
- Use MongoDB for features like chat history, user accounts, etc.

### Vercel/Render Deployment
- Update socket connection URL to match deployed backend
- Set appropriate CORS settings in backend
- Ensure all environment variables are properly configured
- Test video and chat functionality after deployment

## Testing Checklist
- [ ] Video feeds visible for all participants
- [ ] No camera flickering
- [ ] Chat messages appear on both sides
- [ ] Transcription features working
- [ ] Pink theme preserved
- [ ] User name display working
- [ ] Room joining/creation working

## Rollback Procedure
If functionality is lost during deployment:
1. Return to the backup Git branch: `git checkout backup-working-video-chat`
2. Compare the changes to identify what broke
3. Restore only the necessary parts while keeping new infrastructure
