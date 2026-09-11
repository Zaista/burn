# Burn — frontend

React + Vite frontend for [Burn](../CLAUDE.md), a real-time shared post-it
board with a canvas-based fire animation. No login — a room's link is what
grants access to it.

Run from here, or with `npm --prefix my-app run <script>` from the repo root:

```bash
npm run dev       # vite dev server (port 5173)
npm run build     # vite build
npm run lint      # eslint .
npm run preview   # preview the production build
```

Needs the backend running too (`npm run dev` from the repo root) — see the
root [CLAUDE.md](../CLAUDE.md) for the full setup (MongoDB, backend
commands, architecture).
