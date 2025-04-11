const mediasoup = require('mediasoup');
const config = {
  mediasoup: {
    // Worker settings
    worker: {
      rtcMinPort: 10000,
      rtcMaxPort: 10100,
      logLevel: 'warn',
      logTags: [
        'info',
        'ice',
        'dtls',
        'rtp',
        'srtp',
        'rtcp',
      ],
    },
    // Router settings
    router: {
      mediaCodecs: [
        {
          kind: 'audio',
          mimeType: 'audio/opus',
          clockRate: 48000,
          channels: 2,
        },
        {
          kind: 'video',
          mimeType: 'video/VP8',
          clockRate: 90000,
          parameters: {
            'x-google-start-bitrate': 1000,
          },
        },
        {
          kind: 'video',
          mimeType: 'video/VP9',
          clockRate: 90000,
          parameters: {
            'profile-id': 2,
            'x-google-start-bitrate': 1000,
          },
        },
        {
          kind: 'video',
          mimeType: 'video/h264',
          clockRate: 90000,
          parameters: {
            'packetization-mode': 1,
            'profile-level-id': '4d0032',
            'level-asymmetry-allowed': 1,
            'x-google-start-bitrate': 1000,
          },
        },
      ],
    },
    // WebRtcTransport settings
    webRtcTransport: {
      listenIps: [
        {
          ip: '0.0.0.0',
          announcedIp: process.env.ANNOUNCED_IP || '127.0.0.1', // Replace with your public IP in production
        },
      ],
      maxIncomingBitrate: 1500000,
      initialAvailableOutgoingBitrate: 1000000,
    },
  },
};

// Global variables
let worker;
let router;
const rooms = new Map(); // roomId => Room
const peers = new Map(); // socketId => Peer

// Room class to manage a meeting room
class Room {
  constructor(roomId) {
    this.id = roomId;
    this.router = null;
    this.peers = new Map(); // socketId => Peer
    this.hostId = null; // Socket ID of the room host
    this.waitingRoom = new Map(); // socketId => { name, socket }
  }

  addPeer(socketId, peer) {
    this.peers.set(socketId, peer);
  }

  getPeer(socketId) {
    return this.peers.get(socketId);
  }

  removePeer(socketId) {
    this.peers.delete(socketId);
  }

  setHost(socketId) {
    this.hostId = socketId;
  }

  isHost(socketId) {
    return this.hostId === socketId;
  }

  addToWaitingRoom(socketId, name, socket) {
    this.waitingRoom.set(socketId, { name, socket });
  }

  removeFromWaitingRoom(socketId) {
    this.waitingRoom.delete(socketId);
  }

  getWaitingRoomParticipants() {
    return Array.from(this.waitingRoom.entries()).map(([id, { name }]) => ({ id, name }));
  }
}

// Peer class to manage a participant in a room
class Peer {
  constructor(socketId, name, socket) {
    this.id = socketId;
    this.name = name;
    this.socket = socket;
    this.transports = new Map(); // transportId => Transport
    this.producers = new Map(); // producerId => Producer
    this.consumers = new Map(); // consumerId => Consumer
  }

  addTransport(transport) {
    this.transports.set(transport.id, transport);
  }

  getTransport(transportId) {
    return this.transports.get(transportId);
  }

  async createProducer(transportId, kind, rtpParameters) {
    const transport = this.getTransport(transportId);
    if (!transport) throw new Error(`Transport not found: ${transportId}`);

    const producer = await transport.produce({ kind, rtpParameters });
    this.producers.set(producer.id, producer);

    producer.on('transportclose', () => {
      this.producers.delete(producer.id);
    });

    return producer;
  }

  async createConsumer(producerPeer, producerId, rtpCapabilities) {
    const producer = producerPeer.producers.get(producerId);
    if (!producer) throw new Error(`Producer not found: ${producerId}`);

    // Get the router's RTP capabilities
    const router = rooms.get(this.roomId).router;
    if (!router) throw new Error('Router not found');

    // Check if the client can consume the producer
    if (!router.canConsume({
      producerId: producer.id,
      rtpCapabilities,
    })) {
      throw new Error('Cannot consume');
    }

    // Get the transport for consuming
    const transport = Array.from(this.transports.values())
      .find(t => t.appData.consuming);

    if (!transport) throw new Error('No consumer transport found');

    // Create the consumer
    const consumer = await transport.consume({
      producerId: producer.id,
      rtpCapabilities,
      paused: true, // Start paused
    });

    this.consumers.set(consumer.id, consumer);

    consumer.on('transportclose', () => {
      this.consumers.delete(consumer.id);
    });

    return {
      consumer,
      params: {
        id: consumer.id,
        producerId: producer.id,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        type: consumer.type,
        producerPaused: consumer.producerPaused,
      },
    };
  }

  closeAllTransports() {
    for (const transport of this.transports.values()) {
      transport.close();
    }
    this.transports.clear();
  }
}

// Initialize the media server
async function initializeMediaServer() {
  try {
    console.log('Initializing Mediasoup server...');
    worker = await mediasoup.createWorker({
      logLevel: config.mediasoup.worker.logLevel,
      logTags: config.mediasoup.worker.logTags,
      rtcMinPort: config.mediasoup.worker.rtcMinPort,
      rtcMaxPort: config.mediasoup.worker.rtcMaxPort,
    });

    console.log('Mediasoup worker created');

    worker.on('died', () => {
      console.error('Mediasoup worker died, exiting...');
      process.exit(1);
    });

    return worker;
  } catch (error) {
    console.error('Failed to initialize media server:', error);
    process.exit(1);
  }
}

// Create a router for a room
async function createRouter(roomId) {
  if (!worker) {
    await initializeMediaServer();
  }

  try {
    const router = await worker.createRouter({
      mediaCodecs: config.mediasoup.router.mediaCodecs,
    });

    // Create a new room if it doesn't exist
    if (!rooms.has(roomId)) {
      const room = new Room(roomId);
      room.router = router;
      rooms.set(roomId, room);
    } else {
      // Update the router for the existing room
      const room = rooms.get(roomId);
      room.router = router;
    }

    return router;
  } catch (error) {
    console.error('Failed to create router:', error);
    throw error;
  }
}

// Create a WebRTC transport
async function createWebRtcTransport(roomId, socketId, consuming = false) {
  const room = rooms.get(roomId);
  if (!room) throw new Error(`Room not found: ${roomId}`);

  const router = room.router;
  if (!router) throw new Error(`Router not found for room: ${roomId}`);

  try {
    const transport = await router.createWebRtcTransport({
      listenIps: config.mediasoup.webRtcTransport.listenIps,
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate: config.mediasoup.webRtcTransport.initialAvailableOutgoingBitrate,
      appData: { socketId, consuming },
    });

    // Set max incoming bitrate
    if (config.mediasoup.webRtcTransport.maxIncomingBitrate) {
      try {
        await transport.setMaxIncomingBitrate(config.mediasoup.webRtcTransport.maxIncomingBitrate);
      } catch (error) {
        console.error('Failed to set max incoming bitrate:', error);
      }
    }

    // Add the transport to the peer
    const peer = room.getPeer(socketId);
    if (peer) {
      peer.addTransport(transport);
    }

    return {
      transport,
      params: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      },
    };
  } catch (error) {
    console.error('Failed to create WebRTC transport:', error);
    throw error;
  }
}

// Handle socket connection for media server
function handleSocketConnection(socket, io) {
  // Socket event handlers for media server
  socket.on('createRoom', async ({ roomId, name }, callback) => {
    try {
      let room = rooms.get(roomId);
      
      // Create a new room if it doesn't exist
      if (!room) {
        const router = await createRouter(roomId);
        room = rooms.get(roomId);
        room.setHost(socket.id);
      }
      
      // Create a new peer
      const peer = new Peer(socket.id, name, socket);
      peers.set(socket.id, peer);
      room.addPeer(socket.id, peer);
      
      // Return router RTP capabilities
      callback({
        success: true,
        routerRtpCapabilities: room.router.rtpCapabilities,
      });
    } catch (error) {
      console.error('Error creating room:', error);
      callback({ success: false, error: error.message });
    }
  });

  socket.on('joinRoom', async ({ roomId, name }, callback) => {
    try {
      const room = rooms.get(roomId);
      if (!room) {
        return callback({ success: false, error: 'Room not found' });
      }
      
      // Check if waiting room is enabled and user is not the host
      if (room.hostId && room.hostId !== socket.id) {
        // Add to waiting room
        room.addToWaitingRoom(socket.id, name, socket);
        
        // Notify host about new participant in waiting room
        const host = room.getPeer(room.hostId);
        if (host) {
          host.socket.emit('waitingRoomUpdated', {
            participants: room.getWaitingRoomParticipants(),
          });
        }
        
        return callback({
          success: true,
          inWaitingRoom: true,
        });
      }
      
      // Create a new peer
      const peer = new Peer(socket.id, name, socket);
      peers.set(socket.id, peer);
      room.addPeer(socket.id, peer);
      
      // Return router RTP capabilities
      callback({
        success: true,
        routerRtpCapabilities: room.router.rtpCapabilities,
      });
      
      // Notify others about the new participant
      socket.to(roomId).emit('participantJoined', {
        id: socket.id,
        name: name,
      });
    } catch (error) {
      console.error('Error joining room:', error);
      callback({ success: false, error: error.message });
    }
  });

  socket.on('admitToRoom', ({ roomId, participantId }, callback) => {
    try {
      const room = rooms.get(roomId);
      if (!room) {
        return callback({ success: false, error: 'Room not found' });
      }
      
      // Check if user is the host
      if (!room.isHost(socket.id)) {
        return callback({ success: false, error: 'Not authorized' });
      }
      
      // Get participant from waiting room
      const participant = room.waitingRoom.get(participantId);
      if (!participant) {
        return callback({ success: false, error: 'Participant not found in waiting room' });
      }
      
      // Create a new peer
      const peer = new Peer(participantId, participant.name, participant.socket);
      peers.set(participantId, peer);
      room.addPeer(participantId, peer);
      
      // Remove from waiting room
      room.removeFromWaitingRoom(participantId);
      
      // Notify the participant they've been admitted
      participant.socket.emit('admittedToRoom', {
        routerRtpCapabilities: room.router.rtpCapabilities,
      });
      
      // Notify others about the new participant
      socket.to(roomId).emit('participantJoined', {
        id: participantId,
        name: participant.name,
      });
      
      callback({ success: true });
      
      // Update waiting room for host
      socket.emit('waitingRoomUpdated', {
        participants: room.getWaitingRoomParticipants(),
      });
    } catch (error) {
      console.error('Error admitting to room:', error);
      callback({ success: false, error: error.message });
    }
  });

  socket.on('createWebRtcTransport', async ({ roomId, consuming }, callback) => {
    try {
      const { transport, params } = await createWebRtcTransport(roomId, socket.id, consuming);
      callback({ success: true, params });
    } catch (error) {
      console.error('Error creating WebRTC transport:', error);
      callback({ success: false, error: error.message });
    }
  });

  socket.on('connectWebRtcTransport', async ({ roomId, transportId, dtlsParameters }, callback) => {
    try {
      const room = rooms.get(roomId);
      if (!room) {
        return callback({ success: false, error: 'Room not found' });
      }
      
      const peer = room.getPeer(socket.id);
      if (!peer) {
        return callback({ success: false, error: 'Peer not found' });
      }
      
      const transport = peer.getTransport(transportId);
      if (!transport) {
        return callback({ success: false, error: 'Transport not found' });
      }
      
      await transport.connect({ dtlsParameters });
      callback({ success: true });
    } catch (error) {
      console.error('Error connecting WebRTC transport:', error);
      callback({ success: false, error: error.message });
    }
  });

  socket.on('produce', async ({ roomId, transportId, kind, rtpParameters }, callback) => {
    try {
      const room = rooms.get(roomId);
      if (!room) {
        return callback({ success: false, error: 'Room not found' });
      }
      
      const peer = room.getPeer(socket.id);
      if (!peer) {
        return callback({ success: false, error: 'Peer not found' });
      }
      
      const producer = await peer.createProducer(transportId, kind, rtpParameters);
      
      // Inform all other participants about the new producer
      for (const [otherPeerId, otherPeer] of room.peers.entries()) {
        if (otherPeerId !== socket.id) {
          otherPeer.socket.emit('newProducer', {
            producerId: producer.id,
            producerSocketId: socket.id,
            kind,
          });
        }
      }
      
      callback({ success: true, producerId: producer.id });
    } catch (error) {
      console.error('Error producing:', error);
      callback({ success: false, error: error.message });
    }
  });

  socket.on('consume', async ({ roomId, producerId, rtpCapabilities }, callback) => {
    try {
      const room = rooms.get(roomId);
      if (!room) {
        return callback({ success: false, error: 'Room not found' });
      }
      
      const peer = room.getPeer(socket.id);
      if (!peer) {
        return callback({ success: false, error: 'Peer not found' });
      }
      
      // Find the producer peer
      let producerPeer;
      for (const [peerId, p] of room.peers.entries()) {
        for (const [id, producer] of p.producers.entries()) {
          if (id === producerId) {
            producerPeer = p;
            break;
          }
        }
        if (producerPeer) break;
      }
      
      if (!producerPeer) {
        return callback({ success: false, error: 'Producer not found' });
      }
      
      const { consumer, params } = await peer.createConsumer(producerPeer, producerId, rtpCapabilities);
      
      // Resume the consumer
      await consumer.resume();
      
      callback({
        success: true,
        params: {
          ...params,
          producerName: producerPeer.name,
        },
      });
    } catch (error) {
      console.error('Error consuming:', error);
      callback({ success: false, error: error.message });
    }
  });

  socket.on('disconnect', () => {
    // Clean up when a socket disconnects
    const peer = peers.get(socket.id);
    if (!peer) return;
    
    // Close all transports
    peer.closeAllTransports();
    
    // Remove peer from all rooms
    for (const room of rooms.values()) {
      const isPeerInRoom = room.getPeer(socket.id);
      
      if (isPeerInRoom) {
        // Notify others in the room
        socket.to(room.id).emit('participantLeft', {
          id: socket.id,
        });
        
        // Remove from room
        room.removePeer(socket.id);
        
        // If this was the host, assign a new host or close the room
        if (room.isHost(socket.id)) {
          const remainingPeers = Array.from(room.peers.keys());
          if (remainingPeers.length > 0) {
            // Assign the first remaining peer as the new host
            const newHostId = remainingPeers[0];
            room.setHost(newHostId);
            
            // Notify the new host
            const newHost = room.getPeer(newHostId);
            if (newHost) {
              newHost.socket.emit('promotedToHost');
            }
          } else {
            // Close the room if no peers left
            rooms.delete(room.id);
          }
        }
      }
      
      // Also check waiting room
      const isInWaitingRoom = room.waitingRoom.has(socket.id);
      if (isInWaitingRoom) {
        room.removeFromWaitingRoom(socket.id);
        
        // Update waiting room for host
        if (room.hostId) {
          const host = room.getPeer(room.hostId);
          if (host) {
            host.socket.emit('waitingRoomUpdated', {
              participants: room.getWaitingRoomParticipants(),
            });
          }
        }
      }
    }
    
    // Remove peer from global map
    peers.delete(socket.id);
  });
}

module.exports = {
  initializeMediaServer,
  handleSocketConnection,
  createRouter,
  createWebRtcTransport,
  rooms,
  peers,
};
