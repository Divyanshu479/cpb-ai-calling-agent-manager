import { Server } from 'socket.io';

let io = null;

export const initializeSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:5173',
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  io.on('connection', (socket) => {
    console.log(`[Socket.io] Client connected: ${socket.id}`);

    // Join user-specific room
    socket.on('join', (userId) => {
      socket.join(`user_${userId}`);
      console.log(`[Socket.io] User ${userId} joined their room`);
    });

    // Join campaign-specific room
    socket.on('join-campaign', (campaignId) => {
      socket.join(`campaign_${campaignId}`);
      console.log(`[Socket.io] Client joined campaign_${campaignId}`);
    });

    // Leave campaign room
    socket.on('leave-campaign', (campaignId) => {
      socket.leave(`campaign_${campaignId}`);
      console.log(`[Socket.io] Client left campaign_${campaignId}`);
    });

    socket.on('disconnect', () => {
      console.log(`[Socket.io] Client disconnected: ${socket.id}`);
    });
  });

  console.log('[Socket.io] Server initialized');
  return io;
};

export const getIO = () => {
  if (!io) {
    throw new Error('Socket.io not initialized');
  }
  return io;
};

// Emit events to specific rooms or users
export const emitToUser = (userId, event, data) => {
  if (io) {
    io.to(`user_${userId}`).emit(event, data);
  }
};

export const emitToCampaign = (campaignId, event, data) => {
  if (io) {
    io.to(`campaign_${campaignId}`).emit(event, data);
  }
};

export const emitToAll = (event, data) => {
  if (io) {
    io.emit(event, data);
  }
};
