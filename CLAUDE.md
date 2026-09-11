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
- No login/accounts. Rooms are the only access boundary, and a room's id (its Mongo `_id`) doubles as its shareable slug — it's a random, unguessable token (`crypto.randomBytes(9).toString('base64url')`, not a sequential Mongo `ObjectId`), because possession of the link *is* the authorization, like an "anyone with the link" Google Doc.
- Two Mongoose models:
  - `Room`: `{ _id: String, createdAt: Date }` — created only via `POST /rooms`.
  - `Note`: `{ text: String, position: { x: Number, y: Number }, roomId: String }` — every note belongs to exactly one room.
- REST:
  - `POST /rooms` → creates a room, returns `{ id }`.
  - `GET /rooms/:id` → 200 with the room, or 404 if it doesn't exist (frontend uses this to validate a room link before rendering its board).
  - `GET /rooms/:id/notes` → all notes for that room.
- Realtime state sync is entirely Socket.IO, not REST — there's no `POST/DELETE /notes` endpoint. A socket must first emit `joinRoom` (roomId) — the server does `socket.join(roomId)` and stashes it on `socket.data.roomId`; every event below is a no-op until that's set, and every broadcast is scoped to that Socket.IO room (`io.to(roomId)`/`socket.to(roomId)`, not the old global `io.emit`/`socket.broadcast.emit`) so rooms never see each other's live updates. The frontend re-emits `joinRoom` on every `connect` (initial connect and reconnects), since `socket.data` doesn't survive a dropped connection. Events:
  - `addNote` (client→server, note text) → persists with the socket's `roomId`, broadcasts `noteAdded` to that room.
  - `deleteNote` (client→server, note id) → deletes from DB (scoped to `roomId`), broadcasts `noteDeleted` to that room. The frontend only deletes a note *after* its local burn animation finishes, so `noteDeleted` is what actually removes the note from every board in the room (including the client that triggered the burn).
  - `note_dragging` (client→server, `{id,x,y}`) → rebroadcast to *other* clients in the same room only, no DB write — cheap live position updates while dragging.
  - `note_drag_end` (client→server, `{id,x,y}`) → persists final position to DB, broadcasts `note_moved` to the rest of the room.
- `tsconfig.json` at root excludes `my-app` — the root TS project only compiles `src/` into `dist/`. `my-app` has its own separate `tsconfig.json` (used by Vite/tsc for the React app, not built by the root `tsc`).

### Frontend — `my-app/` (React + Vite, TypeScript + some `.jsx`)

- `src/App.tsx` sets up routing (`react-router-dom` v6): `/` is the landing page, `/room/:roomId` is a room's board.
- `src/pages/Landing.tsx` — `POST /rooms` then navigates to `/room/:id`; that's the only way a room is created.
- `src/pages/RoomPage.tsx` — validates the `:roomId` param against `GET /rooms/:id` (SWR) before rendering; shows a "room not found" state on 404 instead of silently rendering an empty board. Renders `<ShareLink />` plus `<NoteList roomId key={roomId} />` — keyed by `roomId` so navigating between rooms fully remounts `NoteList` rather than reusing its per-note refs across boards.
- `src/components/ShareLink.tsx` — small fixed button that copies `window.location.href`; sharing a room is just sharing that URL.
- `src/socket.ts` — single shared `socket.io-client` connection (hardcoded to `http://localhost:3000`), imported wherever real-time events are needed.
- `src/hooks/useNotes.ts` — takes a `roomId`, fetches `/rooms/:roomId/notes` via SWR (also hardcoded to `http://localhost:3000`).
- `src/components/NoteList.tsx` — takes a `roomId` prop; on mount (and on every socket `connect`) emits `joinRoom` so the server scopes this socket's events to that room. Renders one `<canvas>` per note and owns the burn animation:
  - Each note's canvas is drawn and wired up exactly once (tracked via an `initializedIds` ref) so re-renders from other notes burning don't reset an in-progress animation.
  - `startBurn()` animates a noise-jittered (via `SimplexNoise`) polygon eating outward from the note's center using `destination-out` compositing, plus a charred rim, an ember edge line, and drifting ember particles — driven by `requestAnimationFrame`, timed in real ms (not frame count) so speed is frame-rate independent.
  - On click, the animation plays locally, and only on completion does it `socket.emit('deleteNote', ...)`; the note is actually removed from `visibleNotes` when the server's `noteDeleted` broadcast comes back in (see `useEffect` listening for it), so a note burned in one tab disappears in all tabs via the same code path.
