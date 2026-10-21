import { useEffect, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { useSelector } from 'react-redux';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5001';

let socket = null;

export const useSocket = () => {
  const [connected, setConnected] = useState(false);
  const { user } = useSelector((state) => state.auth);

  useEffect(() => {
    if (!user) return;

    // Initialize socket connection
    if (!socket) {
      socket = io(SOCKET_URL, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
      });

      socket.on('connect', () => {
        console.log('[Socket] Connected:', socket.id);
        setConnected(true);

        // Join user-specific room
        socket.emit('join', user._id);
      });

      socket.on('disconnect', () => {
        console.log('[Socket] Disconnected');
        setConnected(false);
      });

      socket.on('connect_error', (error) => {
        console.error('[Socket] Connection error:', error);
        setConnected(false);
      });
    }

    return () => {
      if (socket) {
        socket.disconnect();
        socket = null;
        setConnected(false);
      }
    };
  }, [user]);

  const joinCampaign = useCallback((campaignId) => {
    if (socket && connected) {
      socket.emit('join-campaign', campaignId);
      console.log('[Socket] Joined campaign:', campaignId);
    }
  }, [connected]);

  const leaveCampaign = useCallback((campaignId) => {
    if (socket && connected) {
      socket.emit('leave-campaign', campaignId);
      console.log('[Socket] Left campaign:', campaignId);
    }
  }, [connected]);

  const on = useCallback((event, callback) => {
    if (socket) {
      socket.on(event, callback);
    }
  }, []);

  const off = useCallback((event, callback) => {
    if (socket) {
      socket.off(event, callback);
    }
  }, []);

  return {
    socket,
    connected,
    joinCampaign,
    leaveCampaign,
    on,
    off,
  };
};

export default useSocket;
