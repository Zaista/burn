import { useCallback, useState } from 'react';

export type RecentRoom = { id: string; name: string; lastVisitedAt: number };

const STORAGE_KEY = 'burn:recentRooms';
const MAX_RECENT_ROOMS = 20;

function readRecentRooms(): RecentRoom[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((r): r is RecentRoom =>
            r && typeof r.id === 'string' && typeof r.name === 'string' && typeof r.lastVisitedAt === 'number'
        );
    } catch {
        // Private browsing, storage disabled, corrupted JSON, etc. — just
        // behave as if there's no history rather than breaking the page.
        return [];
    }
}

function writeRecentRooms(rooms: RecentRoom[]) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(rooms));
    } catch {
        // Quota exceeded, storage blocked, etc. — nothing to do, the list
        // just won't persist this time.
    }
}

// Tracks rooms this browser has created or visited — a lightweight,
// per-browser "recently used" list, not a real account/history feature
// (there's no login — see CLAUDE.md). State is read from localStorage once
// at mount; recordVisit updates both this hook's state and localStorage
// directly, so a differently-mounted instance (e.g. Landing, reached via
// the Home button right after visiting a room) just picks up the latest
// value the next time *it* mounts, rather than needing any cross-component
// or cross-tab sync.
export function useRecentRooms() {
    const [rooms, setRooms] = useState<RecentRoom[]>(() => readRecentRooms());

    // Records a room as just-visited (creating one counts as a visit too),
    // moving it to the front and deduping/capping the list. Safe to call
    // repeatedly with the same room (e.g. on every RoomPage mount) — the
    // timestamp and name just get refreshed.
    const recordVisit = useCallback((id: string, name: string) => {
        setRooms(prev => {
            const next = [
                { id, name, lastVisitedAt: Date.now() },
                ...prev.filter(r => r.id !== id),
            ].slice(0, MAX_RECENT_ROOMS);
            writeRecentRooms(next);
            return next;
        });
    }, []);

    return { rooms, recordVisit };
}
