import React, { useEffect, useRef, useState } from 'react';
import HomeButton from './HomeButton';
import ShareLink from './ShareLink';

// The room header's actions (leave the room, share its link). On a wide
// enough screen (see the shared breakpoint in App.css) they sit directly in
// the top-right corner as their own two buttons; below that there isn't
// reliably enough width for them next to RoomTitle's centered room name
// without the two colliding, so they collapse behind a single hamburger
// button instead. Both layouts are mounted at once — .header-menu-wide and
// .header-menu-compact toggle via that breakpoint's media query in App.css
// — rather than picked in JS, so switching is instant and doesn't need to
// watch the viewport itself.
//
// `position: fixed` (rather than living inside NoteList's board) is what
// keeps this pinned to the real screen corner regardless of NoteList's own
// board being panned/zoomed — see BOARD_WIDTH's comment in NoteList.tsx.
// That's what "sticky" means here: it's a sibling of the board, not a
// descendant of the div NoteList scales, so it never moves with it. The
// board's own pinch/scroll-zoom is implemented entirely as a transform on
// NoteList's own container (not the browser's native pinch-zoom, which is
// disabled in index.html) specifically so this stays a *plain* `fixed`
// element with nothing to compensate for — an earlier version tried to
// counter native pinch-zoom's effect on `fixed` elements with JS, which
// only ever approximated the browser's own zoom a frame or so late and
// read as visibly shaky.
export default function HeaderMenu() {
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement | null>(null);

    // Closes on an outside click/tap or Escape — a dropdown that only
    // closes via its own toggle button feels stuck, especially on mobile
    // where there's no natural "click elsewhere to dismiss" affordance
    // unless it's wired up explicitly. Only relevant to the compact
    // (dropdown) layout — the wide layout has nothing to open/close.
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
        <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 9999 }}>
            <div className="header-menu-wide">
                <HomeButton />
                <ShareLink />
            </div>
            <div ref={containerRef} className="header-menu-compact">
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
                        {/* Navigating away unmounts RoomPage (and this menu
                            with it), so there's no need to close it
                            explicitly here. */}
                        <HomeButton />
                        <ShareLink />
                    </div>
                )}
            </div>
        </div>
    );
}
