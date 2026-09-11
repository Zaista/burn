import React from 'react'
import './App.css'
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Landing from './pages/Landing';
import RoomPage from './pages/RoomPage';

function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/room/:roomId" element={<RoomPage />} />
            </Routes>
        </BrowserRouter>
    )
}

export default App
