import {useState} from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'
import React from 'react'
import NoteList from './components/NoteList';
import useSWR, { Fetcher } from 'swr'
import {useNotes} from "./hooks/useNotes";

function App() {
    const [count, setCount] = useState(0)

    return (
        <>
            <input id="noteInput" placeholder="Type a note..."/>
            {<button onClick={useNotes}>Add</button>}
            <NoteList />
        </>
    )
}

export default App
