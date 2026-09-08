# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Burn" — a real-time shared post-it board. Users drop notes on a shared board and can "burn" (drag and drop to a fire place in the middle of the screen) a note, with a canvas-based fire animation. State is synced live across clients over Socket.IO and persisted in MongoDB.
Users can create "rooms" and share the link to them to other users. State of the room is preserved idefinitely

The frontend is `my-app/` (React + Vite). An earlier vanilla JS/HTML frontend used to live in `public/`, served statically by the Express server; it has been removed — the backend is now a pure API/Socket.IO server and no longer serves any frontend itself.

## Commands

### Backend (repo root) — Express/Socket.IO/Mongoose server, TypeScript compiled to `dist/`

```bash
npm run dev            # tsc --watch + run the server in parallel (npm-run-all), backend-only dev loop
npm run watch           # tsc --watch only
npm run run             # node dist/server.js (expects dist/ already built)
npm run dev:frontend    # backend (run + watch) AND the my-app Vite dev server together
```
There is no real `test` script (`"test": "test"` is a placeholder) and no lint script at the root.

### Frontend — `my-app/` (React + Vite)

Run from inside `my-app/`, or with `npm --prefix my-app run <script>` from the root:

```bash
npm run dev       # vite dev server (port 5173)
npm run build     # vite build
npm run lint      # eslint .
npm run preview   # preview the production build
```

A `.claude/launch.json` config named `my-app-dev` starts this Vite dev server on port 5173.

### MongoDB

```bash
docker-compose up -d
```
Starts a `mongo` container, persisting to `./private/mongodb/data`. `mongo-init.js` creates the app-level user (`appuser`/`apppass`, `readWrite` on the `postit` database) that `src/server.ts` connects with — the connection string and credentials are currently hardcoded in `server.ts`.

## Architecture

### Backend (`src/server.ts` → compiled to `dist/`)

Single-file Express app. Key points:
- Pure API/Socket.IO server — no static frontend is served from here; it connects to MongoDB (`postit` db) via Mongoose on startup, and `await mongoose.connect(...)` blocks server start.
- One Mongoose model, `Note`: `{ text: String, position: { x: Number, y: Number } }`.
- REST: `GET /notes` returns all notes.
- Realtime state sync is entirely Socket.IO, not REST — there's no `POST/DELETE /notes` endpoint. Events:
  - `addNote` (client→server, note text) → persists, broadcasts `noteAdded` to all clients.
  - `deleteNote` (client→server, note id) → deletes from DB, broadcasts `noteDeleted` to all clients. The frontend only deletes a note *after* its local burn animation finishes, so `noteDeleted` is what actually removes the note from every board (including the client that triggered the burn).
  - `note_dragging` (client→server, `{id,x,y}`) → rebroadcast to *other* clients only (`socket.broadcast.emit`), no DB write — cheap live position updates while dragging.
  - `note_drag_end` (client→server, `{id,x,y}`) → persists final position to DB, broadcasts `note_moved` to other clients.
- `tsconfig.json` at root excludes `my-app` — the root TS project only compiles `src/` into `dist/`. `my-app` has its own separate `tsconfig.json` (used by Vite/tsc for the React app, not built by the root `tsc`).

### Frontend — `my-app/` (React + Vite, TypeScript + some `.jsx`)

- `src/socket.ts` — single shared `socket.io-client` connection (hardcoded to `http://localhost:3000`), imported wherever real-time events are needed.
- `src/hooks/useNotes.ts` — fetches `/notes` via SWR (also hardcoded to `http://localhost:3000`).
- `src/components/NoteList.tsx` — renders one `<canvas>` per note and owns the burn animation:
  - Each note's canvas is drawn and wired up exactly once (tracked via an `initializedIds` ref) so re-renders from other notes burning don't reset an in-progress animation.
  - `startBurn()` animates a noise-jittered (via `SimplexNoise`) polygon eating outward from the note's center using `destination-out` compositing, plus a charred rim, an ember edge line, and drifting ember particles — driven by `requestAnimationFrame`, timed in real ms (not frame count) so speed is frame-rate independent.
  - On click, the animation plays locally, and only on completion does it `socket.emit('deleteNote', ...)`; the note is actually removed from `visibleNotes` when the server's `noteDeleted` broadcast comes back in (see `useEffect` listening for it), so a note burned in one tab disappears in all tabs via the same code path.
- `src/App.tsx` still has leftover Vite starter boilerplate (`count` state, logos) mixed in with the real note-input UI — expect this to get cleaned up.
