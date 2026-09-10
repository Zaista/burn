import express from 'express';
import http from 'http';
import {Server} from 'socket.io';
import mongoose from 'mongoose';
import cors from 'cors';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' }
});

app.use(cors());
app.use(express.json());

// Connect to MongoDB
await mongoose.connect('mongodb://appuser:apppass@localhost:27017/postit', { authSource: 'postit' });


const NoteSchema = new mongoose.Schema({
    text: String,
    position: {
        x: Number,
        y: Number
    }
});
const Note = mongoose.model('Note', NoteSchema);

// REST endpoint to get all notes
app.get('/notes', async (req, res) => {
    const notes = await Note.find();
    res.json(notes);
});

// Socket.IO events
io.on('connection', (socket) => {
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
        const newNote = new Note({ text, position });
        await newNote.save();
        io.emit('noteAdded', { _id: newNote._id, text: newNote.text, position: newNote.position, ignite: !!ignite, clientToken });
    });

    socket.on('deleteNote', async (id) => {
        await Note.findByIdAndDelete(id);
        io.emit('noteDeleted', id);
    });

    // Relay a burn-start to every other client so the fire animation plays
    // on every board, not just the tab that clicked the note. Each client
    // simulates the burn locally (it's randomized, so it won't be pixel-
    // identical everywhere) — actual removal still goes through the
    // existing deleteNote/noteDeleted round trip once a client's local
    // animation finishes.
    socket.on('startBurn', (id) => {
        socket.broadcast.emit('startBurn', id);
    });

    // Live update while dragging (don’t write to DB here — too frequent)
    socket.on('note_dragging', ({ id, x, y }) => {
        socket.broadcast.emit('note_dragging', { id, x, y });
    });

    // Final update: save to DB
    socket.on('note_drag_end', async ({ id, x, y }) => {
        await Note.findByIdAndUpdate(id, { position: { x, y } });
        socket.broadcast.emit('note_moved', { id, x, y });
        // TODO save the position to MongoDB
    });

    // Live text while someone is actively typing (no DB write — too
    // frequent, same as note_dragging above).
    socket.on('note_typing', ({ id, text }: { id: string; text: string }) => {
        socket.broadcast.emit('note_typing', { id, text });
    });

    // A note's text was edited (double-click to edit on the client) — save
    // it and let every other client redraw that note with the new text.
    socket.on('note_text_changed', async ({ id, text }: { id: string; text: string }) => {
        await Note.findByIdAndUpdate(id, { text });
        socket.broadcast.emit('note_text_changed', { id, text });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
});