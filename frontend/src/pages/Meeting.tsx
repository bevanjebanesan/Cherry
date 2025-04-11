import React, { useEffect, useState, useRef } from "react";
import { useParams } from "react-router-dom";
import { io, Socket } from "socket.io-client";
import * as mediasoupClient from "mediasoup-client";
import { useNavigate } from "react-router-dom";
import "../styles/Meeting.css";

interface MeetingProps {}

interface Message {
  sender: string;
  message: string;
  time: string;
  fromMe?: boolean;
}

interface Participant {
  id: string;
  name: string;
  videoStream?: MediaStream;
  audioEnabled: boolean;
  videoEnabled: boolean;
}

interface WaitingRoomParticipant {
  id: string;
  name: string;
}

const Meeting: React.FC<MeetingProps> = () => {
  const { meetingId } = useParams<{ meetingId: string }>();
  const navigate = useNavigate();
  const [userName, setUserName] = useState<string>("");
  const [isNameSubmitted, setIsNameSubmitted] = useState<boolean>(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isAudioMuted, setIsAudioMuted] = useState<boolean>(false);
  const [isVideoOff, setIsVideoOff] = useState<boolean>(false);
  const [isScreenSharing, setIsScreenSharing] = useState<boolean>(false);
  const [isChatOpen, setIsChatOpen] = useState<boolean>(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState<string>("");
  const [isHost, setIsHost] = useState<boolean>(false);
  const [waitingRoomParticipants, setWaitingRoomParticipants] = useState<WaitingRoomParticipant[]>([]);
  const [inWaitingRoom, setInWaitingRoom] = useState<boolean>(false);
  
  // Mediasoup related state
  const [device, setDevice] = useState<mediasoupClient.Device | null>(null);
  const [sendTransport, setSendTransport] = useState<mediasoupClient.types.Transport | null>(null);
  const [recvTransport, setRecvTransport] = useState<mediasoupClient.types.Transport | null>(null);
  const [producers, setProducers] = useState<Map<string, mediasoupClient.types.Producer>>(new Map());
  const [consumers, setConsumers] = useState<Map<string, mediasoupClient.types.Consumer>>(new Map());
  
  // Refs
  const socketRef = useRef<Socket | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const screenShareStreamRef = useRef<MediaStream | null>(null);
  const originalStreamRef = useRef<MediaStream | null>(null);

  // Connect to socket server
  useEffect(() => {
    // Connect to socket server
    const socketUrl = window.location.hostname === 'localhost' ? 'http://localhost:5000' : 'https://cherry-backend.onrender.com';
    socketRef.current = io(socketUrl, {
      transports: ["websocket", "polling"], // Allow fallback to polling if websocket fails
      upgrade: true, // Allow transport upgrade
    });

    // Clean up on component unmount
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      
      // Close all mediasoup transports
      if (sendTransport) {
        sendTransport.close();
      }
      if (recvTransport) {
        recvTransport.close();
      }
      
      // Stop local stream
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
      
      // Stop screen sharing if active
      if (screenShareStreamRef.current) {
        screenShareStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Socket event listeners
  useEffect(() => {
    if (!socketRef.current || !isNameSubmitted) return;
    
    // Handle new participant joining
    socketRef.current.on("participantJoined", (data: { id: string; name: string }) => {
      console.log(`Participant joined: ${data.name} (${data.id})`);
      
      // Add the new participant to the list
      setParticipants(prevParticipants => [
        ...prevParticipants,
        {
          id: data.id,
          name: data.name,
          audioEnabled: true,
          videoEnabled: true,
        }
      ]);
    });
    
    // Handle participant leaving
    socketRef.current.on("participantLeft", (data: { id: string }) => {
      console.log(`Participant left: ${data.id}`);
      
      // Remove the participant from the list
      setParticipants(prevParticipants => 
        prevParticipants.filter(p => p.id !== data.id)
      );
    });
    
    // Handle new producer
    socketRef.current.on("newProducer", (data: { producerId: string; producerSocketId: string; kind: string }) => {
      console.log(`New producer: ${data.producerId} (${data.kind}) from ${data.producerSocketId}`);
      
      // Consume the new producer
      consumeStream(data.producerId);
    });
    
    // Handle chat messages
    socketRef.current.on("receive-message", (data: Message) => {
      console.log(`Received message from ${data.sender}: ${data.message}`);
      
      // Add the message to the list
      setMessages(prevMessages => [...prevMessages, {
        ...data,
        fromMe: false
      }]);
      
      // Scroll to bottom
      if (chatContainerRef.current) {
        setTimeout(() => {
          chatContainerRef.current!.scrollTop = chatContainerRef.current!.scrollHeight;
        }, 0);
      }
    });
    
    // Handle waiting room updates
    socketRef.current.on("waitingRoomUpdated", (participants: WaitingRoomParticipant[]) => {
      console.log(`Waiting room updated: ${participants.length} participants`);
      setWaitingRoomParticipants(participants);
    });
    
    // Clean up on component unmount
    return () => {
      if (socketRef.current) {
        socketRef.current.off("participantJoined");
        socketRef.current.off("participantLeft");
        socketRef.current.off("newProducer");
        socketRef.current.off("receive-message");
        socketRef.current.off("waitingRoomUpdated");
      }
    };
  }, [socketRef.current, isNameSubmitted]);

  // Handle chat container scrolling
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  // Initialize user media and join room
  const initializeUserMedia = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      
      setLocalStream(stream);
      originalStreamRef.current = stream;
      
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      
      // Join the room
      // joinRoom();
      
      return stream;
    } catch (error) {
      console.error("Error accessing media devices:", error);
      alert("Failed to access camera and microphone. Please check permissions.");
      return null;
    }
  };

  // Join the meeting room
  const joinRoom = () => {
    if (!socketRef.current || !meetingId || !userName) return;
    
    console.log(`Joining room: ${meetingId} as ${userName}`);
    
    socketRef.current.emit("joinRoom", { roomId: meetingId, name: userName }, async (response: any) => {
      if (response.success) {
        console.log("Successfully joined room");
        
        if (response.inWaitingRoom) {
          console.log("You are in the waiting room");
          setInWaitingRoom(true);
        } else {
          // Set host status if applicable
          if (response.isHost) {
            setIsHost(true);
          }
          
          // Load the device with router RTP capabilities
          await loadDevice(response.routerRtpCapabilities);
        }
      } else {
        console.error("Failed to join room:", response.error);
        alert(`Failed to join meeting: ${response.error}`);
        navigate("/");
      }
    });
  };

  // Create a new room as host
  const createRoom = () => {
    if (!socketRef.current || !meetingId || !userName) return;
    
    console.log(`Creating room: ${meetingId} as ${userName}`);
    
    socketRef.current.emit("createRoom", { roomId: meetingId, name: userName }, async (response: any) => {
      if (response.success) {
        console.log("Successfully created room as host");
        setIsHost(true);
        
        // Load the device with router RTP capabilities
        await loadDevice(response.routerRtpCapabilities);
      } else {
        console.error("Failed to create room:", response.error);
        alert(`Failed to create meeting: ${response.error}`);
        navigate("/");
      }
    });
  };

  // Load the mediasoup device
  const loadDevice = async (routerRtpCapabilities: any) => {
    try {
      console.log("Loading mediasoup device");
      
      // Create a new device
      const newDevice = new mediasoupClient.Device();
      
      // Load the device with router RTP capabilities
      await newDevice.load({ routerRtpCapabilities });
      
      setDevice(newDevice);
      
      console.log("Device loaded successfully");
      
      // Create send and receive transports
      const sendTransport = await createSendTransport();
      console.log("Send transport created:", sendTransport?.id);
      
      const recvTransport = await createRecvTransport();
      console.log("Receive transport created:", recvTransport?.id);
      
      // If we have a local stream, produce it
      if (localStream && sendTransport) {
        await produceStreams(sendTransport, localStream);
      }
      
      // Get all producers in the room to consume
      socketRef.current?.emit("getProducers", { roomId: meetingId }, (response: { success: boolean; producers?: any[]; error?: string }) => {
        if (response.success && response.producers) {
          response.producers.forEach(producer => {
            consumeStream(producer.id);
          });
        }
      });
    } catch (error) {
      console.error("Error loading device:", error);
    }
  };

  // Create a WebRTC transport for sending media
  const createSendTransport = async () => {
    if (!socketRef.current || !meetingId || !device) return null;
    
    console.log("Creating send transport");
    
    return new Promise<mediasoupClient.types.Transport>((resolve, reject) => {
      socketRef.current!.emit("createWebRtcTransport", {
        roomId: meetingId,
        consuming: false,
      }, async (response: { success: boolean; params?: any; error?: string }) => {
        if (response.success && response.params) {
          try {
            // Create the transport
            const transport = device!.createSendTransport({
              id: response.params.id,
              iceParameters: response.params.iceParameters,
              iceCandidates: response.params.iceCandidates,
              dtlsParameters: response.params.dtlsParameters,
              sctpParameters: response.params.sctpParameters,
            });
            
            // Handle transport events
            transport.on("connect", ({ dtlsParameters }, callback, errback) => {
              socketRef.current!.emit("connectWebRtcTransport", {
                roomId: meetingId,
                transportId: transport.id,
                dtlsParameters,
              }, (response: { success: boolean; error?: string }) => {
                if (response.success) {
                  callback();
                } else {
                  errback(new Error(response.error || "Unknown error"));
                }
              });
            });
            
            transport.on("produce", async ({ kind, rtpParameters, appData }, callback, errback) => {
              try {
                socketRef.current!.emit("produce", {
                  roomId: meetingId,
                  transportId: transport.id,
                  kind,
                  rtpParameters,
                  appData,
                }, (response: { success: boolean; producerId?: string; error?: string }) => {
                  if (response.success && response.producerId !== undefined) {
                    callback({ id: response.producerId });
                  } else {
                    errback(new Error(response.error || "Unknown error"));
                  }
                });
              } catch (error) {
                errback(error instanceof Error ? error : new Error(String(error)));
              }
            });
            
            setSendTransport(transport);
            resolve(transport);
          } catch (error) {
            console.error("Error creating send transport:", error);
            reject(error);
          }
        } else {
          console.error("Failed to create send transport:", response.error);
          reject(new Error(response.error || "Unknown error"));
        }
      });
    });
  };
  
  // Create a WebRTC transport for receiving media
  const createRecvTransport = async () => {
    if (!socketRef.current || !meetingId || !device) return null;
    
    console.log("Creating receive transport");
    
    return new Promise<mediasoupClient.types.Transport>((resolve, reject) => {
      socketRef.current!.emit("createWebRtcTransport", {
        roomId: meetingId,
        consuming: true,
      }, async (response: { success: boolean; params?: any; error?: string }) => {
        if (response.success && response.params) {
          try {
            // Create the transport
            const transport = device!.createRecvTransport({
              id: response.params.id,
              iceParameters: response.params.iceParameters,
              iceCandidates: response.params.iceCandidates,
              dtlsParameters: response.params.dtlsParameters,
              sctpParameters: response.params.sctpParameters,
            });
            
            // Handle transport events
            transport.on("connect", ({ dtlsParameters }, callback, errback) => {
              socketRef.current!.emit("connectWebRtcTransport", {
                roomId: meetingId,
                transportId: transport.id,
                dtlsParameters,
              }, (response: { success: boolean; error?: string }) => {
                if (response.success) {
                  callback();
                } else {
                  errback(new Error(response.error || "Unknown error"));
                }
              });
            });
            
            setRecvTransport(transport);
            resolve(transport);
          } catch (error) {
            console.error("Error creating receive transport:", error);
            reject(error);
          }
        } else {
          console.error("Failed to create receive transport:", response.error);
          reject(new Error(response.error || "Unknown error"));
        }
      });
    });
  };

  // Produce audio and video streams
  const produceStreams = async (transport: mediasoupClient.types.Transport, stream: MediaStream) => {
    // Produce audio
    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      const audioProducer = await transport.produce({
        track: audioTrack,
        codecOptions: {
          opusStereo: true,
          opusDtx: true,
        },
      });
      
      setProducers(prev => new Map(prev).set("audio", audioProducer));
      
      audioProducer.on("transportclose", () => {
        setProducers(prev => {
          const newProducers = new Map(prev);
          newProducers.delete("audio");
          return newProducers;
        });
      });
    }
    
    // Produce video
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      const videoProducer = await transport.produce({
        track: videoTrack,
        codecOptions: {
          videoGoogleStartBitrate: 1000,
        },
      });
      
      setProducers(prev => new Map(prev).set("video", videoProducer));
      
      videoProducer.on("transportclose", () => {
        setProducers(prev => {
          const newProducers = new Map(prev);
          newProducers.delete("video");
          return newProducers;
        });
      });
    }
  };

  // Consume a remote stream
  const consumeStream = async (producerId: string) => {
    if (!socketRef.current || !meetingId || !device || !recvTransport) {
      console.error("Cannot consume stream: missing required objects");
      return;
    }
    
    console.log(`Consuming stream for producer: ${producerId}`);
    
    socketRef.current.emit("consume", {
      roomId: meetingId,
      producerId,
      rtpCapabilities: device.rtpCapabilities,
    }, async (response: { 
      success: boolean; 
      params?: { 
        id: string; 
        producerId: string; 
        kind: "audio" | "video"; 
        rtpParameters: any; 
        producerSocketId: string;
      }; 
      error?: string 
    }) => {
      if (response.success && response.params) {
        try {
          // Create a consumer for the producer
          const consumer = await recvTransport.consume({
            id: response.params.id,
            producerId: response.params.producerId,
            kind: response.params.kind,
            rtpParameters: response.params.rtpParameters,
          });
          
          // Store the consumer
          setConsumers(prev => new Map(prev).set(consumer.id, consumer));
          
          // Create a new MediaStream with the consumer's track
          const stream = new MediaStream([consumer.track]);
          
          const producerSocketId = response.params.producerSocketId;
          console.log(`Created stream for consumer: ${consumer.id}, producer: ${response.params.producerId}, socket: ${producerSocketId}`);
          
          // Update the participant's stream
          setParticipants(prevParticipants => {
            return prevParticipants.map(participant => {
              if (participant.id === producerSocketId) {
                console.log(`Updating stream for participant: ${participant.name} (${participant.id})`);
                return {
                  ...participant,
                  videoStream: stream,
                };
              }
              return participant;
            });
          });
          
          // Resume the consumer
          await consumer.resume();
          
          // Notify the server that we're ready to receive
          if (socketRef.current) {
            socketRef.current.emit("resumeConsumer", {
              roomId: meetingId,
              consumerId: consumer.id,
            });
          }
          
          console.log(`Consumer resumed: ${consumer.id}`);
        } catch (error) {
          console.error("Error consuming stream:", error);
        }
      } else {
        console.error("Failed to consume stream:", response.error || "Unknown error");
      }
    });
  };

  // Toggle audio mute
  const toggleAudio = () => {
    if (!localStream) return;
    
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = isAudioMuted;
      setIsAudioMuted(!isAudioMuted);
      
      // Pause/resume the audio producer
      const audioProducer = producers.get("audio");
      if (audioProducer) {
        if (isAudioMuted) {
          audioProducer.resume();
        } else {
          audioProducer.pause();
        }
      }
    }
  };

  // Toggle video
  const toggleVideo = () => {
    if (!localStream) return;
    
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = isVideoOff;
      setIsVideoOff(!isVideoOff);
      
      // Pause/resume the video producer
      const videoProducer = producers.get("video");
      if (videoProducer) {
        if (isVideoOff) {
          videoProducer.resume();
        } else {
          videoProducer.pause();
        }
      }
    }
  };

  // Toggle screen sharing
  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      // Stop screen sharing
      if (screenShareStreamRef.current) {
        screenShareStreamRef.current.getTracks().forEach(track => track.stop());
      }
      
      // Restore original camera stream
      if (originalStreamRef.current && localVideoRef.current) {
        setLocalStream(originalStreamRef.current);
        localVideoRef.current.srcObject = originalStreamRef.current;
        
        // Replace the video producer's track
        const videoProducer = producers.get("video");
        if (videoProducer) {
          await videoProducer.replaceTrack({
            track: originalStreamRef.current.getVideoTracks()[0],
          });
        }
      }
      
      setIsScreenSharing(false);
    } else {
      try {
        // Start screen sharing
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
        });
        
        screenShareStreamRef.current = screenStream;
        
        // Save original stream if not already saved
        if (!originalStreamRef.current && localStream) {
          originalStreamRef.current = localStream;
        }
        
        // Update local video preview
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = screenStream;
        }
        
        // Replace the video producer's track
        const videoProducer = producers.get("video");
        if (videoProducer) {
          await videoProducer.replaceTrack({
            track: screenStream.getVideoTracks()[0],
          });
        }
        
        // Handle the case when user stops screen sharing via the browser UI
        screenStream.getVideoTracks()[0].onended = () => {
          toggleScreenShare();
        };
        
        setIsScreenSharing(true);
      } catch (error) {
        console.error("Error sharing screen:", error);
      }
    }
  };

  // Toggle chat
  const toggleChat = () => {
    setIsChatOpen(!isChatOpen);
  };

  // Send a chat message
  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !socketRef.current) return;
    
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    // Add message to local state immediately for better UX
    const messageData: Message = {
      sender: userName,
      message: newMessage,
      time: time,
      fromMe: true
    };
    
    setMessages(prevMessages => [...prevMessages, messageData]);
    
    // Send to server
    socketRef.current.emit("send-message", newMessage);
    setNewMessage("");
    
    // Scroll to bottom
    if (chatContainerRef.current) {
      setTimeout(() => {
        chatContainerRef.current!.scrollTop = chatContainerRef.current!.scrollHeight;
      }, 0);
    }
  };

  // Admit a participant from the waiting room
  const admitParticipant = (participantId: string) => {
    if (!socketRef.current || !meetingId) return;
    
    socketRef.current.emit("admitToRoom", { roomId: meetingId, participantId }, (response: any) => {
      if (response.success) {
        console.log(`Admitted participant: ${participantId}`);
      } else {
        console.error("Failed to admit participant:", response.error);
      }
    });
  };

  // Leave the meeting
  const leaveMeeting = () => {
    navigate("/");
  };

  // Handle name submission
  const handleNameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userName.trim()) return;
    
    setIsNameSubmitted(true);
    
    // Initialize user media
    initializeUserMedia().then(() => {
      // Check if the meeting exists
      if (socketRef.current) {
        socketRef.current.emit("checkRoom", { roomId: meetingId }, (response: any) => {
          if (response.exists) {
            // Join existing room
            joinRoom();
          } else {
            // Create new room as host
            createRoom();
          }
        });
      }
    });
  };

  // Render participant video
  const renderParticipantVideo = (participant: Participant) => {
    return (
      <div className="participant-video-container" key={participant.id}>
        <div className="participant-info">
          <div className="participant-name">{participant.name}</div>
          {!participant.audioEnabled && <span>&#128266;</span>}
        </div>
        {participant.videoStream ? (
          <video
            ref={videoElement => {
              if (videoElement && participant.videoStream) {
                videoElement.srcObject = participant.videoStream;
              }
            }}
            autoPlay
            playsInline
            muted={participant.id === socketRef.current?.id}
            className={!participant.videoEnabled ? "video-off" : ""}
          />
        ) : (
          <div className="no-video-placeholder">
            <div className="avatar">{participant.name.charAt(0).toUpperCase()}</div>
          </div>
        )}
      </div>
    );
  };

  // Render waiting room
  const renderWaitingRoom = () => {
    return (
      <div className="waiting-room">
        <h2>Waiting Room</h2>
        <p>The host will let you in soon...</p>
      </div>
    );
  };

  // Render name input form
  if (!isNameSubmitted) {
    return (
      <div className="name-input-container">
        <h2>Enter your name to join the meeting</h2>
        <form onSubmit={handleNameSubmit}>
          <input
            type="text"
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            placeholder="Your name"
            required
          />
          <button type="submit">Join Meeting</button>
        </form>
      </div>
    );
  }

  // Render waiting room if user is in waiting room
  if (inWaitingRoom) {
    return renderWaitingRoom();
  }

  return (
    <div className="meeting-container">
      {/* Video grid */}
      <div className={`video-grid ${isChatOpen ? "chat-open" : ""}`}>
        {/* Local video */}
        <div className="local-video-container">
          <div className="participant-info">
            <div className="participant-name">You</div>
            {isAudioMuted && <span>&#128266;</span>}
          </div>
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className={isVideoOff ? "video-off" : ""}
          />
        </div>
        
        {/* Remote videos */}
        {participants.map(renderParticipantVideo)}
      </div>
      
      {/* Chat panel */}
      {isChatOpen && (
        <div className="chat-panel">
          <div className="chat-header">
            <h3>Chat</h3>
            <button className="close-chat" onClick={toggleChat}>
              &#10005;
            </button>
          </div>
          <div className="chat-messages" ref={chatContainerRef}>
            {messages.map((msg, index) => (
              <div key={index} className={`message ${msg.fromMe ? "my-message" : ""}`}>
                <div className="message-header">
                  <span className="message-sender">{msg.sender}</span>
                  <span className="message-time">{msg.time}</span>
                </div>
                <div className="message-content">{msg.message}</div>
              </div>
            ))}
          </div>
          <form className="chat-input" onSubmit={sendMessage}>
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Type a message..."
            />
            <button type="submit">Send</button>
          </form>
        </div>
      )}
      
      {/* Waiting room panel for host */}
      {isHost && waitingRoomParticipants.length > 0 && (
        <div className="waiting-room-panel">
          <h3>Waiting Room</h3>
          <ul>
            {waitingRoomParticipants.map(participant => (
              <li key={participant.id}>
                {participant.name}
                <button onClick={() => admitParticipant(participant.id)}>Admit</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      
      {/* Controls */}
      <div className="meeting-controls">
        <button
          className={`control-button ${isAudioMuted ? "active" : ""}`}
          onClick={toggleAudio}
        >
          {isAudioMuted ? <span>&#128266;</span> : <span>&#128260;</span>}
        </button>
        <button
          className={`control-button ${isVideoOff ? "active" : ""}`}
          onClick={toggleVideo}
        >
          {isVideoOff ? <span>&#128247;</span> : <span>&#128248;</span>}
        </button>
        <button
          className={`control-button ${isScreenSharing ? "active" : ""}`}
          onClick={toggleScreenShare}
        >
          <span>&#128250;</span>
        </button>
        <button
          className={`control-button ${isChatOpen ? "active" : ""}`}
          onClick={toggleChat}
        >
          {isChatOpen ? <span>&#128266;</span> : <span>&#128260;</span>}
        </button>
        {isHost && (
          <button className="control-button invite-button">
            <span>&#128101;</span>
          </button>
        )}
        <button className="control-button leave-button" onClick={leaveMeeting}>
          Leave
        </button>
      </div>
    </div>
  );
};

export default Meeting;
