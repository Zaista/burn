
const socket = io('http://localhost:3000');
const board = document.getElementById('board');

async function fetchNotes() {
    const res = await fetch('http://localhost:3000/notes');
    const notes = await res.json();
    notes.forEach(addNoteToBoard);
}

function addNoteToBoard(note) {
    const canvas = document.createElement('canvas');
    // div.className = 'note';
    // div.textContent = note.text;
    canvas.width = 400;
    canvas.height = 400;
    canvas.dataset.id = note._id;
    canvas.setAttribute('name', note._id);
    // div.onclick = () => socket.emit('deleteNote', note._id);
    board.appendChild(canvas);
    setBurn(note._id);
}

function removeNoteFromBoard(id) {
    const el = [...document.querySelectorAll('.note')].find(n => n.dataset.id === id);
    if (el) el.remove();
}

function addNote() {
    const text = document.getElementById('noteInput').value;
    if (text.trim()) {
        socket.emit('addNote', text);
        document.getElementById('noteInput').value = '';
    }
}

socket.on('noteAdded', addNoteToBoard);
socket.on('noteDeleted', removeNoteFromBoard);

fetchNotes();

interact('.note').draggable({
    listeners: {
        move (event) {
            const target = event.target;
            const id = target.dataset.id;

            const x = (parseFloat(target.getAttribute('data-x')) || 0) + event.dx;
            const y = (parseFloat(target.getAttribute('data-y')) || 0) + event.dy;

            target.style.transform = `translate(${x}px, ${y}px)`;
            target.setAttribute('data-x', x);
            target.setAttribute('data-y', y);

            // Emit real-time drag position
            socket.emit('note_dragging', { id, x, y });
        },
        end (event) {
            const target = event.target;
            const id = target.dataset.id;
            const x = parseFloat(target.getAttribute('data-x'));
            const y = parseFloat(target.getAttribute('data-y'));

            // Save final position to DB
            socket.emit('note_drag_end', { id, x, y });
        }
    }
});

// When another user moves a note
socket.on('note_dragging', ({ id, x, y }) => {
    const el = document.querySelector(`.note[data-id="${id}"]`);
    if (el) {
        el.style.transform = `translate(${x}px, ${y}px)`;
        el.setAttribute('data-x', x);
        el.setAttribute('data-y', y);
    }
});