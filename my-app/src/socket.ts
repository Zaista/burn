// Single shared Socket.IO connection for the app, reused by any hook/component
// that needs to emit or listen for real-time board events.
import { io } from 'socket.io-client';

export const socket = io('http://localhost:3000');
