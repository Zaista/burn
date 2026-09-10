import { useState } from 'react'
import './App.css'
import NoteList from './components/NoteList';
import { socket } from './socket';

function App() {
    const [text, setText] = useState('')

    const addNote = () => {
        socket.emit('addNote', text.trim())
        setText('')
    }

    return (
        <>
            <input
                id="noteInput"
                placeholder="Type a note..."
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') addNote()
                }}
            />
            <button onClick={addNote}>Add</button>
            <NoteList />
        </>
    )
}

export default App
