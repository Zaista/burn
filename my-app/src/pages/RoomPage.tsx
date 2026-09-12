import React, { useEffect } from 'react';
import useSWR from 'swr';
import { useParams } from 'react-router-dom';
import NoteList from '../components/NoteList';
import ShareLink from '../components/ShareLink';
import RoomTitle from '../components/RoomTitle';
import HomeButton from '../components/HomeButton';
import { useRecentRooms } from '../hooks/useRecentRooms';
import { API_BASE_URL } from '../config';

type RoomInfo = { id: string; name: string };

const fetcher = (url: string) => fetch(url).then((res) => {
    if (!res.ok) throw new Error('Room not found');
    return res.json();
});

// Confirms the room in the URL actually exists before rendering its board —
// a typo'd or stale link should show a clear "not found", not silently open
// an empty board (rooms only ever get created via Landing's "Create a room").
export default function RoomPage() {
    const { roomId } = useParams<{ roomId: string }>();
    const { data, error, isLoading } = useSWR<RoomInfo>(roomId ? `${API_BASE_URL}/rooms/${roomId}` : null, fetcher);
    const { recordVisit } = useRecentRooms();

    // Only fires once the room is confirmed to exist (data.name is unset
    // while loading or on a 404) — this is what catches a room reached via
    // a shared link rather than created here.
    useEffect(() => {
        if (roomId && data?.name) recordVisit(roomId, data.name);
    }, [roomId, data?.name, recordVisit]);

    if (isLoading) return <p style={{ textAlign: 'center', marginTop: '4rem' }}>Loading room…</p>;

    if (error || !roomId) {
        return (
            <div style={{ textAlign: 'center', marginTop: '4rem' }}>
                <p>This room doesn't exist (or the link is wrong).</p>
                <a href="/">Create a new room</a>
            </div>
        );
    }

    // Keying by roomId forces a full remount when navigating between rooms,
    // so NoteList's per-room state never carries over from a previous room.
    return (
        <>
            <div style={{
                position: 'fixed',
                top: 16,
                right: 16,
                zIndex: 9999,
                display: 'flex',
                gap: 8,
            }}>
                <HomeButton />
                <ShareLink />
            </div>
            <RoomTitle name={data?.name ?? ''} />
            <NoteList roomId={roomId} key={roomId} />
        </>
    );
}
