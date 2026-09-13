import React, { useEffect, useRef, useState } from 'react';
import HomeButton from './HomeButton';
import ShareLink from './ShareLink';

// The room header's actions (leave the room, share its link), collapsed
// behind a single hamburger button instead of sitting in the top-right
// corner as their own full-width buttons. Two wide buttons there used to
// collide with RoomTitle's centered room name on a narrow phone screen —
// see the fixed top-right corner + centered title in RoomPage/RoomTitle —
// a single small icon leaves the title far more room before that happens,
// and RoomTitle itself now truncates instead of overlapping as a backstop.
//
// `position: fixed` (rather than living inside NoteList's board) is what
// keeps this pinned to the real screen corner regardless of NoteList's own
// board being panned/pinch-zoomed — see BOARD_WIDTH's comment in
// NoteList.tsx. That's what "sticky" means here: it's a sibling of the
// board, not a descendant of the div NoteList scales, so it never moves
// with it.
export default function HeaderMenu() {
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement | null>(null);

    // Closes on an outside click/tap or Escape — a dropdown that only
    // closes via its own toggle button feels stuck, especially on mobile
    // where there's no natural "click elsewhere to dismiss" affordance
    // unless it's wired up explicitly.
    useEffect(() => {
        if (!open) return;
        const onPointerDown = (e: PointerEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);

    return (
        <div ref={containerRef} style={{ position: 'fixed', top: 16, right: 16, zIndex: 9999 }}>
            <button
                onClick={() => setOpen(o => !o)}
                aria-label="Room menu"
                aria-expanded={open}
                style={{ fontSize: '1.1em', lineHeight: 1, padding: '0.55em 0.7em' }}
            >
                ☰
            </button>
            {open && (
                <div
                    className="header-menu-panel"
                    style={{
                        position: 'absolute',
                        top: 'calc(100% + 8px)',
                        right: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                        padding: 8,
                        borderRadius: 10,
                        background: '#ffffff',
                        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.18)',
                        minWidth: 160,
                    }}
                >
                    {/* Navigating away unmounts RoomPage (and this menu with
                        it), so there's no need to close it explicitly here. */}
                    <HomeButton />
                    <ShareLink />
                </div>
            )}
        </div>
    );
}
