import React from 'react';

// Displays the room's name, centered at the top of the board. The name is
// fixed at creation — there's no rename affordance (see CLAUDE.md / POST
// /rooms) — so this is a plain, static label, not editable in place.
//
// Capped to leave room for HeaderMenu's hamburger button in the opposite
// corner (roughly 2x its own width plus gutter, so the centered title never
// reaches under it) and truncated with an ellipsis past that — a backstop
// for a long room name on a narrow phone, since centering means only the
// *first* overlap (not truncation) would otherwise be visible.
export default function RoomTitle({ name }: { name: string }) {
    return (
        <div style={{
            position: 'fixed',
            top: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 9999,
            textAlign: 'center',
            maxWidth: 'calc(100vw - 120px)',
        }}>
            <h2 style={{ margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {name || 'Untitled room'}
            </h2>
        </div>
    );
}
