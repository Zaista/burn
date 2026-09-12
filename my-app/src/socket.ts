// Single shared Socket.IO connection for the app, reused by any hook/component
// that needs to emit or listen for real-time board events.
import { io } from 'socket.io-client';
import { API_BASE_URL } from './config';

export const socket = io(API_BASE_URL);
