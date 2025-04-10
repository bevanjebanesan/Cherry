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
  const { meetingId = '' } = useParams<{ meetingId?: string }>();
  const navigate = useNavigate();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [me, setMe] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [peers, setPeers] = useState<PeerConnection[]>([]);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [micEnabled, setMicEnabled] = useState<boolean>(true);
  const [videoEnabled, setVideoEnabled] = useState<boolean>(true);
  const [isScreenSharing, setIsScreenSharing] = useState<boolean>(false);
  const [messageInput, setMessageInput] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatOpen, setChatOpen] = useState<boolean>(false);
  const [participantsOpen, setParticipantsOpen] = useState<boolean>(false);
  const [nameDialogOpen, setNameDialogOpen] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [showSnackbar, setShowSnackbar] = useState<boolean>(false);
  const [userCount, setUserCount] = useState<number>(0);

  const myVideo = useRef<HTMLVideoElement>(null);
  const screenVideo = useRef<HTMLVideoElement>(null);
  const peersRef = useRef<PeerConnection[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
    const newSocket = io(socketUrl);
    socketRef.current = newSocket;
    setSocket(newSocket);

    // Get user media (camera and microphone)
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then((currentStream) => {
        setStream(currentStream);
        if (myVideo.current) {
          myVideo.current.srcObject = currentStream;
        }

        // Join the meeting once we have the stream
        if (meetingId && name) {
          newSocket.emit("join-meeting", { meetingId, userName: name });
        }

        // Handle receiving the list of users already in the room
        newSocket.on("all-users", (users: string[]) => {
          console.log("Received all users:", users);
          
          const peers: PeerConnection[] = [];
          
          // Create a peer connection for each existing user
          users.forEach(userID => {
            const peer = createPeer(userID, newSocket.id, currentStream);
            peersRef.current.push({
              peerID: userID,
              peer
            });
            peers.push({
              peerID: userID,
              peer
            });
          });
          
          setPeers(peers);
        });

        // Handle a new user joining
        newSocket.on("user-joined", ({ signal, callerID }) => {
          console.log("User joined:", callerID);
          
          // If this is a new user without a signal, they just joined and we don't need to do anything
          // They will create a peer to us and send a signal later
          if (!signal) return;
          
          // Otherwise, this is a signal from a new user
          const peer = addPeer(signal, callerID, currentStream);
          
          peersRef.current.push({
            peerID: callerID,
            peer
          });
          
          setPeers(peers => [...peers, { peerID: callerID, peer }]);
        });

        // Handle receiving a returned signal
        newSocket.on("receiving-returned-signal", ({ signal, id }) => {
          console.log("Received returned signal from:", id);
          const item = peersRef.current.find(p => p.peerID === id);
          if (item) {
            item.peer.signal(signal);
          }
        });

        // Handle a user disconnecting
        newSocket.on("user-disconnected", (id: string) => {
          console.log("User disconnected:", id);
          const peerObj = peersRef.current.find(p => p.peerID === id);
          if (peerObj) {
            peerObj.peer.destroy();
          }
          
          peersRef.current = peersRef.current.filter(p => p.peerID !== id);
          setPeers(peers => peers.filter(p => p.peerID !== id));
        });
      })
      .catch((error) => {
        console.error('Error accessing media devices:', error);
        setError('Error accessing your camera and microphone. Please make sure they are connected and permissions are granted.');
      });

    // Cleanup on component unmount
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      if (stream) {
        stream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
      }
      if (screenStream) {
        screenStream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
      }
      
      // Destroy all peer connections
      peersRef.current.forEach(peerObj => {
        if (peerObj.peer) {
          peerObj.peer.destroy();
        }
      });
    };
  }, [meetingId, name]);

  // Function to create a peer as the initiator (for existing users in the room)
  const createPeer = (userToSignal: string, callerID: string, stream: MediaStream) => {
    console.log(`Creating peer connection to ${userToSignal} as initiator`);
    
    const peer = new Peer({
      initiator: true,
      trickle: false,
      stream,
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

    peer.on('signal', (signal) => {
      if (socketRef.current) {
        console.log(`Sending signal to ${userToSignal}`);
        socketRef.current.emit('sending-signal', { userToSignal, callerID, signal });
      }
    });

    peer.on('stream', (remoteStream) => {
      console.log(`Received stream from ${userToSignal}`);
    });

    peer.on('error', (err) => {
      console.error(`Peer connection error with ${userToSignal}:`, err);
      setError(`Connection error with a participant. They may need to rejoin.`);
    });

    return peer;
  };

  // Function to add a peer as the non-initiator (when we receive a signal)
  const addPeer = (incomingSignal: Peer.SignalData, callerID: string, stream: MediaStream) => {
    console.log(`Adding peer connection from ${callerID} as non-initiator`);
    
    const peer = new Peer({
      initiator: false,
      trickle: false,
      stream,
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

    peer.on('signal', (signal) => {
      if (socketRef.current) {
        console.log(`Returning signal to ${callerID}`);
        socketRef.current.emit('returning-signal', { callerID, signal });
      }
    });

    peer.on('stream', (remoteStream) => {
      console.log(`Received stream from ${callerID}`);
    });

    peer.on('error', (err) => {
      console.error(`Peer connection error with ${callerID}:`, err);
      setError(`Connection error with a participant. They may need to rejoin.`);
    });

    // Signal the peer with the incoming signal
    peer.signal(incomingSignal);

    return peer;
  };

  // When the user enters their name and joins the meeting
  const joinMeeting = () => {
    if (!name.trim() || !socketRef.current || !meetingId) {
      return;
    }
    
    setNameDialogOpen(false);
    
    // Join the meeting with our name
    socketRef.current.emit("join-meeting", { meetingId, userName: name });
  };

  // Function to set up video element for peer
  const setPeerVideoRef = (peerID: string, element: HTMLVideoElement | null) => {
    if (!element) return;

    const peerObj = peersRef.current.find(p => p.peerID === peerID);
    if (!peerObj || !peerObj.peer) {
      console.log(`No peer found for ID ${peerID}`);
      return;
    }

    console.log(`Setting up video element for peer ${peerID}`);
    
    // Check if the peer already has a stream
    const peer = peerObj.peer;
    
    // If the peer has a _remoteStreams property (from simple-peer), use that
    if ((peer as any)._remoteStreams && (peer as any)._remoteStreams.length > 0) {
      const stream = (peer as any)._remoteStreams[0];
      console.log(`Found existing stream for peer ${peerID}, attaching to video element`);
      element.srcObject = stream;
      
      // Ensure autoplay works
      element.play().catch(err => {
        console.error(`Error playing video for peer ${peerID}:`, err);
        // Try again with user interaction
        element.setAttribute('autoplay', 'true');
        element.setAttribute('playsinline', 'true');
      });
    }
    
    // Set up listener for future streams
    peer.on('stream', (stream: MediaStream) => {
      console.log(`Received stream for peer ${peerID}, attaching to video element`);
      if (element.srcObject !== stream) {
        element.srcObject = stream;
        
        // Ensure autoplay works
        element.play().catch(err => {
          console.error(`Error playing video for peer ${peerID}:`, err);
          // Try again with user interaction
          element.setAttribute('autoplay', 'true');
          element.setAttribute('playsinline', 'true');
        });
      }
    });
  };

  // Function to render a peer's video
  const renderPeerVideo = (peerObj: PeerConnection) => {
    return (
      <Box 
        key={peerObj.peerID} 
        sx={{ 
          position: 'relative', 
          width: '100%', 
          height: '100%',
          borderRadius: 2,
          overflow: 'hidden',
          backgroundColor: '#2D2D2D'
        }}
      >
        <video
          ref={element => setPeerVideoRef(peerObj.peerID, element)}
          autoPlay
          playsInline
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover'
          }}
        />
        <Typography 
          variant="subtitle1" 
          sx={{ 
            position: 'absolute', 
            bottom: 8, 
            left: 8, 
            color: 'white',
            backgroundColor: 'rgba(0,0,0,0.5)',
            padding: '2px 8px',
            borderRadius: 1
          }}
        >
          {peerObj.name || 'Participant'}
        </Typography>
      </Box>
    );
  };

  // Send a chat message
  const sendMessage = () => {
    if (!messageInput.trim() || !socketRef.current || !meetingId) return;
    
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const messageObj = {
      message: messageInput,
      sender: name || 'Me', 
      time,
      fromMe: true
    };
    
    setMessages(prevMessages => [...prevMessages, messageObj]);
    socketRef.current.emit('send-message', { 
      roomID: String(meetingId), 
      message: messageInput,
      sender: name || 'Me', 
      time
    });
    
    setMessageInput('');
  };

  // Auto-scroll chat messages
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Add chat message handler to socket
  useEffect(() => {
    if (!socketRef.current) return;

    const handleReceiveMessage = ({ sender, message, time }: { sender: string, message: string, time: string }) => {
      setMessages(prevMessages => [...prevMessages, { sender, message, time, fromMe: false }]);
      if (!chatOpen) {
        setShowSnackbar(true);
      }
    };

    socketRef.current.on('receive-message', handleReceiveMessage);

    return () => {
      if (socketRef.current) {
        socketRef.current.off('receive-message', handleReceiveMessage);
      }
    };
  }, [chatOpen]);

  // Toggle microphone
  const toggleMic = () => {
    if (stream) {
      stream.getAudioTracks().forEach((track: MediaStreamTrack) => {
        track.enabled = !micEnabled;
      });
      setMicEnabled(!micEnabled);
    }
  };

  // Toggle camera
  const toggleVideo = () => {
    if (stream) {
      stream.getVideoTracks().forEach((track: MediaStreamTrack) => {
        track.enabled = !videoEnabled;
      });
      setVideoEnabled(!videoEnabled);
    }
  };

  // Start or stop screen sharing
  const toggleScreenShare = () => {
    if (!isScreenSharing) {
      navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
        .then(screenStream => {
          setScreenStream(screenStream);
          if (screenVideo.current) {
            screenVideo.current.srcObject = screenStream;
          }
          
          // Replace video track for all peers
          peersRef.current.forEach(({ peer }) => {
            const videoTrack = screenStream.getVideoTracks()[0];
            // Access senders through the RTCPeerConnection
            const senders = (peer as any)._pc?.getSenders();
            const sender = senders?.find((s: RTCRtpSender) => s.track?.kind === 'video');
            if (sender) {
              sender.replaceTrack(videoTrack);
            }
          });
          
          setIsScreenSharing(true);
          
          // Listen for screen sharing to end
          screenStream.getVideoTracks()[0].onended = () => {
            stopScreenSharing();
          };
        })
        .catch(error => {
          console.error('Error starting screen share:', error);
          setError('Failed to start screen sharing.');
        });
    } else {
      stopScreenSharing();
    }
  };

  // Stop screen sharing
  const stopScreenSharing = () => {
    if (screenStream) {
      screenStream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
      
      // Replace screen track with camera track for all peers
      if (stream) {
        const videoTrack = stream.getVideoTracks()[0];
        peersRef.current.forEach(({ peer }) => {
          // Access senders through the RTCPeerConnection
          const senders = (peer as any)._pc?.getSenders();
          const sender = senders?.find((s: RTCRtpSender) => s.track?.kind === 'video');
          if (sender && videoTrack) {
            sender.replaceTrack(videoTrack);
          }
        });
      }
      
      setScreenStream(null);
      setIsScreenSharing(false);
    }
  };

  // Leave the meeting
  const leaveMeeting = () => {
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
    if (stream) {
      stream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
    }
    if (screenStream) {
      screenStream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
    }
    
    navigate('/');
  };

  // Layout for different numbers of participants
  const getGridLayout = () => {
    const count = peers.length + 1; // Including local video
    if (count === 1) {
      return { 
        gridTemplateColumns: '1fr',
        gridTemplateRows: '1fr',
      };
    } else if (count === 2) {
      return { 
        gridTemplateColumns: '1fr 1fr',
        gridTemplateRows: '1fr',
      };
    } else if (count <= 4) {
      return { 
        gridTemplateColumns: '1fr 1fr',
        gridTemplateRows: '1fr 1fr',
      };
    } else {
      return { 
        gridTemplateColumns: 'repeat(3, 1fr)',
        gridTemplateRows: 'repeat(2, 1fr)',
      };
    }
  };

  return (
    <Container maxWidth={false} sx={{ 
      height: '100vh', 
      padding: 0, 
      display: 'flex', 
      flexDirection: 'column',
      backgroundColor: '#1A1A1A'
    }}>
      {/* Meeting header */}
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
          <IconButton onClick={() => setChatOpen(true)} color="inherit">
            <Chat />
          </IconButton>
          <IconButton onClick={() => setParticipantsOpen(true)} color="inherit">
            <People />
          </IconButton>
        </Box>
      </Box>

      {/* Video grid */}
      <Box sx={{ 
        flex: 1, 
        padding: 2, 
        display: 'grid', 
        gap: 2,
        ...getGridLayout(),
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
          {isScreenSharing ? (
            <video
              ref={screenVideo}
              muted
              autoPlay
              playsInline
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: videoEnabled ? 'block' : 'none'
              }}
            />
          ) : (
            <video
              ref={myVideo}
              muted
              autoPlay
              playsInline
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: videoEnabled ? 'block' : 'none'
              }}
            />
          )}
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
            {name || 'Me'} {!videoEnabled && '(Video Off)'}
          </Box>
        </Box>

        {/* Remote videos */}
        {peers.map(renderPeerVideo)}
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
          onClick={toggleMic} 
          sx={{ backgroundColor: micEnabled ? 'rgba(255,255,255,0.1)' : 'red', color: 'white' }}
        >
          {micEnabled ? <Mic /> : <MicOff />}
        </IconButton>
        
        <IconButton 
          onClick={toggleVideo} 
          sx={{ backgroundColor: videoEnabled ? 'rgba(255,255,255,0.1)' : 'red', color: 'white' }}
        >
          {videoEnabled ? <Videocam /> : <VideocamOff />}
        </IconButton>
        
        <IconButton 
          onClick={toggleScreenShare} 
          sx={{ backgroundColor: isScreenSharing ? 'green' : 'rgba(255,255,255,0.1)', color: 'white' }}
        >
          {isScreenSharing ? <StopScreenShare /> : <ScreenShare />}
        </IconButton>
        
        <IconButton 
          onClick={leaveMeeting} 
          sx={{ backgroundColor: 'red', color: 'white' }}
        >
          <CallEnd />
        </IconButton>
      </Box>

      {/* Name dialog */}
      <Dialog open={nameDialogOpen} onClose={() => {}} disableEscapeKeyDown>
        <DialogTitle>Enter your name</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Your Name"
            fullWidth
            variant="outlined"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter') joinMeeting();
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={joinMeeting} color="primary" disabled={!name.trim()}>
            Join Meeting
          </Button>
        </DialogActions>
      </Dialog>

      {/* Chat drawer */}
      <Drawer
        anchor="right"
        open={chatOpen}
        onClose={() => setChatOpen(false)}
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
            <IconButton onClick={() => setChatOpen(false)} sx={{ color: 'white' }}>
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
                if (e.key === 'Enter') sendMessage();
              }}
            />
            <Button 
              variant="contained" 
              color="primary" 
              onClick={sendMessage}
              disabled={!messageInput.trim()}
            >
              Send
            </Button>
          </Box>
        </Box>
      </Drawer>

      {/* Participants drawer */}
      <Drawer
        anchor="right"
        open={participantsOpen}
        onClose={() => setParticipantsOpen(false)}
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
            <Typography variant="h6">Participants ({userCount})</Typography>
            <IconButton onClick={() => setParticipantsOpen(false)} sx={{ color: 'white' }}>
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
            <Paper sx={{ padding: 1 }}>
              <Typography variant="body1">{name || 'Me'} (You)</Typography>
            </Paper>
            
            {peers.map((peer) => (
              <Paper key={peer.peerID} sx={{ padding: 1 }}>
                <Typography variant="body1">{peer.name || 'Participant'}</Typography>
              </Paper>
            ))}
          </Box>
        </Box>
      </Drawer>

      {/* Error snackbar */}
      {error && (
        <Snackbar open={true} autoHideDuration={6000} onClose={() => setError(null)}>
          <Alert onClose={() => setError(null)} severity="error">
            {error}
          </Alert>
        </Snackbar>
      )}

      {/* New message notification */}
      <Snackbar 
        open={showSnackbar} 
        autoHideDuration={3000} 
        onClose={() => setShowSnackbar(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Alert onClose={() => setShowSnackbar(false)} severity="info">
          New message received
        </Alert>
      </Snackbar>
    </Container>
  );
};

export default Meeting;
