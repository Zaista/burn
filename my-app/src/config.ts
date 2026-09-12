// Single source of truth for where the backend (Express API + Socket.IO)
// lives. Set VITE_API_BASE_URL at build time (see .env.example) to point a
// deployed frontend at the deployed backend, e.g. an App Engine URL —
// without it, everything falls back to the local dev server.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';
