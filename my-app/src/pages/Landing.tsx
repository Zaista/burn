import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useRecentRooms } from '../hooks/useRecentRooms';

const API_BASE = 'http://localhost:3000';

// The only way a room comes into existence — POSTs to the server for a
// fresh unguessable id, then navigates straight into it. Sharing that room
// is then just sharing the resulting /room/:id URL (see ShareLink).
export default function Landing() {
    const navigate = useNavigate();
    const [name, setName] = useState('');
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { rooms, recordVisit } = useRecentRooms();

    const trimmedName = name.trim();

    const createRoom = async () => {
        if (!trimmedName) {
            setError('Give the room a name first.');
            return;
        }
        setCreating(true);
        setError(null);
        try {
            const res = await fetch(`${API_BASE}/rooms`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: trimmedName }),
            });
            if (!res.ok) throw new Error('Failed to create room');
            const { id } = await res.json();
            recordVisit(id, trimmedName);
            navigate(`/room/${id}`);
        } catch {
            setError('Could not create a room — is the server running?');
            setCreating(false);
        }
    };

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '80vh',
            gap: '1rem',
        }}>
            <h1>🔥 Burn</h1>
            <p>Drop notes on a shared board. Burn the ones you're done with.</p>
            <input
                className="room-name-input"
                value={name}
                onChange={(e) => { setName(e.target.value); if (error) setError(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') createRoom(); }}
                placeholder="Room name"
                maxLength={80}
                required
            />
            <button onClick={createRoom} disabled={creating || !trimmedName}>
                {creating ? 'Creating…' : 'Create a room'}
            </button>
            {error && <p style={{ color: 'red' }}>{error}</p>}

            {rooms.length > 0 && (
                <div style={{ marginTop: '2rem', width: '100%', maxWidth: 320, textAlign: 'left' }}>
                    <h2 style={{ fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.6, margin: '0 0 0.5rem' }}>
                        Your rooms
                    </h2>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        {rooms.map((room) => (
                            <li key={room.id}>
                                <Link to={`/room/${room.id}`}>{room.name}</Link>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
