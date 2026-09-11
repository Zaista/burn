import React from 'react';

// Displays the room's name, centered at the top of the board. The name is
// fixed at creation — there's no rename affordance (see CLAUDE.md / POST
// /rooms) — so this is a plain, static label, not editable in place.
export default function RoomTitle({ name }: { name: string }) {
    return (
        <div style={{
            position: 'fixed',
            top: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 9999,
            textAlign: 'center',
        }}>
            <h2 style={{ margin: 0 }}>{name || 'Untitled room'}</h2>
        </div>
    );
}
