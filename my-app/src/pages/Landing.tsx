import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const API_BASE = 'http://localhost:3000';

// The only way a room comes into existence — POSTs to the server for a
// fresh unguessable id, then navigates straight into it. Sharing that room
// is then just sharing the resulting /room/:id URL (see ShareLink).
export default function Landing() {
    const navigate = useNavigate();
    const [name, setName] = useState('');
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);

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
        </div>
    );
}
