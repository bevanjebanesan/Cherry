import React, { useEffect, useRef, useState, useCallback } from 'react';
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
    
    // Use the REACT_APP_SOCKET_URL environment variable or fallback to the deployed backend URL
    const socketUrl = process.env.REACT_APP_SOCKET_URL || 'https://cherry-backend-ybwi.onrender.com';
    console.log('Connecting to socket server at:', socketUrl);
    
    const newSocket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      timeout: 20000
    });
    setSocket(newSocket);

    // Log socket connection events
    newSocket.on('connect', () => {
      console.log('Socket connected successfully with ID:', newSocket.id);
    });

    newSocket.on('connect_error', (err) => {
      console.error('Socket connection error:', err);
    });

    newSocket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
    });

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
          
          // Ensure video plays
          userVideo.current.play().catch(err => {
            console.error("Error playing local video:", err);
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
  const connectToNewUser = useCallback((userId: string, stream: MediaStream | null, remoteUserName: string) => {
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
  }, []);

  // Create a peer connection as the initiator
  const createPeer = useCallback((userToSignal: string, stream: MediaStream | null) => {
    console.log('Creating peer as initiator for:', userToSignal);
    
    const peer = new Peer({
      initiator: true,
      trickle: true, // Enable trickle ICE for faster connections
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' },
          {
            urls: 'turn:relay.metered.ca:80',
            username: 'e7eb9e7b4b3b6a1e3b8b6b6a',
            credential: 'Fy9/K99gQvft+TB2',
          },
          {
            urls: 'turn:relay.metered.ca:443',
            username: 'e7eb9e7b4b3b6a1e3b8b6b6a',
            credential: 'Fy9/K99gQvft+TB2',
          },
          {
            urls: 'turn:relay.metered.ca:443?transport=tcp',
            username: 'e7eb9e7b4b3b6a1e3b8b6b6a',
            credential: 'Fy9/K99gQvft+TB2',
          },
        ]
      }
    });

    // Add stream if available
    if (stream) {
      console.log('Adding local stream to initiator peer, tracks:', stream.getTracks().length);
      try {
        stream.getTracks().forEach(track => {
          peer.addTrack(track, stream);
        });
      } catch (err) {
        console.error('Error adding tracks to peer:', err);
      }
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

    peer.on('connect', () => {
      console.log('Peer connection established with:', userToSignal);
    });

    peer.on('stream', (currentStream) => {
      console.log('Received stream as initiator from:', userToSignal, 'Stream ID:', currentStream.id, 'Tracks:', currentStream.getTracks().length);
      
      // Update the peer object with the stream
      const peerObj = peersRef.current.find(p => p.peerId === userToSignal);
      if (peerObj) {
        peerObj.stream = currentStream;
      }
      
      setPeers(prevPeers => 
        prevPeers.map(p => 
          p.peerId === userToSignal 
            ? { ...p, stream: currentStream } 
            : p
        )
      );
      
      // If we already have a video element for this peer, set the stream to it
      if (peerVideos.current[userToSignal]) {
        console.log('Setting stream to existing video element for peer:', userToSignal);
        peerVideos.current[userToSignal].srcObject = currentStream;
        peerVideos.current[userToSignal].play().catch(err => {
          console.error(`Error playing video for ${userToSignal}:`, err);
        });
      }
    });

    peer.on('track', (track, stream) => {
      console.log('Received track as initiator from:', userToSignal, 'Track kind:', track.kind);
    });

    peer.on('error', (err) => {
      console.error('Peer connection error with:', userToSignal, err);
    });

    peer.on('close', () => {
      console.log('Peer connection closed with:', userToSignal);
    });

    return peer;
  }, [socket, userName]);

  // Add a peer connection as the receiver
  const addPeer = useCallback((incomingSignal: any, callerID: string, stream: MediaStream | null) => {
    console.log('Adding peer as receiver for:', callerID);
    
    const peer = new Peer({
      initiator: false,
      trickle: true, // Enable trickle ICE for faster connections
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' },
          {
            urls: 'turn:relay.metered.ca:80',
            username: 'e7eb9e7b4b3b6a1e3b8b6b6a',
            credential: 'Fy9/K99gQvft+TB2',
          },
          {
            urls: 'turn:relay.metered.ca:443',
            username: 'e7eb9e7b4b3b6a1e3b8b6b6a',
            credential: 'Fy9/K99gQvft+TB2',
          },
          {
            urls: 'turn:relay.metered.ca:443?transport=tcp',
            username: 'e7eb9e7b4b3b6a1e3b8b6b6a',
            credential: 'Fy9/K99gQvft+TB2',
          },
        ]
      }
    });

    // Add stream if available
    if (stream) {
      console.log('Adding local stream to receiver peer, tracks:', stream.getTracks().length);
      try {
        stream.getTracks().forEach(track => {
          peer.addTrack(track, stream);
        });
      } catch (err) {
        console.error('Error adding tracks to peer:', err);
      }
    }

    // Handle peer events
    peer.on('signal', (data) => {
      console.log('Generated signal as receiver for:', callerID);
      socket?.emit('returning-signal', { signal: data, callerID });
    });

    peer.on('connect', () => {
      console.log('Peer connection established with:', callerID);
    });

    peer.on('stream', (currentStream) => {
      console.log('Received stream as receiver from:', callerID, 'Stream ID:', currentStream.id, 'Tracks:', currentStream.getTracks().length);
      
      // Update the peer object with the stream
      const peerObj = peersRef.current.find(p => p.peerId === callerID);
      if (peerObj) {
        peerObj.stream = currentStream;
      }
      
      setPeers(prevPeers => 
        prevPeers.map(p => 
          p.peerId === callerID 
            ? { ...p, stream: currentStream } 
            : p
        )
      );
      
      // If we already have a video element for this peer, set the stream to it
      if (peerVideos.current[callerID]) {
        console.log('Setting stream to existing video element for peer:', callerID);
        peerVideos.current[callerID].srcObject = currentStream;
        peerVideos.current[callerID].play().catch(err => {
          console.error(`Error playing video for ${callerID}:`, err);
        });
      }
    });

    peer.on('track', (track, stream) => {
      console.log('Received track as receiver from:', callerID, 'Track kind:', track.kind);
    });

    peer.on('error', (err) => {
      console.error('Peer connection error with:', callerID, err);
    });

    peer.on('close', () => {
      console.log('Peer connection closed with:', callerID);
    });

    // Signal the peer with the incoming signal
    try {
      peer.signal(incomingSignal);
    } catch (err) {
      console.error('Error signaling peer:', err);
    }

    return peer;
  }, [socket]);

  // Socket event handlers
  useEffect(() => {
    if (!socket) return;

    // Handle when a new user joins the meeting
    const handleUserJoined = ({ signal, callerID, userName: callerName }: { signal: any, callerID: string, userName: string }) => {
      console.log('User joined:', callerID, callerName);
      
      // Create a peer connection to the new user
      const peer = addPeer(signal, callerID, stream);
      
      peersRef.current.push({
        peerId: callerID,
        peer,
        userName: callerName,
      });

      // Add peer to state
      setPeers(prevPeers => [...prevPeers, { peerId: callerID, peer, userName: callerName }]);
    };

    // Handle when a user returns a signal
    const handleReceivingReturnedSignal = ({ signal, id }: { signal: any, id: string }) => {
      console.log('Received returned signal from:', id);
      const item = peersRef.current.find(p => p.peerId === id);
      if (item) {
        try {
          item.peer.signal(signal);
        } catch (err) {
          console.error('Error signaling peer:', err);
        }
      } else {
        console.warn('Could not find peer to signal:', id);
      }
    };

    // Handle when a user disconnects
    const handleUserDisconnected = (userId: string) => {
      console.log('User disconnected:', userId);
      
      // Remove the peer from peersRef
      peersRef.current = peersRef.current.filter(p => p.peerId !== userId);
      
      // Remove the peer from state
      setPeers(prevPeers => prevPeers.filter(p => p.peerId !== userId));
      
      // Remove the peer's video element
      delete peerVideos.current[userId];
    };

    // Handle get users event
    const handleGetUsers = (users: Array<{ userId: string, userName: string }>) => {
      console.log('Got users:', users);
      
      // Connect to each user
      users.forEach(user => {
        if (user.userId !== socket.id) {
          console.log('Connecting to existing user:', user.userId, user.userName);
          connectToNewUser(user.userId, stream, user.userName);
        }
      });
    };

    // Register event handlers
    socket.on('user-joined', handleUserJoined);
    socket.on('receiving-returned-signal', handleReceivingReturnedSignal);
    socket.on('user-disconnected', handleUserDisconnected);
    socket.on('get-users', handleGetUsers);

    // Clean up event handlers
    return () => {
      socket.off('user-joined', handleUserJoined);
      socket.off('receiving-returned-signal', handleReceivingReturnedSignal);
      socket.off('user-disconnected', handleUserDisconnected);
      socket.off('get-users', handleGetUsers);
    };
  }, [socket, stream, addPeer, connectToNewUser]);

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

  // Render a video for a peer
  const renderPeerVideo = (peer: PeerConnection) => {
    return (
      <Box
        key={peer.peerId}
        className="video-container"
        sx={{
          position: 'relative',
          width: '100%',
          height: '100%',
          borderRadius: '8px',
          overflow: 'hidden',
          backgroundColor: 'rgba(0, 0, 0, 0.2)',
        }}
      >
        <video
          ref={(element) => setPeerVideoRef(peer.peerId, element)}
          autoPlay
          playsInline
          muted={false}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
        
        {/* User info overlay */}
        <Box
          className="user-info"
          sx={{
            position: 'absolute',
            bottom: '10px',
            left: '10px',
            padding: '5px 10px',
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            color: 'white',
            borderRadius: '4px',
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            zIndex: 2,
          }}
        >
          {!peer.stream || peer.stream.getVideoTracks().length === 0 || !peer.stream.getVideoTracks()[0].enabled ? (
            <Avatar sx={{ width: 24, height: 24, backgroundColor: 'primary.main', fontSize: '12px' }}>
              {(peer.userName || 'Guest').charAt(0).toUpperCase()}
            </Avatar>
          ) : null}
          <Typography variant="body2">{peer.userName || 'Guest'}</Typography>
        </Box>
      </Box>
    );
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
          {peers.map((peer) => renderPeerVideo(peer))}
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
