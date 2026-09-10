// hooks/useNotes.ts
import useSWR from 'swr';

export type Note = {
    _id: string;
    text: string;
    position: {
        x: number
        y: any
    };
};

const fetcher = (url: string) => fetch(url).then((res) => {
    if (!res.ok) throw new Error('Failed to fetch');
    return res.json();
});

export function useNotes() {
    const { data, error, isLoading, mutate } = useSWR<Note[]>('http://localhost:3000/notes', fetcher);

    return {
        notes: data,
        isLoading,
        isError: error,
        mutate,
    };
}