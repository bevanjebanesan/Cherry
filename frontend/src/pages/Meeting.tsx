import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Box, Button, Container, Typography, IconButton, Paper, Drawer, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Snackbar } from '@mui/material';
import { Call, CallEnd, Mic, MicOff, Videocam, VideocamOff, ScreenShare, StopScreenShare, Chat, People } from '@mui/icons-material';
import io, { Socket } from 'socket.io-client';
import Peer from 'simple-peer';
import Alert from '@mui/material/Alert';

// Define interfaces for better type safety
interface PeerConnection {
  peerID: string;
  peer: Peer.Instance;
  name?: string;
}

interface Message {
  sender: string;
  message: string;
  time: string;
  fromMe?: boolean;
}

const Meeting = () => {
  const { meetingId } = useParams();
  const navigate = useNavigate();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [peers, setPeers] = useState<PeerConnection[]>([]);
  const [name, setName] = useState('');
  const [nameSubmitted, setNameSubmitted] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [originalStream, setOriginalStream] = useState<MediaStream | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [messageInput, setMessageInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [participantCount, setParticipantCount] = useState(1); // Default to 1 (self)
  
  const peersRef = useRef<PeerConnection[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const userVideo = useRef<HTMLVideoElement | null>(null);
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Set up socket connection and getUserMedia
  useEffect(() => {
    // Clear any existing peers when component mounts or re-renders
    peersRef.current = [];
    setPeers([]);

    // Create socket connection
    const socketUrl = process.env.REACT_APP_SOCKET_URL || 
      (window.location.hostname === 'localhost' 
        ? 'ws://localhost:5000'
        : 'https://cherry-backend.onrender.com');
    
    console.log(`Connecting to socket server at: ${socketUrl}`);
    
    // Improved Socket.IO connection with reconnection options
    const newSocket = io(socketUrl, {
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      transports: ['websocket', 'polling'], // Try websocket first, fallback to polling
      forceNew: true
    });
    
    // Handle connection events
    newSocket.on('connect', () => {
      console.log('Socket connected successfully');
    });
    
    newSocket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
    });
    
    newSocket.on('reconnect_attempt', (attemptNumber) => {
      console.log(`Socket reconnection attempt #${attemptNumber}`);
    });
    
    newSocket.on('reconnect_failed', () => {
      console.error('Socket reconnection failed after multiple attempts');
      alert('Connection to the server failed. Please refresh the page and try again.');
    });
    
    socketRef.current = newSocket;
    setSocket(newSocket);

    // Clean up on unmount
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      if (stream) {
        stream.getTracks().forEach(track => {
          track.stop();
        });
      }
    };
  }, []);

  // Set up event listeners when socket and name are ready
  useEffect(() => {
    if (!socketRef.current || !nameSubmitted || !meetingId) return;

    // Get user media
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(currentStream => {
        setStream(currentStream);
        setOriginalStream(currentStream);
        
        if (userVideo.current) {
          userVideo.current.srcObject = currentStream;
        }
        
        // Join the room
        const userId = socketRef.current.id;
        socketRef.current.emit('join-room', meetingId, userId, name);
        
        // Handle existing users in the room
        socketRef.current.on('all-users', (users: Array<{id: string, name: string}>) => {
          console.log('Received all users:', users);
          
          // Create a peer connection for each existing user
          const peers: PeerConnection[] = [];
          users.forEach(user => {
            if (socketRef.current) {
              const peer = createPeer(user.id, socketRef.current.id, currentStream, name);
              peersRef.current.push({
                peerID: user.id,
                peer,
                name: user.name
              });
              peers.push({
                peerID: user.id,
                peer,
                name: user.name
              });
            }
          });
          
          setPeers(peers);
        });
        
        // Handle new users joining
        socketRef.current.on('user-joined', (payload: {id: string, name: string, signal?: any}) => {
          console.log('User joined:', payload);
          
          // If this user is sending us a signal, create a peer to receive it
          if (payload.signal) {
            const peer = addPeer(payload.signal, payload.id, currentStream, payload.name);
            peersRef.current.push({
              peerID: payload.id,
              peer,
              name: payload.name
            });
            
            setPeers(prev => [...prev, {
              peerID: payload.id,
              peer,
              name: payload.name
            }]);
          }
          // Otherwise, just notify that a user joined without a signal
          else {
            console.log(`User ${payload.name} (${payload.id}) joined without signal`);
          }
        });
        
        // Handle receiving returned signal
        socketRef.current.on('receiving-returned-signal', (payload: {id: string, signal: any, name?: string}) => {
          console.log('Received returned signal:', payload);
          const item = peersRef.current.find(p => p.peerID === payload.id);
          if (item) {
            item.peer.signal(payload.signal);
            // Update the peer's name if it's provided
            if (payload.name && item.name !== payload.name) {
              item.name = payload.name;
              setPeers(prev => 
                prev.map(p => 
                  p.peerID === payload.id 
                    ? {...p, name: payload.name} 
                    : p
                )
              );
            }
          }
        });
        
        // Handle user disconnect
        socketRef.current.on('user-left', (id: string) => {
          console.log('User left:', id);
          const peerObj = peersRef.current.find(p => p.peerID === id);
          if (peerObj) {
            peerObj.peer.destroy();
          }
          
          const peers = peersRef.current.filter(p => p.peerID !== id);
          peersRef.current = peers;
          setPeers(peers);
        });
        
        // Handle receiving messages
        socketRef.current.on('receive-message', (data: Message) => {
          console.log('Received message:', data);
          setMessages(prevMessages => [...prevMessages, data]);
        });
        
        // Handle participant count updates
        socketRef.current.on('participant-count', (count: number) => {
          console.log('Participant count:', count);
          setParticipantCount(count);
        });
        
        // Handle errors
        socketRef.current.on('error', (error: {message: string}) => {
          console.error('Socket error:', error);
          alert(`Connection error: ${error.message}`);
        });
      })
      .catch(error => {
        console.error('Error accessing media devices:', error);
        alert('Error accessing camera/microphone. Please ensure you have granted the necessary permissions.');
      });
      
    return () => {
      if (socketRef.current) {
        socketRef.current.off('all-users');
        socketRef.current.off('user-joined');
        socketRef.current.off('receiving-returned-signal');
        socketRef.current.off('user-left');
        socketRef.current.off('receive-message');
        socketRef.current.off('participant-count');
        socketRef.current.off('error');
      }
    };
  }, [nameSubmitted, meetingId, name]);

  // Function to create a peer (initiator)
  function createPeer(userToSignal: string, callerID: string, stream: MediaStream, callerName: string): Peer.Instance {
    console.log(`Creating peer to signal ${userToSignal}`);
    
    const peer = new Peer({
      initiator: true,
      trickle: false,
      stream,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' },
          {
            urls: 'turn:numb.viagenie.ca',
            credential: 'muazkh',
            username: 'webrtc@live.com'
          }
        ]
      },
      sdpTransform: (sdp) => {
        // Safari specific handling for SDP
        const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        if (isSafari) {
          console.log('Safari detected, transforming SDP');
          return sdp.replace('useinbandfec=1', 'useinbandfec=1; stereo=1; maxaveragebitrate=510000');
        }
        return sdp;
      }
    });
    
    peer.on('signal', signal => {
      if (socketRef.current) {
        socketRef.current.emit('sending-signal', { 
          userToSignal, 
          callerID, 
          signal,
          callerName
        });
      }
    });

    peer.on('error', (err) => {
      console.error('Peer connection error:', err);
    });
    
    return peer;
  }
  
  // Function to add a peer (receiver)
  function addPeer(incomingSignal: any, callerID: string, stream: MediaStream, callerName: string): Peer.Instance {
    console.log(`Adding peer from ${callerName} (${callerID})`);
    
    const peer = new Peer({
      initiator: false,
      trickle: false,
      stream,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' },
          {
            urls: 'turn:numb.viagenie.ca',
            credential: 'muazkh',
            username: 'webrtc@live.com'
          }
        ]
      },
      sdpTransform: (sdp) => {
        // Safari specific handling for SDP
        const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        if (isSafari) {
          console.log('Safari detected, transforming SDP');
          return sdp.replace('useinbandfec=1', 'useinbandfec=1; stereo=1; maxaveragebitrate=510000');
        }
        return sdp;
      }
    });
    
    peer.on('signal', signal => {
      if (socketRef.current) {
        socketRef.current.emit('returning-signal', { signal, callerID });
      }
    });

    peer.on('error', (err) => {
      console.error('Peer connection error:', err);
    });
    
    peer.signal(incomingSignal);
    
    return peer;
  }

  // Function to set video ref for a peer
  const setPeerVideoRef = (video: HTMLVideoElement | null, peer: PeerConnection) => {
    if (!video) return;
    
    if (peer && peer.peer) {
      console.log(`Setting video ref for peer ${peer.name} (${peer.peerID})`);
      
      // Remove any existing listeners to avoid duplicates
      peer.peer.removeAllListeners('stream');
      
      // Add stream listener
      peer.peer.on('stream', (stream: MediaStream) => {
        console.log(`Received stream from peer ${peer.name} (${peer.peerID})`);
        
        // Ensure video element exists and set its srcObject
        if (video) {
          video.srcObject = stream;
          
          // Ensure video plays
          video.onloadedmetadata = () => {
            console.log(`Video metadata loaded for peer ${peer.name}`);
            video.play().catch(err => {
              console.error(`Error playing video for peer ${peer.name}:`, err);
            });
          };
        }
      });
    }
  };

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <Box sx={{ 
        padding: 2, 
        backgroundColor: '#F06292', 
        color: 'white',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <Typography variant="h6">Meeting: {meetingId}</Typography>
        <Box>
          <IconButton onClick={() => setIsChatOpen(true)} color="inherit">
            <Chat />
          </IconButton>
          <IconButton onClick={() => navigate('/')} color="inherit">
            <CallEnd />
          </IconButton>
        </Box>
      </Box>

      {/* Video grid */}
      <Box sx={{ 
        flex: 1, 
        padding: 2, 
        display: 'grid', 
        gap: 2,
        gridTemplateColumns: 'repeat(3, 1fr)',
        gridTemplateRows: 'repeat(2, 1fr)',
        alignItems: 'center',
        justifyItems: 'center',
        width: '100%'
      }}>
        {/* Local video */}
        <Box sx={{ 
          position: 'relative', 
          width: '100%', 
          height: '100%',
          borderRadius: 2,
          overflow: 'hidden',
          backgroundColor: '#2D2D2D'
        }}>
          <video
            ref={userVideo}
            muted
            autoPlay
            playsInline
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: isVideoOff ? 'none' : 'block'
            }}
          />
          <Box
            sx={{
              position: 'absolute',
              bottom: 8,
              left: 8,
              backgroundColor: 'rgba(0, 0, 0, 0.6)',
              color: 'white',
              padding: '4px 8px',
              borderRadius: 1,
              fontSize: '0.8rem'
            }}
          >
            {name || 'Me'} {!isVideoOff && '(Video Off)'}
          </Box>
        </Box>

        {/* Remote videos */}
        {peers.map((peer, index) => (
          <Box key={index} sx={{ 
            position: 'relative', 
            width: '100%', 
            height: '100%',
            borderRadius: 2,
            overflow: 'hidden',
            backgroundColor: '#2D2D2D'
          }}>
            <video
              ref={video => setPeerVideoRef(video, peer)}
              autoPlay
              playsInline
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover'
              }}
            />
            <Box
              sx={{
                position: 'absolute',
                bottom: 8,
                left: 8,
                backgroundColor: 'rgba(0, 0, 0, 0.6)',
                color: 'white',
                padding: '4px 8px',
                borderRadius: 1,
                fontSize: '0.8rem'
              }}
            >
              {peer.name || 'Participant'}
            </Box>
          </Box>
        ))}
      </Box>

      {/* Controls */}
      <Box sx={{ 
        padding: 2, 
        backgroundColor: '#2D2D2D', 
        display: 'flex', 
        justifyContent: 'center',
        gap: 2
      }}>
        <IconButton 
          onClick={() => setIsMuted(!isMuted)} 
          sx={{ backgroundColor: isMuted ? 'red' : 'rgba(255,255,255,0.1)', color: 'white' }}
        >
          {isMuted ? <MicOff /> : <Mic />}
        </IconButton>
        
        <IconButton 
          onClick={() => setIsVideoOff(!isVideoOff)} 
          sx={{ backgroundColor: isVideoOff ? 'red' : 'rgba(255,255,255,0.1)', color: 'white' }}
        >
          {isVideoOff ? <VideocamOff /> : <Videocam />}
        </IconButton>
        
        <IconButton 
          onClick={() => setIsScreenSharing(!isScreenSharing)} 
          sx={{ backgroundColor: isScreenSharing ? 'green' : 'rgba(255,255,255,0.1)', color: 'white' }}
        >
          {isScreenSharing ? <StopScreenShare /> : <ScreenShare />}
        </IconButton>
      </Box>

      {/* Chat drawer */}
      <Drawer
        anchor="right"
        open={isChatOpen}
        onClose={() => setIsChatOpen(false)}
      >
        <Box sx={{ width: 300, height: '100%', display: 'flex', flexDirection: 'column' }}>
          <Box sx={{ 
            padding: 2, 
            backgroundColor: '#F06292', 
            color: 'white',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <Typography variant="h6">Chat</Typography>
            <IconButton onClick={() => setIsChatOpen(false)} sx={{ color: 'white' }}>
              &times;
            </IconButton>
          </Box>
          
          <Box sx={{ 
            flex: 1, 
            padding: 2, 
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 1
          }}>
            {messages.map((msg, index) => (
              <Paper key={index} sx={{ 
                padding: 1, 
                backgroundColor: msg.fromMe ? '#DCF8C6' : '#FFFFFF',
                alignSelf: msg.fromMe ? 'flex-end' : 'flex-start',
                maxWidth: '80%'
              }}>
                <Typography variant="subtitle2" color="textSecondary">
                  {msg.sender} • {msg.time}
                </Typography>
                <Typography variant="body2">{msg.message}</Typography>
              </Paper>
            ))}
            <div ref={messagesEndRef} />
          </Box>
          
          <Box sx={{ 
            padding: 2, 
            display: 'flex',
            gap: 1
          }}>
            <TextField
              fullWidth
              size="small"
              placeholder="Type a message..."
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  socketRef.current?.emit('send-message', messageInput);
                  setMessageInput('');
                }
              }}
            />
            <Button 
              variant="contained" 
              color="primary" 
              onClick={() => {
                socketRef.current?.emit('send-message', messageInput);
                setMessageInput('');
              }}
              disabled={!messageInput.trim()}
            >
              Send
            </Button>
          </Box>
        </Box>
      </Drawer>

      {/* Participant count */}
      <Box sx={{ 
        position: 'absolute', 
        top: 8, 
        right: 8, 
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        color: 'white',
        padding: '4px 8px',
        borderRadius: 1,
        fontSize: '0.8rem'
      }}>
        Participants: {participantCount}
      </Box>
    </Box>
  );
};

export default Meeting;
