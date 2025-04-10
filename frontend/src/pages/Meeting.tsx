import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
  Grid,
  Divider,
} from '@mui/material';
import {
  Mic as MicIcon,
  MicOff as MicOffIcon,
  Videocam as VideocamIcon,
  VideocamOff as VideocamOffIcon,
  Chat as ChatIcon,
  RecordVoiceOver as RecordVoiceOverIcon,
  VoiceOverOff as VoiceOverOffIcon,
  CallEnd as CallEndIcon,
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
  const { meetingId } = useParams<{ meetingId: string }>();
  const navigate = useNavigate();
  const meetingIdValue = meetingId || '';
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
  const [isLeaveDialogOpen, setIsLeaveDialogOpen] = useState(false);
  const [userName, setUserName] = useState('');
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');
  const [unreadMessages, setUnreadMessages] = useState(0);
  
  const userVideo = useRef<HTMLVideoElement>(null);
  const peersRef = useRef<PeerConnection[]>([]);
  const peerVideos = useRef<{ [key: string]: HTMLVideoElement }>({});
  const myId = useRef<string>('');

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
            socket?.emit('send-transcription', { meetingId: meetingIdValue, text: finalTranscript });
          }
        }
        if (finalTranscript) {
          setTranscript(finalTranscript);
          // Add to user's own transcript
          setTranscripts(prev => ({
            ...prev,
            [myId.current]: finalTranscript
          }));
        }
      };
    }
  }, [meetingIdValue, socket]);

  // Initialize WebSocket connection
  useEffect(() => {
    // Use environment variable with fallback for WebSocket connection
    const socketUrl = process.env.REACT_APP_SOCKET_URL || 'ws://localhost:5001';
    console.log('Connecting to WebSocket at:', socketUrl);
    
    const newSocket = new WebSocket(socketUrl);
    setSocket(newSocket as any); // Cast to any to avoid type issues

    // Log WebSocket connection events
    newSocket.onopen = () => {
      console.log('WebSocket connected successfully');
    };

    newSocket.onmessage = (event: MessageEvent) => {
      const data = JSON.parse(event.data);
      console.log('Received message:', data);
      
      // Handle different message types
      if (data.type === 'join-room') {
        // Handle join room response
      } else if (data.type === 'get-users') {
        // Handle existing users in room
        console.log('Existing users in room:', data.users);
        // Connect to each existing user
        data.users.forEach((user: { id: string, userName: string }) => {
          if (user.id !== myId.current) {
            // Check if we already have a connection to this user
            const existingPeer = peersRef.current.find(p => p.peerId === user.id);
            if (!existingPeer) {
              connectToNewUser(user.id, stream, user.userName);
            }
          }
        });
      } else if (data.type === 'user-connected') {
        // Handle new user connected
        console.log('New user connected:', data.userId, 'Name:', data.userName);
        
        // Check if we already have a connection to this user
        const existingPeer = peersRef.current.find(p => p.peerId === data.userId);
        if (!existingPeer) {
          // Delay connection slightly to ensure both sides are ready
          setTimeout(() => {
            connectToNewUser(data.userId, stream, data.userName);
          }, 1000);
        }
      } else if (data.type === 'user-joined') {
        // Handle user joined with signal
        console.log('User joined with signal:', data.callerID, 'Name:', data.userName);
        
        // Check if we already have a connection to this user
        const existingPeer = peersRef.current.find(p => p.peerId === data.callerID);
        if (existingPeer) {
          console.log('Already have a connection to this user, updating signal');
          existingPeer.peer.signal(data.signal);
        } else {
          const peer = addPeer(data.signal, data.callerID, stream);
          
          // Store the peer connection
          peersRef.current.push({
            peerId: data.callerID,
            peer,
            userName: data.userName,
          });

          // Add the peer to state with or without stream
          setPeers((users) => [...users, { peerId: data.callerID, peer, userName: data.userName }]);
        }
      } else if (data.type === 'receiving-returned-signal') {
        // Handle receiving returned signal
        console.log('Received returned signal from:', data.id);
        const item = peersRef.current.find((p) => p.peerId === data.id);
        if (item) {
          item.peer.signal(data.signal);
        } else {
          console.error('Peer not found for ID:', data.id);
        }
      } else if (data.type === 'user-disconnected') {
        // Handle user disconnected
        console.log('User disconnected:', data.userId);
        const peerObj = peersRef.current.find((p) => p.peerId === data.userId);
        if (peerObj) {
          peerObj.peer.destroy();
        }
        
        // Remove the peer from refs and state
        peersRef.current = peersRef.current.filter((p) => p.peerId !== data.userId);
        setPeers((users) => users.filter((p) => p.peerId !== data.userId));
        
        // Remove transcripts for this user
        setTranscripts(prev => {
          const newTranscripts = { ...prev };
          delete newTranscripts[data.userId];
          return newTranscripts;
        });
      } else if (data.type === 'receive-message') {
        // Handle received message
        console.log('Received message:', data);
        if (!isChatOpen) {
          setUnreadMessages((prev) => prev + 1);
        }
      } else if (data.type === 'receive-transcription') {
        // Handle received transcription
        console.log('Received transcription from:', data.userId, 'Text:', data.text);
        setTranscripts(prev => ({
          ...prev,
          [data.userId]: data.text
        }));
      }
    };

    newSocket.onerror = (event) => {
      console.error('WebSocket connection error:', event);
    };

    newSocket.onclose = () => {
      console.log('WebSocket disconnected');
    };
    
    // Store a reference to the socket ID
    myId.current = generateUniqueId();

    // Clean up on unmount
    return () => {
      newSocket.close();
    };
  }, []);

  // Generate a unique ID for this client
  const generateUniqueId = () => {
    return 'user_' + Math.random().toString(36).substr(2, 9);
  };

  // Handle name submission
  const handleNameSubmit = () => {
    if (userName.trim()) {
      setIsNameDialogOpen(false);
      joinMeeting();
    }
  };

  // Join the meeting
  const joinMeeting = useCallback(() => {
    console.log('Joining meeting:', meetingIdValue);
    
    // Reset state
    setPeers([]);
    peersRef.current = [];
    setTranscripts({});
    setTranscript('');
    
    // Get user media with constraints
    const constraints = {
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: 'user',
      },
      audio: true,
    };

    // First try with ideal constraints
    navigator.mediaDevices.getUserMedia(constraints)
      .then((currentStream) => {
        handleMediaSuccess(currentStream);
      })
      .catch((error) => {
        console.error('Error accessing media devices with ideal constraints:', error);
        console.log('Trying with basic constraints...');
        
        // If that fails, try with basic constraints
        navigator.mediaDevices.getUserMedia({ video: true, audio: true })
          .then((currentStream) => {
            handleMediaSuccess(currentStream);
          })
          .catch((basicError) => {
            console.error('Error accessing media devices with basic constraints:', basicError);
            
            // If that also fails, try with audio only
            console.log('Trying with audio only...');
            navigator.mediaDevices.getUserMedia({ audio: true })
              .then((audioStream) => {
                handleMediaSuccess(audioStream);
                setIsVideoOff(true); // Mark video as off since we're audio-only
              })
              .catch((audioError) => {
                console.error('Error accessing audio devices:', audioError);
                
                // Join without media as a last resort
                console.log('Joining without media');
                handleMediaSuccess(null);
                setIsVideoOff(true);
                setIsMuted(true);
                alert('Could not access camera or microphone. Joining meeting without media.');
              });
          });
      });
  }, [meetingIdValue, userName, socket]);

  // Handle successful media acquisition
  const handleMediaSuccess = useCallback((currentStream: MediaStream | null) => {
    console.log('Got media stream:', currentStream ? currentStream.getTracks().length + ' tracks' : 'no stream');
    
    // Set local stream
    setStream(currentStream);
    
    // Set local video element if we have a stream
    if (currentStream && userVideo.current) {
      userVideo.current.srcObject = currentStream;
      userVideo.current.muted = true; // Mute local video to prevent feedback
      userVideo.current.play().catch(err => {
        console.error('Error playing local video:', err);
      });
    }

    // Join room with user information
    if (socket) {
      socket.send(JSON.stringify({
        type: 'join-room',
        meetingId: meetingIdValue,
        userId: myId.current,
        userName,
      }));
      console.log('Joined room:', meetingIdValue, 'as', userName, 'with ID:', myId.current);
    }
  }, [meetingIdValue, userName, socket]);

  // Connect to a new user
  const connectToNewUser = useCallback((userToSignal: string, stream: MediaStream | null, remoteUserName: string) => {
    console.log('Connecting to new user:', userToSignal, 'Name:', remoteUserName);
    
    // Check if we already have a connection to this peer
    const existingPeer = peersRef.current.find(p => p.peerId === userToSignal);
    if (existingPeer) {
      console.log('Already connected to this peer, skipping');
      return existingPeer.peer;
    }
    
    const peer = new Peer({
      initiator: true,
      trickle: true,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478?transport=udp' },
          {
            urls: 'turn:global.turn.twilio.com:3478?transport=udp',
            username: 'f4b4035eaa76f4a55de5f4351567653ee4ff6fa97b50b6b334fcc1be9c27212d',
            credential: 'w1WpauEiFbhP61/V5WzHo/6qtXgDO4jllb5MByAh0+8='
          },
          {
            urls: 'turn:global.turn.twilio.com:3478?transport=tcp',
            username: 'f4b4035eaa76f4a55de5f4351567653ee4ff6fa97b50b6b334fcc1be9c27212d',
            credential: 'w1WpauEiFbhP61/V5WzHo/6qtXgDO4jllb5MByAh0+8='
          },
          {
            urls: 'turn:global.turn.twilio.com:443?transport=tcp',
            username: 'f4b4035eaa76f4a55de5f4351567653ee4ff6fa97b50b6b334fcc1be9c27212d',
            credential: 'w1WpauEiFbhP61/V5WzHo/6qtXgDO4jllb5MByAh0+8='
          }
        ]
      }
    });

    // Add the stream to the peer if available
    if (stream) {
      try {
        stream.getTracks().forEach(track => {
          peer.addTrack(track, stream);
        });
        console.log('Added local tracks to peer:', stream.getTracks().length);
      } catch (err) {
        console.error('Error adding tracks to peer:', err);
      }
    } else {
      console.log('No local stream to add to peer');
    }

    // Handle peer events
    peer.on('signal', (data) => {
      console.log('Generated signal as initiator for:', userToSignal);
      if (socket) {
        socket.send(JSON.stringify({
          type: 'sending-signal',
          userToSignal: userToSignal,
          callerID: myId.current,
          signal: data,
          userName,
        }));
      }
    });

    peer.on('connect', () => {
      console.log('Peer connection established with:', userToSignal);
    });

    peer.on('error', (err) => {
      console.error('Peer connection error with:', userToSignal, err);
    });

    peer.on('close', () => {
      console.log('Peer connection closed with:', userToSignal);
    });

    // Critical: Handle the 'stream' event to receive remote streams
    peer.on('stream', (remoteStream) => {
      console.log('Received stream from peer:', userToSignal, 'Tracks:', remoteStream.getTracks().length);
      console.log('Video tracks:', remoteStream.getVideoTracks().length);
      console.log('Audio tracks:', remoteStream.getAudioTracks().length);
      
      // Update peers state with the stream
      setPeers(prevPeers => {
        const updatedPeers = prevPeers.map(p => {
          if (p.peerId === userToSignal) {
            console.log('Updating peer with stream:', userToSignal);
            return { ...p, stream: remoteStream };
          }
          return p;
        });
        return updatedPeers;
      });
      
      // Also update the ref
      const peerRef = peersRef.current.find(p => p.peerId === userToSignal);
      if (peerRef) {
        peerRef.stream = remoteStream;
      }
      
      // Directly set the stream to the video element if it exists
      const videoElement = peerVideos.current[userToSignal];
      if (videoElement) {
        console.log('Directly setting stream to existing video element for peer:', userToSignal);
        videoElement.srcObject = remoteStream;
        videoElement.play().catch(err => {
          console.error(`Error playing video for ${userToSignal}:`, err);
        });
      } else {
        console.log('Video element not yet available for peer:', userToSignal);
      }
    });

    // Store the peer in refs
    peersRef.current.push({
      peerId: userToSignal,
      peer,
      userName: remoteUserName,
    });

    // Add the peer to state
    setPeers(prevPeers => [...prevPeers, { peerId: userToSignal, peer, userName: remoteUserName }]);

    return peer;
  }, [socket, userName]);

  // Add a peer connection as the receiver
  const addPeer = useCallback((incomingSignal: any, callerID: string, stream: MediaStream | null) => {
    console.log('Adding peer as receiver for:', callerID);
    
    // Check if we already have a connection to this peer
    const existingPeer = peersRef.current.find(p => p.peerId === callerID);
    if (existingPeer) {
      console.log('Already have a connection to this peer, updating signal');
      try {
        existingPeer.peer.signal(incomingSignal);
      } catch (err) {
        console.error('Error signaling existing peer:', err);
      }
      return existingPeer.peer;
    }
    
    const peer = new Peer({
      initiator: false,
      trickle: true,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478?transport=udp' },
          {
            urls: 'turn:global.turn.twilio.com:3478?transport=udp',
            username: 'f4b4035eaa76f4a55de5f4351567653ee4ff6fa97b50b6b334fcc1be9c27212d',
            credential: 'w1WpauEiFbhP61/V5WzHo/6qtXgDO4jllb5MByAh0+8='
          },
          {
            urls: 'turn:global.turn.twilio.com:3478?transport=tcp',
            username: 'f4b4035eaa76f4a55de5f4351567653ee4ff6fa97b50b6b334fcc1be9c27212d',
            credential: 'w1WpauEiFbhP61/V5WzHo/6qtXgDO4jllb5MByAh0+8='
          },
          {
            urls: 'turn:global.turn.twilio.com:443?transport=tcp',
            username: 'f4b4035eaa76f4a55de5f4351567653ee4ff6fa97b50b6b334fcc1be9c27212d',
            credential: 'w1WpauEiFbhP61/V5WzHo/6qtXgDO4jllb5MByAh0+8='
          }
        ]
      }
    });

    // Add the stream to the peer if available
    if (stream) {
      try {
        stream.getTracks().forEach(track => {
          peer.addTrack(track, stream);
        });
        console.log('Added local tracks to peer:', stream.getTracks().length);
      } catch (err) {
        console.error('Error adding tracks to peer:', err);
      }
    } else {
      console.log('No local stream to add to peer');
    }

    // Signal the peer with the incoming signal
    try {
      peer.signal(incomingSignal);
    } catch (err) {
      console.error('Error signaling peer:', err);
    }

    // Handle peer events
    peer.on('signal', (data) => {
      console.log('Generated signal as receiver for:', callerID);
      if (socket) {
        socket.send(JSON.stringify({
          type: 'returning-signal',
          signal: data,
          callerID,
        }));
      }
    });

    peer.on('connect', () => {
      console.log('Peer connection established with:', callerID);
    });

    peer.on('error', (err) => {
      console.error('Peer connection error with:', callerID, err);
    });

    peer.on('close', () => {
      console.log('Peer connection closed with:', callerID);
    });

    // Critical: Handle the 'stream' event to receive remote streams
    peer.on('stream', (remoteStream) => {
      console.log('Received stream from peer:', callerID, 'Tracks:', remoteStream.getTracks().length);
      console.log('Video tracks:', remoteStream.getVideoTracks().length);
      console.log('Audio tracks:', remoteStream.getAudioTracks().length);
      
      // Update peers state with the stream
      setPeers(prevPeers => {
        const updatedPeers = prevPeers.map(p => {
          if (p.peerId === callerID) {
            console.log('Updating peer with stream:', callerID);
            return { ...p, stream: remoteStream };
          }
          return p;
        });
        return updatedPeers;
      });
      
      // Also update the ref
      const peerRef = peersRef.current.find(p => p.peerId === callerID);
      if (peerRef) {
        peerRef.stream = remoteStream;
      }
      
      // Directly set the stream to the video element if it exists
      const videoElement = peerVideos.current[callerID];
      if (videoElement) {
        console.log('Directly setting stream to existing video element for peer:', callerID);
        videoElement.srcObject = remoteStream;
        videoElement.play().catch(err => {
          console.error(`Error playing video for ${callerID}:`, err);
        });
      } else {
        console.log('Video element not yet available for peer:', callerID);
      }
    });

    return peer;
  }, [socket]);

  // Set video reference for a peer
  const setPeerVideoRef = (peerId: string, element: HTMLVideoElement | null) => {
    if (element) {
      console.log('Setting video ref for peer:', peerId);
      
      // Store the element in our ref map
      peerVideos.current[peerId] = element;
      
      // Find the peer and its stream
      const peer = peers.find(p => p.peerId === peerId);
      
      // If we have a stream for this peer, set it to the video element
      if (peer && peer.stream) {
        console.log('Setting stream to video element for peer:', peerId, 'Tracks:', peer.stream.getTracks().length);
        console.log('Video tracks:', peer.stream.getVideoTracks().length);
        console.log('Audio tracks:', peer.stream.getAudioTracks().length);
        
        // Only set if not already set to avoid unnecessary reattachment
        if (element.srcObject !== peer.stream) {
          element.srcObject = peer.stream;
          
          // Add event listeners to handle playback issues
          element.onloadedmetadata = () => {
            console.log('Video metadata loaded for peer:', peerId);
            element.play().catch(err => {
              console.error(`Error playing video for ${peerId}:`, err);
            });
          };
          
          // Try to play the video
          element.play().catch(err => {
            console.error(`Error playing video for ${peerId}:`, err);
          });
        }
      } else {
        console.log('No stream available yet for peer:', peerId);
      }
    }
  };

  // Render a peer video
  const renderPeerVideo = (peer: PeerConnection) => {
    console.log('Rendering peer video for:', peer.peerId, 'Has stream:', !!peer.stream);
    if (peer.stream) {
      console.log('Stream tracks:', peer.stream.getTracks().length);
      console.log('Video tracks:', peer.stream.getVideoTracks().length);
      console.log('Audio tracks:', peer.stream.getAudioTracks().length);
    }
    
    return (
      <Box
        key={peer.peerId}
        className="video-container"
        sx={{
          position: 'relative',
          borderRadius: '8px',
          overflow: 'hidden',
          backgroundColor: '#1a1a1a',
        }}
      >
        {/* Video element */}
        <video
          key={`video-${peer.peerId}`}
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
        
        {/* Fallback when no video */}
        {(!peer.stream || 
          !peer.stream.getVideoTracks().length || 
          !peer.stream.getVideoTracks()[0].enabled) && (
          <Box
            sx={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#1a1a1a',
              zIndex: 1,
            }}
          >
            <Avatar
              sx={{
                width: '80px',
                height: '80px',
                fontSize: '32px',
                backgroundColor: 'primary.main',
              }}
            >
              {(peer.userName || 'Guest').charAt(0).toUpperCase()}
            </Avatar>
          </Box>
        )}
        
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
    const url = `${window.location.origin}/meeting/${meetingIdValue}`;
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
    const url = `${window.location.origin}/meeting/${meetingIdValue}`;
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

  // Handle leaving the meeting
  const handleLeaveMeeting = useCallback(() => {
    console.log('Leaving meeting:', meetingIdValue);
    
    // Stop all tracks in the stream
    if (stream) {
      stream.getTracks().forEach(track => {
        track.stop();
      });
    }
    
    // Disconnect from WebSocket
    if (socket) {
      socket.close();
    }
    
    // Navigate back to home
    navigate('/');
    
  }, [meetingIdValue, stream, socket, navigate]);

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Meeting header */}
      <Box className="meeting-header">
        <Typography variant="h6">Meeting: {meetingIdValue}</Typography>
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
          <Tooltip title="Leave Meeting">
            <IconButton 
              color="error" 
              onClick={() => setIsLeaveDialogOpen(true)}
              className="leave-meeting-button"
              sx={{ 
                ml: 1,
                backgroundColor: 'rgba(244, 67, 54, 0.1)',
                '&:hover': {
                  backgroundColor: 'rgba(244, 67, 54, 0.2)',
                }
              }}
            >
              <CallEndIcon />
            </IconButton>
          </Tooltip>
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
              const name = userId === myId.current ? userName : (user?.userName || 'Guest');
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
        {socket && <Chat socket={socket} meetingId={meetingIdValue} userName={userName} />}
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
            value={`${window.location.origin}/meeting/${meetingIdValue}`}
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

      {/* Leave dialog */}
      <Dialog 
        open={isLeaveDialogOpen} 
        onClose={() => setIsLeaveDialogOpen(false)} 
        maxWidth="xs" 
        fullWidth
      >
        <DialogTitle>Leave Meeting</DialogTitle>
        <DialogContent>
          <Typography variant="body2" gutterBottom>
            Are you sure you want to leave the meeting?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIsLeaveDialogOpen(false)} color="primary">
            Cancel
          </Button>
          <Button onClick={handleLeaveMeeting} color="error">
            Leave
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
