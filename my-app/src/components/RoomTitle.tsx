import React, { useEffect, useRef, useState } from 'react';
import { socket } from '../socket';

const MAX_NAME_LENGTH = 80;

// Displays the room's name and lets it be renamed in place — same
// double-click-to-edit convention as a note's text (see NoteList). The
// rename is broadcast (not persisted-then-refetched) so every other viewer
// currently on the board sees the new name immediately.
export default function RoomTitle({ initialName }: { initialName: string }) {
    const [name, setName] = useState(initialName);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(initialName);
    const inputRef = useRef<HTMLInputElement>(null);

    // Adopt the room's fetched name whenever it actually changes (e.g. SWR
    // revalidating on window focus). Deliberately depends on `initialName`
    // alone, not `editing` — this prop doesn't change mid-edit, so there's
    // nothing here for a draft to race against. Committing a rename used to
    // also flip `editing` in the same tick, which re-ran this effect against
    // the still-stale `initialName` prop and stomped the just-set local
    // name right back to the old value until the next fetch caught up.
    useEffect(() => {
        setName(initialName);
    }, [initialName]);

    // Another viewer renamed the room — update live.
    useEffect(() => {
        const onRenamed = (newName: string) => setName(newName);
        socket.on('room_renamed', onRenamed);
        return () => {
            socket.off('room_renamed', onRenamed);
        };
    }, []);

    useEffect(() => {
        if (editing) {
            inputRef.current?.focus();
            inputRef.current?.select();
        }
    }, [editing]);

    const startEditing = () => {
        setDraft(name);
        setEditing(true);
    };

    const commit = () => {
        setEditing(false);
        const trimmed = draft.trim().slice(0, MAX_NAME_LENGTH);
        // The name is mandatory — an empty rename reverts to whatever the
        // room was already called instead of blanking it out (the server
        // would reject it anyway, see room_rename).
        if (!trimmed || trimmed === name) return;
        setName(trimmed);
        socket.emit('room_rename', trimmed);
    };

    const cancel = () => setEditing(false);

    return (
        <div style={{
            position: 'fixed',
            top: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 9999,
            textAlign: 'center',
        }}>
            {editing ? (
                <input
                    ref={inputRef}
                    value={draft}
                    maxLength={MAX_NAME_LENGTH}
                    placeholder="Untitled room"
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commit}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') commit();
                        if (e.key === 'Escape') cancel();
                    }}
                    style={{ font: 'inherit', fontSize: '1.3rem', textAlign: 'center' }}
                />
            ) : (
                <h2
                    onDoubleClick={startEditing}
                    title="Double-click to rename"
                    style={{ margin: 0, cursor: 'text' }}
                >
                    {name || 'Untitled room'}
                </h2>
            )}
        </div>
    );
}
