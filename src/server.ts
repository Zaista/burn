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
    socket.on('addNote', async (text) => {
        const newNote = new Note({ text });
        await newNote.save();
        io.emit('noteAdded', newNote);
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
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
});