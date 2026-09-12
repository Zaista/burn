// hooks/useNotes.ts
import useSWR from 'swr';
import { API_BASE_URL } from '../config';

export type Note = {
    _id: string;
    text: string;
    position: {
        x: number
        y: number
    };
};

const fetcher = (url: string) => fetch(url).then((res) => {
    if (!res.ok) throw new Error('Failed to fetch');
    return res.json();
});

export function useNotes(roomId: string) {
    const { data, error, isLoading, mutate } = useSWR<Note[]>(
        roomId ? `${API_BASE_URL}/rooms/${roomId}/notes` : null,
        fetcher
    );

    return {
        notes: data,
        isLoading,
        isError: error,
        mutate,
    };
}