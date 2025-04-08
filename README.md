# Cherry

A modern video conferencing application with accessibility features, built with React, Node.js, and WebRTC.

## Features

- User authentication and guest access
- Real-time video conferencing using WebRTC
- Live chat functionality
- Speech-to-text conversion
- Meeting management with host controls

## Tech Stack

- Frontend: React.js (hosted on Vercel)
- Backend: Node.js with Express (hosted on Render)
- Database: MongoDB
- Real-time Communication: WebRTC, Socket.io
- Authentication: JWT

## Getting Started

1. Clone the repository
2. Install dependencies:
   ```bash
   npm run install-all
   ```
3. Create a `.env` file in the root directory with:
   ```
   MONGODB_URI=your_mongodb_uri
   JWT_SECRET=your_jwt_secret
   NODE_ENV=development
   PORT=5000
   ```
4. Start the development servers:
   ```bash
   npm run dev
   ```

## Development

- Frontend runs on: http://localhost:3000
- Backend runs on: http://localhost:5000
