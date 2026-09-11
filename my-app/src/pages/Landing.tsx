import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const API_BASE = 'http://localhost:3000';

// The only way a room comes into existence — POSTs to the server for a
// fresh unguessable id, then navigates straight into it. Sharing that room
// is then just sharing the resulting /room/:id URL (see ShareLink).
export default function Landing() {
    const navigate = useNavigate();
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const createRoom = async () => {
        setCreating(true);
        setError(null);
        try {
            const res = await fetch(`${API_BASE}/rooms`, { method: 'POST' });
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
            <button onClick={createRoom} disabled={creating}>
                {creating ? 'Creating…' : 'Create a room'}
            </button>
            {error && <p style={{ color: 'red' }}>{error}</p>}
        </div>
    );
}
