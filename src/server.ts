import express from 'express';
import http from 'http';
import {Server} from 'socket.io';
import mongoose from 'mongoose';
import cors from 'cors';
import {randomBytes} from 'crypto';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' }
});

app.use(cors());
app.use(express.json());

// Connect to MongoDB. In production (e.g. App Engine) this should point at
// an externally-reachable Mongo (Atlas, or a Compute Engine box) via the
// MONGODB_URI env var — App Engine instances can't reach `localhost:27017`.
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://root:root@localhost:27017/burn';
await mongoose.connect(MONGODB_URI, { authSource: 'admin' });

// Used by App Engine's liveness/readiness checks (see app.yaml).
app.get('/healthz', (_req, res) => {
    res.status(mongoose.connection.readyState === 1 ? 200 : 503).send('ok');
});

const ROOM_NAME_MAX_LENGTH = 80;

// A room's `_id` doubles as its shareable slug (the token in `/room/:id`
// URLs). There's no login, so this token IS the access control — anyone
// with the link can read and edit the room's board, same as an "anyone with
// the link" Google Doc. It has to be unguessable, not just unique, so it's
// a random token rather than a sequential/timestamp-based Mongo ObjectId.
const RoomSchema = new mongoose.Schema({
    _id: String,
    name: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});
const Room = mongoose.model('Room', RoomSchema);

const NoteSchema = new mongoose.Schema({
    text: String,
    position: {
        x: Number,
        y: Number
    },
    // Which room this note belongs to — every note now lives inside exactly
    // one room's board instead of one global shared board.
    roomId: { type: String, index: true }
});
const Note = mongoose.model('Note', NoteSchema);

// 9 random bytes as base64url -> a 12-character, URL-safe, unguessable slug
// (72 bits of entropy — plenty for a non-sensitive shared board).
function generateRoomId(): string {
    return randomBytes(9).toString('base64url');
}

// Creates a new room and returns its shareable id. This is the only way a
// room comes into existence — joining an id that was never created here
// 404s below rather than silently creating an empty room, so a typo'd link
// fails loudly instead of landing on a blank board.
app.post('/rooms', async (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, ROOM_NAME_MAX_LENGTH) : '';
    if (!name) {
        res.status(400).json({ error: 'Room name is required' });
        return;
    }
    let id = generateRoomId();
    while (await Room.exists({ _id: id })) id = generateRoomId(); // astronomically unlikely, guarded anyway
    await Room.create({ _id: id, name });
    res.json({ id, name });
});

// Lets the frontend confirm a room exists before rendering its board (e.g.
// after following a shared link) instead of just trusting the URL.
app.get('/rooms/:id', async (req, res) => {
    const room = await Room.findById(req.params.id);
    if (!room) {
        res.status(404).json({ error: 'Room not found' });
        return;
    }
    res.json({ id: room._id, name: room.name });
});

// REST endpoint to get all notes for a single room
app.get('/rooms/:id/notes', async (req, res) => {
    const notes = await Note.find({ roomId: req.params.id });
    res.json(notes);
});

// Socket.IO events
io.on('connection', (socket) => {
    // A client joins its room's Socket.IO room right after connecting (and
    // again after any reconnect, since socket.data doesn't survive one) —
    // every event below is scoped to socket.data.roomId so live updates
    // (dragging, typing, burns...) never leak across rooms.
    socket.on('joinRoom', (roomId: string) => {
        if (typeof roomId !== 'string' || !roomId) return;
        if (socket.data.roomId) socket.leave(socket.data.roomId);
        socket.data.roomId = roomId;
        socket.join(roomId);
    });

    // `position` is set when a note is created by dragging it off the
    // corner stack (its drop point) — omitted (or optional fields on the
    // payload) leaves the note unpositioned, so the client falls back to
    // rendering it in the legacy stack. `ignite` is set when that drop
    // point was directly on the coal. `clientToken`, if given, is echoed
    // straight back — neither is persisted (not real Note fields), both
    // are just relayed to every client: ignite so they can all start the
    // burn the moment the note arrives, clientToken so the client that
    // created it can recognize its own note among any other client's
    // concurrent noteAdded broadcasts.
    socket.on('addNote', async ({ text, position, ignite, clientToken }: { text: string; position?: { x: number; y: number }; ignite?: boolean; clientToken?: string }) => {
        const roomId = socket.data.roomId;
        if (!roomId) return;
        const newNote = new Note({ text, position, roomId });
        await newNote.save();
        io.to(roomId).emit('noteAdded', { _id: newNote._id, text: newNote.text, position: newNote.position, ignite: !!ignite, clientToken });
    });

    socket.on('deleteNote', async (id) => {
        const roomId = socket.data.roomId;
        if (!roomId) return;
        await Note.findOneAndDelete({ _id: id, roomId });
        io.to(roomId).emit('noteDeleted', id);
    });

    // Relay a burn-start to every other client so the fire animation plays
    // on every board, not just the tab that clicked the note. Each client
    // simulates the burn locally (it's randomized, so it won't be pixel-
    // identical everywhere) — actual removal still goes through the
    // existing deleteNote/noteDeleted round trip once a client's local
    // animation finishes.
    socket.on('startBurn', (id) => {
        if (!socket.data.roomId) return;
        socket.to(socket.data.roomId).emit('startBurn', id);
    });

    // Live update while dragging (don’t write to DB here — too frequent)
    socket.on('note_dragging', ({ id, x, y }) => {
        if (!socket.data.roomId) return;
        socket.to(socket.data.roomId).emit('note_dragging', { id, x, y });
    });

    // Final update: save to DB
    socket.on('note_drag_end', async ({ id, x, y }) => {
        const roomId = socket.data.roomId;
        if (!roomId) return;
        await Note.findOneAndUpdate({ _id: id, roomId }, { position: { x, y } });
        socket.to(roomId).emit('note_moved', { id, x, y });
    });

    // Live text while someone is actively typing (no DB write — too
    // frequent, same as note_dragging above).
    socket.on('note_typing', ({ id, text }: { id: string; text: string }) => {
        if (!socket.data.roomId) return;
        socket.to(socket.data.roomId).emit('note_typing', { id, text });
    });

    // A note's text was edited (double-click to edit on the client) — save
    // it and let every other client redraw that note with the new text.
    socket.on('note_text_changed', async ({ id, text }: { id: string; text: string }) => {
        const roomId = socket.data.roomId;
        if (!roomId) return;
        await Note.findOneAndUpdate({ _id: id, roomId }, { text });
        socket.to(roomId).emit('note_text_changed', { id, text });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
});