import React, {useEffect, useMemo, useRef, useState} from 'react';
import { useNotes, type Note } from '../hooks/useNotes';
import SimplexNoise from './SimplexNoise';
import { socket } from '../socket';
import postitUrl from '../assets/postit.png';

// Small pre-rendered glow used for every ember particle, so a frame only ever
// needs a cheap drawImage() instead of building a radial gradient per-particle.
let emberSprite: HTMLCanvasElement | null = null;
function getEmberSprite(): HTMLCanvasElement {
    if (emberSprite) return emberSprite;
    const size = 32;
    const sprite = document.createElement('canvas');
    sprite.width = sprite.height = size;
    const sctx = sprite.getContext('2d')!;
    const gradient = sctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255, 235, 180, 0.95)');
    gradient.addColorStop(0.4, 'rgba(255, 150, 40, 0.7)');
    gradient.addColorStop(1, 'rgba(255, 80, 0, 0)');
    sctx.fillStyle = gradient;
    sctx.fillRect(0, 0, size, size);
    emberSprite = sprite;
    return sprite;
}

type Ember = { x: number; y: number; vx: number; vy: number; size: number; life: number; decay: number };

// Burns a hole outward from the note's center. Instead of scanning every pixel
// each frame (the old approach), it traces a noise-jittered polygon for the
// burning edge and erases with it — cheap canvas path fills instead of a
// per-pixel loop — then layers a charred rim, a bright ember line, and a
// handful of drifting ember particles on top.
function startBurn(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, simplex: SimplexNoise, onComplete?: () => void) {
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const maxRadius = Math.hypot(cx, cy) + 12;
    const duration = 1300; // ms — burns at the same speed regardless of frame rate
    const sprite = getEmberSprite();

    let embers: Ember[] = [];
    let start: number | null = null;
    let lastTs: number | null = null;

    function edgePath(radius: number) {
        const segments = 20;
        ctx.beginPath();
        for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            const noise = simplex.noise2D(Math.cos(angle) * 1.6, Math.sin(angle) * 1.6 + radius * 0.015);
            const r = Math.max(0, radius + noise * 9);
            const x = cx + Math.cos(angle) * r;
            const y = cy + Math.sin(angle) * r;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
    }

    function spawnEmbers(radius: number, count: number) {
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            embers.push({
                x: cx + Math.cos(angle) * radius,
                y: cy + Math.sin(angle) * radius,
                vx: (Math.random() - 0.5) * 0.03,
                vy: -0.03 - Math.random() * 0.04,
                size: 6 + Math.random() * 8,
                life: 1,
                decay: 0.012 + Math.random() * 0.014,
            });
        }
    }

    function frame(ts: number) {
        if (start === null) { start = ts; lastTs = ts; }
        const dt = ts - (lastTs as number);
        lastTs = ts;
        const t = Math.min((ts - start) / duration, 1);
        const radius = t * maxRadius;

        if (t < 1) {
            // charred smudge trailing just behind the flame front
            edgePath(radius + 5);
            ctx.lineWidth = 10;
            ctx.strokeStyle = 'rgba(35, 18, 8, 0.5)';
            ctx.stroke();

            // bright ember line right at the burning edge
            edgePath(radius);
            ctx.lineWidth = 3;
            ctx.strokeStyle = 'rgba(255, 130, 40, 0.9)';
            ctx.stroke();

            // eat away the burned paper
            ctx.globalCompositeOperation = 'destination-out';
            edgePath(Math.max(0, radius - 1));
            ctx.fill();
            ctx.globalCompositeOperation = 'source-over';

            spawnEmbers(radius, 2);
        }

        // embers drifting up off the burning edge
        embers.forEach(e => {
            e.x += e.vx * dt;
            e.y += e.vy * dt;
            e.life -= e.decay * (dt / 16.7);
        });
        embers = embers.filter(e => e.life > 0);

        ctx.globalCompositeOperation = 'lighter';
        embers.forEach(e => {
            const size = e.size * e.life;
            ctx.globalAlpha = e.life;
            ctx.drawImage(sprite, e.x - size / 2, e.y - size / 2, size, size);
        });
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';

        if (t < 1 || embers.length > 0) {
            requestAnimationFrame(frame);
        } else {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            onComplete?.();
        }
    }

    requestAnimationFrame(frame);
}

const NoteList: React.FC = () => {

    const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
    const initializedIds = useRef<Set<string>>(new Set());
    const { notes, isLoading, isError, mutate } = useNotes();
    const [burnedIds, setBurnedIds] = useState<Set<string>>(new Set());

    // Notes that have finished burning are dropped from the board entirely.
    const visibleNotes = useMemo(
        () => (notes ?? []).filter((note) => !burnedIds.has(note._id)),
        [notes, burnedIds]
    );

    const removeNote = (id: string) => {
        initializedIds.current.delete(id);
        setBurnedIds(prev => new Set(prev).add(id));
    };

    // The server broadcasts noteAdded to every client (including the one that
    // created it) — drop it straight into the SWR cache instead of waiting on
    // the next revalidation, so new notes show up instantly.
    const addNote = (note: Note) => {
        mutate(current => (current?.some(n => n._id === note._id) ? current : [...(current ?? []), note]), {
            revalidate: false,
        });
    };

    // The server deletes the note and broadcasts noteDeleted to every client
    // (including this one) once it's gone — that's what actually drops it
    // from the board, whether it was burned here or in another tab.
    useEffect(() => {
        socket.on('noteAdded', addNote);
        socket.on('noteDeleted', removeNote);
        return () => {
            socket.off('noteAdded', addNote);
            socket.off('noteDeleted', removeNote);
        };
    }, []);

    useEffect(() => {
        visibleNotes.forEach((note) => {
            // Each canvas is only painted and wired up once — burning one note
            // shrinks visibleNotes and re-runs this effect, and we don't want
            // that to reset the others mid-animation.
            if (initializedIds.current.has(note._id)) return;
            const canvas = canvasRefs.current[note._id];
            if (!canvas) return;
            initializedIds.current.add(note._id);
            canvas.width = 200;
            canvas.height = 200;
            canvas.dataset.id = note._id;
            canvas.setAttribute('name', note._id);

            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const simplex = new SimplexNoise();

            const postit = new Image();
            postit.src = postitUrl;

            postit.onload = () => {
                ctx.drawImage(postit, 0, 0, canvas.width, canvas.height);
            };

            canvas.onclick = () => {
                // Once the animation finishes, tell the server the note is
                // gone for real; its noteDeleted broadcast (above) is what
                // drops the canvas from the page.
                startBurn(canvas, ctx, simplex, () => {
                    socket.emit('deleteNote', note._id);
                });
            }
        })

    }, [visibleNotes]);



    if (isLoading) return <p>Loading...</p>;
    if (isError) return <p style={{ color: 'red' }}>Failed to load notes</p>;

    // return <canvas ref={canvasRef} />;

    const setCanvasRef = (id: string) => (el: HTMLCanvasElement | null): void => {
        if (el) canvasRefs.current[id] = el;
        else delete canvasRefs.current[id];
    };

    return (
        <div>
            {visibleNotes.map((note) => (
                <canvas key={note._id} id={note._id} ref={setCanvasRef(String(note._id))} />
            ))}
        </div>
    )

    // return (
    //     <ul>
    //         {notes.map((user) => (
    //             <li key={user._id}>y: {JSON.stringify(user.position?.y)}
    //                 x: {<strong>{user.position?.x}</strong>}
    //             </li>
    //         ))}
    //     </ul>
    // );
};

export default NoteList;




// function useNote() {
//     const getNotes = () => fetch('/notes').then(res => res.json())
//     // const uid = '<note_id>'
//     const fetcher: Fetcher<Note, string> = (id) => getNotes()
//     const { data, error, isLoading } = useSWR('', fetcher)
//     console.log(data)
//     return {
//         note: data,
//         isLoading,
//         isError: error
//     }
// }