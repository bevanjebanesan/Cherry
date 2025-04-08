import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Box,
  Button,
  Container,
  Typography,
  IconButton,
  Paper,
  Drawer,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Snackbar,
  Alert,
  Tooltip,
  InputAdornment,
  Badge,
  Avatar,
} from '@mui/material';
import {
  Mic as MicIcon,
  MicOff as MicOffIcon,
  Videocam as VideocamIcon,
  VideocamOff as VideocamOffIcon,
  Chat as ChatIcon,
  RecordVoiceOver as RecordVoiceOverIcon,
  Share as ShareIcon,
  ContentCopy as ContentCopyIcon,
  Email as EmailIcon,
  Close as CloseIcon,
  Person as PersonIcon,
} from '@mui/icons-material';
import Peer from 'simple-peer';
import { io, Socket } from 'socket.io-client';
import Chat from '../components/Chat';

interface PeerConnection {
  peerId: string;
  peer: Peer.Instance;
  stream?: MediaStream;
  userName?: string;
}

interface Message {
  sender: string;
  content: string;
  timestamp: Date;
  senderName?: string;
}

const Meeting: React.FC = () => {
  const params = useParams<{ meetingId: string }>();
  const meetingId = params.meetingId || '';
  const [socket, setSocket] = useState<Socket | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [peers, setPeers] = useState<PeerConnection[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [transcripts, setTranscripts] = useState<{[key: string]: string}>({});
  const [showTranscription, setShowTranscription] = useState(true);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const [isNameDialogOpen, setIsNameDialogOpen] = useState(true);
  const [userName, setUserName] = useState('');
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');
  const [unreadMessages, setUnreadMessages] = useState(0);
  
  const userVideo = useRef<HTMLVideoElement>(null);
  const peersRef = useRef<PeerConnection[]>([]);
  const peerVideos = useRef<{ [key: string]: HTMLVideoElement }>({});
  
  // Speech recognition setup
  const recognition = useRef<any>(null);

  // Initialize speech recognition
  useEffect(() => {
    if ('webkitSpeechRecognition' in window) {
      recognition.current = new (window as any).webkitSpeechRecognition();
      recognition.current.continuous = true;
      recognition.current.interimResults = true;

      recognition.current.onresult = (event: any) => {
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript + ' ';
            socket?.emit('send-transcription', { meetingId, text: finalTranscript });
          }
        }
        if (finalTranscript) {
          setTranscript(finalTranscript);
          // Add to user's own transcript
          setTranscripts(prev => ({
            ...prev,
            [socket?.id || 'me']: finalTranscript
          }));
        }
      };
    }
  }, [meetingId, socket]);

  // Handle name submission
  const handleNameSubmit = () => {
    if (userName.trim()) {
      setIsNameDialogOpen(false);
      initializeMediaAndJoinMeeting();
    }
  };

  // Initialize media and join meeting
  const initializeMediaAndJoinMeeting = () => {
    // Clear any existing peer connections
    peersRef.current = [];
    setPeers([]);
    
    // Reset transcripts
    setTranscripts({});
    setTranscript('');
    
    const newSocket = io(process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000');
    setSocket(newSocket);

    // Get user media with constraints
    const constraints = {
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: 'user',
      },
      audio: true,
    };

    // Function to join meeting with or without media
    const joinMeetingWithUserInfo = (stream: MediaStream | null) => {
      if (stream) {
        setStream(stream);
        if (userVideo.current) {
          userVideo.current.srcObject = stream;
          userVideo.current.play().catch(err => {
            console.error("Error playing video:", err);
          });
        }

        // Initialize tracks state
        setIsMuted(false);
        setIsVideoOff(false);
      } else {
        // No media stream available
        setIsVideoOff(true);
        setIsMuted(true);
      }

      // Join room with user information
      newSocket.emit('join-room', meetingId, newSocket.id, userName);
      console.log('Joined room:', meetingId, 'as', userName, 'with ID:', newSocket.id);

      // Handle existing users in the room
      newSocket.on('get-users', (users: Array<{id: string, userName: string}>) => {
        console.log('Existing users in room:', users);
        // Connect to each existing user
        users.forEach(user => {
          if (user.id !== newSocket.id) {
            connectToNewUser(user.id, stream, user.userName);
          }
        });
      });

      newSocket.on('user-connected', (userId, remoteUserName) => {
        console.log('New user connected:', userId, 'Name:', remoteUserName);
        // Delay connection slightly to ensure both sides are ready
        setTimeout(() => {
          connectToNewUser(userId, stream, remoteUserName);
        }, 1000);
      });

      newSocket.on('user-joined', ({ signal, callerID, userName: callerName }) => {
        console.log('User joined with signal:', callerID, 'Name:', callerName);
        const peer = addPeer(signal, callerID, stream);
        
        // Store the peer connection
        peersRef.current.push({
          peerId: callerID,
          peer,
          userName: callerName,
        });

        // Add the peer to state with or without stream
        setPeers((users) => [...users, { peerId: callerID, peer, userName: callerName }]);
      });

      newSocket.on('receiving-returned-signal', ({ signal, id }) => {
        console.log('Received returned signal from:', id);
        const item = peersRef.current.find((p) => p.peerId === id);
        if (item) {
          item.peer.signal(signal);
        } else {
          console.error('Peer not found for ID:', id);
        }
      });

      newSocket.on('user-disconnected', (userId) => {
        console.log('User disconnected:', userId);
        const peerObj = peersRef.current.find((p) => p.peerId === userId);
        if (peerObj) {
          peerObj.peer.destroy();
        }
        
        // Remove the peer from refs and state
        peersRef.current = peersRef.current.filter((p) => p.peerId !== userId);
        setPeers((users) => users.filter((p) => p.peerId !== userId));
        
        // Remove transcripts for this user
        setTranscripts(prev => {
          const newTranscripts = { ...prev };
          delete newTranscripts[userId];
          return newTranscripts;
        });
      });

      newSocket.on('receive-message', (message) => {
        console.log('Received message:', message);
        if (!isChatOpen) {
          setUnreadMessages((prev) => prev + 1);
        }
      });

      newSocket.on('receive-transcription', ({ userId, text, userName: transcriptUserName }) => {
        console.log('Received transcription from:', userId, 'Text:', text);
        setTranscripts(prev => ({
          ...prev,
          [userId]: text
        }));
      });
    };

    // Try to get media, but join meeting even if media access fails
    navigator.mediaDevices
      .getUserMedia(constraints)
      .then((currentStream) => {
        console.log('Got local media stream:', currentStream.id);
        joinMeetingWithUserInfo(currentStream);
      })
      .catch((err) => {
        console.error("Error getting user media:", err);
        // Join meeting without media
        joinMeetingWithUserInfo(null);
        
        // Show error message
        setSnackbarMessage('Could not access camera/microphone. Joining without media.');
        setSnackbarOpen(true);
      });
  };

  // Create a peer connection to a new user
  const connectToNewUser = (userId: string, stream: MediaStream | null, remoteUserName: string) => {
    console.log('Connecting to new user:', userId, 'Name:', remoteUserName);
    
    // Check if we already have a connection to this peer
    if (peersRef.current.some(p => p.peerId === userId)) {
      console.log('Already connected to this peer, skipping');
      return;
    }
    
    // Create peer even if we don't have a stream
    const peer = createPeer(userId, stream);
    
    peersRef.current.push({
      peerId: userId,
      peer,
      userName: remoteUserName,
    });

    // Add peer to state
    setPeers(users => [...users, { peerId: userId, peer, userName: remoteUserName }]);
  };

  // Create a peer connection as the initiator
  const createPeer = (userToSignal: string, stream: MediaStream | null) => {
    console.log('Creating peer as initiator for:', userToSignal);
    
    const peer = new Peer({
      initiator: true,
      trickle: false,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' },
        ]
      }
    });

    // Add stream if available
    if (stream) {
      stream.getTracks().forEach(track => {
        peer.addTrack(track, stream);
      });
    }

    // Handle peer events
    peer.on('signal', (data) => {
      console.log('Generated signal as initiator for:', userToSignal);
      socket?.emit('sending-signal', {
        userToSignal,
        callerID: socket.id,
        signal: data,
        userName,
      });
    });

    peer.on('stream', (currentStream) => {
      console.log('Received stream as initiator from:', userToSignal, 'Stream ID:', currentStream.id);
      
      // Update the peer object with the stream
      setPeers(prevPeers => 
        prevPeers.map(p => 
          p.peerId === userToSignal 
            ? { ...p, stream: currentStream } 
            : p
        )
      );
    });

    peer.on('error', (err) => {
      console.error('Peer connection error with:', userToSignal, err);
    });

    return peer;
  };

  // Add a peer connection as the receiver
  const addPeer = (incomingSignal: any, callerID: string, stream: MediaStream | null) => {
    console.log('Adding peer as receiver for:', callerID);
    
    const peer = new Peer({
      initiator: false,
      trickle: false,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' },
        ]
      }
    });

    // Add stream if available
    if (stream) {
      stream.getTracks().forEach(track => {
        peer.addTrack(track, stream);
      });
    }

    // Handle peer events
    peer.on('signal', (data) => {
      console.log('Generated signal as receiver for:', callerID);
      socket?.emit('returning-signal', { signal: data, callerID });
    });

    peer.on('stream', (currentStream) => {
      console.log('Received stream as receiver from:', callerID, 'Stream ID:', currentStream.id);
      
      // Update the peer object with the stream
      setPeers(prevPeers => 
        prevPeers.map(p => 
          p.peerId === callerID 
            ? { ...p, stream: currentStream } 
            : p
        )
      );
    });

    peer.on('error', (err) => {
      console.error('Peer connection error with:', callerID, err);
    });

    peer.signal(incomingSignal);

    return peer;
  };

  // Set video reference for a peer
  const setPeerVideoRef = (peerId: string, element: HTMLVideoElement | null) => {
    if (element) {
      peerVideos.current[peerId] = element;
      
      // Find the peer
      const peer = peers.find(p => p.peerId === peerId);
      
      // If we have a stream for this peer, set it to the video element
      if (peer && peer.stream) {
        console.log('Setting stream to video element for peer:', peerId);
        element.srcObject = peer.stream;
        element.play().catch(err => {
          console.error(`Error playing video for ${peerId}:`, err);
        });
      }
    }
  };

  // Toggle mute
  const toggleMute = () => {
    if (stream) {
      const audioTracks = stream.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

  // Toggle video
  const toggleVideo = () => {
    if (stream) {
      const videoTracks = stream.getVideoTracks();
      videoTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsVideoOff(!isVideoOff);
    }
  };

  // Toggle transcription
  const toggleTranscription = () => {
    if (isTranscribing) {
      if (recognition.current) {
        recognition.current.stop();
      }
      setIsTranscribing(false);
    } else {
      if (recognition.current) {
        try {
          recognition.current.start();
          setIsTranscribing(true);
        } catch (err) {
          console.error('Error starting speech recognition:', err);
          setSnackbarMessage('Error starting transcription. Please try again.');
          setSnackbarOpen(true);
        }
      } else {
        setSnackbarMessage('Speech recognition not supported in this browser.');
        setSnackbarOpen(true);
      }
    }
  };

  // Toggle transcription visibility
  const toggleTranscriptionVisibility = () => {
    setShowTranscription(!showTranscription);
  };

  // Copy meeting link to clipboard
  const copyMeetingLink = () => {
    const url = `${window.location.origin}/meeting/${meetingId}`;
    navigator.clipboard.writeText(url)
      .then(() => {
        setSnackbarMessage('Meeting link copied to clipboard');
        setSnackbarOpen(true);
      })
      .catch(err => {
        console.error('Could not copy text: ', err);
        setSnackbarMessage('Failed to copy meeting link');
        setSnackbarOpen(true);
      });
  };

  // Share meeting via email
  const shareMeetingByEmail = () => {
    const url = `${window.location.origin}/meeting/${meetingId}`;
    window.location.href = `mailto:?subject=Join my video meeting&body=Join my meeting: ${url}`;
  };

  // Get initials for avatar
  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(part => part[0])
      .join('')
      .toUpperCase()
      .substring(0, 2);
  };

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Meeting header */}
      <Box className="meeting-header">
        <Typography variant="h6">Meeting: {meetingId}</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Badge badgeContent={unreadMessages} color="error">
            <IconButton 
              color="inherit" 
              onClick={() => {
                setIsChatOpen(!isChatOpen);
                setUnreadMessages(0);
              }}
            >
              <ChatIcon />
            </IconButton>
          </Badge>
          <IconButton color="inherit" onClick={() => setIsShareDialogOpen(true)}>
            <ShareIcon />
          </IconButton>
        </Box>
      </Box>

      {/* Main content */}
      <Box sx={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <Box className="video-grid">
          {/* Local video */}
          <Box className="video-container">
            <video
              ref={userVideo}
              muted
              autoPlay
              playsInline
              style={{ 
                display: isVideoOff ? 'none' : 'block',
                width: '100%',
                height: '100%',
                objectFit: 'cover',
              }}
            />
            {isVideoOff && (
              <Box sx={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                height: '100%',
                bgcolor: '#1a1a1a'
              }}>
                <Avatar sx={{ width: 80, height: 80, bgcolor: '#e91e63' }}>
                  {getInitials(userName || 'You')}
                </Avatar>
              </Box>
            )}
            <Box className="user-info">
              {userName || 'You'} {isMuted && <MicOffIcon fontSize="small" />}
            </Box>
          </Box>

          {/* Remote videos */}
          {peers.map((peer) => (
            <Box key={peer.peerId} className="video-container">
              <video
                ref={(element) => setPeerVideoRef(peer.peerId, element)}
                autoPlay
                playsInline
                style={{ 
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                }}
              />
              {(!peer.stream || (peer.stream.getVideoTracks().length === 0)) && (
                <Box sx={{ 
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  bgcolor: '#1a1a1a'
                }}>
                  <Avatar sx={{ width: 80, height: 80, bgcolor: '#9c27b0' }}>
                    {getInitials(peer.userName || 'Guest')}
                  </Avatar>
                </Box>
              )}
              <Box className="user-info">
                {peer.userName || 'Guest'}
              </Box>
            </Box>
          ))}
        </Box>

        {/* Transcription overlay */}
        {showTranscription && Object.keys(transcripts).length > 0 && (
          <Box className="transcription-container">
            {Object.entries(transcripts).map(([userId, text]) => {
              const user = peers.find(p => p.peerId === userId);
              const name = userId === socket?.id ? userName : (user?.userName || 'Guest');
              return (
                <Box key={userId} sx={{ mb: 1 }}>
                  <Typography variant="subtitle2" color="#e91e63">{name}:</Typography>
                  <Typography variant="body2">{text}</Typography>
                </Box>
              );
            })}
          </Box>
        )}
      </Box>

      {/* Controls */}
      <Box className="controls-bar">
        <Tooltip title={isMuted ? "Unmute" : "Mute"}>
          <IconButton 
            color={isMuted ? "default" : "primary"} 
            onClick={toggleMute}
          >
            {isMuted ? <MicOffIcon /> : <MicIcon />}
          </IconButton>
        </Tooltip>
        <Tooltip title={isVideoOff ? "Turn on camera" : "Turn off camera"}>
          <IconButton 
            color={isVideoOff ? "default" : "primary"} 
            onClick={toggleVideo}
          >
            {isVideoOff ? <VideocamOffIcon /> : <VideocamIcon />}
          </IconButton>
        </Tooltip>
        <Tooltip title={isTranscribing ? "Stop transcription" : "Start transcription"}>
          <IconButton 
            color={isTranscribing ? "primary" : "default"} 
            onClick={toggleTranscription}
          >
            <RecordVoiceOverIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title={showTranscription ? "Hide transcriptions" : "Show transcriptions"}>
          <IconButton 
            color={showTranscription ? "primary" : "default"} 
            onClick={toggleTranscriptionVisibility}
          >
            <Typography variant="caption" sx={{ fontWeight: 'bold' }}>Tt</Typography>
          </IconButton>
        </Tooltip>
      </Box>

      {/* Chat drawer */}
      <Drawer
        anchor="right"
        open={isChatOpen}
        onClose={() => setIsChatOpen(false)}
        sx={{
          '& .MuiDrawer-paper': { 
            width: { xs: '100%', sm: 350 },
            boxSizing: 'border-box',
          },
        }}
      >
        <Box className="chat-header">
          <Typography variant="h6">Chat</Typography>
          <IconButton onClick={() => setIsChatOpen(false)} color="inherit">
            <CloseIcon />
          </IconButton>
        </Box>
        {socket && <Chat socket={socket} meetingId={meetingId} userName={userName} />}
      </Drawer>

      {/* Name dialog */}
      <Dialog 
        open={isNameDialogOpen} 
        onClose={() => {}} 
        maxWidth="xs" 
        fullWidth
      >
        <DialogTitle>Enter your name</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Your Name"
            type="text"
            fullWidth
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                handleNameSubmit();
              }
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleNameSubmit} color="primary" disabled={!userName.trim()}>
            Join Meeting
          </Button>
        </DialogActions>
      </Dialog>

      {/* Share dialog */}
      <Dialog 
        open={isShareDialogOpen} 
        onClose={() => setIsShareDialogOpen(false)} 
        maxWidth="xs" 
        fullWidth
      >
        <DialogTitle>Share Meeting</DialogTitle>
        <DialogContent>
          <Typography variant="body2" gutterBottom>
            Share this link with others to join the meeting:
          </Typography>
          <TextField
            margin="dense"
            fullWidth
            value={`${window.location.origin}/meeting/${meetingId}`}
            InputProps={{
              readOnly: true,
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    onClick={copyMeetingLink}
                    edge="end"
                  >
                    <ContentCopyIcon />
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />
          <Box sx={{ mt: 2, display: 'flex', justifyContent: 'center' }}>
            <Button
              startIcon={<EmailIcon />}
              variant="outlined"
              onClick={shareMeetingByEmail}
            >
              Email Invite
            </Button>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIsShareDialogOpen(false)} color="primary">
            Close
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar for notifications */}
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={6000}
        onClose={() => setSnackbarOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setSnackbarOpen(false)} severity="success" sx={{ width: '100%' }}>
          {snackbarMessage}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default Meeting;
