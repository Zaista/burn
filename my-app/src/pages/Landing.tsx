import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useRecentRooms } from '../hooks/useRecentRooms';
import { API_BASE_URL } from '../config';

// The only way a room comes into existence — POSTs to the server for a
// fresh unguessable id, then navigates straight into it. Sharing that room
// is then just sharing the resulting /room/:id URL (see ShareLink).
export default function Landing() {
    const navigate = useNavigate();
    const [name, setName] = useState('');
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { rooms, recordVisit, forgetRoom } = useRecentRooms();

    const trimmedName = name.trim();

    const createRoom = async () => {
        if (!trimmedName) {
            setError('Give the room a name first.');
            return;
        }
        setCreating(true);
        setError(null);
        try {
            const res = await fetch(`${API_BASE_URL}/rooms`, {
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
            minHeight: '80svh', // see index.css's body rule for why svh, not vh
            gap: '1rem',
        }}>
            <h1>🔥 Burn</h1>
            <p>Add notes on a shared board. Then BURN them!</p>
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
                    {/* Capped and independently scrollable so a long list
                        scrolls within itself instead of growing the whole
                        page past one viewport — on a phone especially, that
                        used to hand you a page-level scrollbar for what's
                        otherwise a single fixed screen. */}
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '35vh', overflowY: 'auto' }}>
                        {rooms.map((room) => (
                            <li key={room.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                                <Link to={`/room/${room.id}`}>{room.name}</Link>
                                <button
                                    onClick={() => forgetRoom(room.id)}
                                    aria-label={`Remove ${room.name} from your rooms`}
                                    title="Remove from this list (the room itself isn't deleted)"
                                    style={{
                                        background: 'none',
                                        border: 'none',
                                        cursor: 'pointer',
                                        opacity: 0.5,
                                        fontSize: '1rem',
                                        lineHeight: 1,
                                        padding: '0.2rem 0.4rem',
                                    }}
                                >
                                    ×
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
