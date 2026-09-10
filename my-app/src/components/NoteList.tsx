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

// Burns a hole outward from the note's center using a coarse cellular-
// automaton grid instead of a single vector outline. Each cell independently
// "catches" from an already-burning neighbor with some randomness (biased by
// a static per-cell noise field standing in for paper density), so the fire
// eats outward in uneven, organic fingers rather than a uniform ring. Every
// burning cell then runs through a real flame color ramp — white-hot, then
// orange, then a dark char — before turning to ash and disappearing. This is
// the standard technique for a convincing "burning paper" look; a single
// jittered outline (the previous approach) reads as a stylized wipe, not fire.
function startBurn(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, simplex: SimplexNoise, onComplete?: () => void) {
    const { width, height } = canvas;
    const cellSize = 5;
    const cols = Math.max(1, Math.round(width / cellSize));
    const rows = Math.max(1, Math.round(height / cellSize));
    const cellW = width / cols;
    const cellH = height / rows;
    // Cells are drawn as overlapping circles rather than a visible square
    // grid, so adjacent cells blend into one continuous ragged shape.
    const cellRadius = Math.max(cellW, cellH) * 0.8;
    const sprite = getEmberSprite();

    // Snapshot the note's current artwork once so every frame can repaint
    // this pristine base before compositing the burn state on top of it.
    const baseCanvas = document.createElement('canvas');
    baseCanvas.width = width;
    baseCanvas.height = height;
    const baseCtx = baseCanvas.getContext('2d')!;
    baseCtx.drawImage(canvas, 0, 0);

    const idx = (x: number, y: number) => y * cols + x;
    const cellCount = cols * rows;

    // postit.png isn't a full square — it has transparent margins around the
    // curled note shape. Without this, the CA would happily ignite (and
    // render ash/char/flame circles for) cells that fall outside the visible
    // paper entirely. Sample the base image's alpha within each cell so only
    // cells actually on the note artwork can ever catch fire.
    const ALPHA_THRESHOLD = 20;
    const alphaData = baseCtx.getImageData(0, 0, width, height).data;
    const alphaAt = (px: number, py: number) =>
        alphaData[(Math.min(height - 1, Math.max(0, py)) * width + Math.min(width - 1, Math.max(0, px))) * 4 + 3];
    const visible = new Uint8Array(cellCount);
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            // Sample the cell's center *and* its corners, not just the
            // center — a cell straddling the artwork's edge can have its
            // center land just outside the opaque area while still covering
            // real paper pixels. Sampling only the center wrongly excludes
            // that cell from ever burning, leaving a permanent sliver of
            // unburned note along the artwork's true boundary.
            const x0 = x * cellW, x1 = (x + 1) * cellW - 1;
            const y0 = y * cellH, y1 = (y + 1) * cellH - 1;
            const points: [number, number][] = [
                [(x0 + x1) / 2, (y0 + y1) / 2],
                [x0, y0], [x1, y0], [x0, y1], [x1, y1],
            ];
            visible[idx(x, y)] = points.some(([sx, sy]) => alphaAt(Math.floor(sx), Math.floor(sy)) > ALPHA_THRESHOLD) ? 1 : 0;
        }
    }

    const STAGES = 9; // generations a cell stays actively burning before turning to ash
    // 0 = unburnt, 1..STAGES = burning (counts down each generation), -1 = ash (punched through)
    const heat = new Int8Array(cellCount);
    // Static per-cell noise standing in for paper density/moisture — cells
    // with more "fuel" catch faster once a neighbor ignites them, which is
    // what makes the front ragged instead of a smooth circle.
    const fuel = new Float32Array(cellCount);
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            fuel[y * cols + x] = (simplex.noise2D(x * 0.3, y * 0.3) + 1) / 2;
        }
    }

    // Marks cells that have ever been adjacent to fire (0/1), and how many
    // generations ago that first happened. Used below to guarantee a cell
    // can't stall forever unburnt: its normal per-roll chance only comes
    // from a currently-burning neighbor, which stops attacking once it
    // turns to ash after STAGES generations — an unlucky cell that never
    // won that dice roll would otherwise just never catch, leaving the
    // note permanently un-burned in spots.
    const exposed = new Uint8Array(cellCount);
    const exposureAge = new Uint16Array(cellCount);

    const originX = (cols - 1) / 2;
    const originY = (rows - 1) / 2;
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            const gx = Math.round(originX + dx);
            const gy = Math.round(originY + dy);
            if (gx >= 0 && gx < cols && gy >= 0 && gy < rows && visible[idx(gx, gy)]) heat[idx(gx, gy)] = STAGES;
        }
    }

    const NEIGHBORS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];

    // Advances the fire simulation by one generation: burning cells count
    // down toward ash and roll a chance to ignite each unburnt neighbor.
    // A cell stays "burning" (and re-rolls against its neighbors) for
    // STAGES generations, so the per-roll chance has to stay low — a
    // burning cell gets up to STAGES independent tries at each neighbor
    // over its lifetime, and those compound fast. Without a low per-roll
    // chance the whole grid flash-ignites in a couple of generations
    // instead of spreading as a visible traveling front.
    function step() {
        const next = heat.slice();
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const h = heat[idx(x, y)];
                if (h <= 0) continue;
                next[idx(x, y)] = h - 1 > 0 ? h - 1 : -1;
                NEIGHBORS.forEach(([dx, dy]) => {
                    const nx = x + dx, ny = y + dy;
                    if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) return;
                    const j = idx(nx, ny);
                    if (!visible[j]) return; // off the note's artwork — nothing to burn there
                    if (heat[j] !== 0) return; // already burning or ash
                    exposed[j] = 1; // touched by fire — starts its catch-up clock below
                    const diagonalPenalty = dx !== 0 && dy !== 0 ? 0.6 : 1;
                    if (Math.random() < (0.018 + 0.045 * fuel[j]) * diagonalPenalty) next[j] = STAGES;
                });
            }
        }

        // Starvation escalation: any cell that's been exposed to fire but
        // hasn't caught yet gets a steadily growing chance to ignite on its
        // own each generation, independent of whether the neighbor that
        // originally exposed it is still burning. This guarantees every
        // exposed cell eventually catches within a bounded number of
        // generations, instead of possibly never catching at all.
        for (let i = 0; i < cellCount; i++) {
            if (heat[i] !== 0 || !exposed[i]) continue;
            exposureAge[i]++;
            if (Math.random() < Math.min(1, 0.03 * exposureAge[i])) next[i] = STAGES;
        }

        heat.set(next);
    }

    let embers: Ember[] = [];
    let start: number | null = null;
    let lastTs: number | null = null;
    let stepAcc = 0;
    const stepInterval = 35; // ms per CA generation — controls how fast the fire spreads
    const maxDuration = 4500; // safety cap so a burn always finishes even in a worst-case spread roll

    function frame(ts: number) {
        if (start === null) { start = ts; lastTs = ts; }
        const dt = ts - (lastTs as number);
        lastTs = ts;
        const elapsed = ts - start;

        stepAcc += dt;
        while (stepAcc >= stepInterval) {
            stepAcc -= stepInterval;
            step();
        }

        let burning = false;
        for (let i = 0; i < cellCount; i++) if (heat[i] > 0) { burning = true; break; }
        if (burning && elapsed > maxDuration) {
            for (let i = 0; i < cellCount; i++) if (heat[i] > 0) heat[i] = -1;
            burning = false;
        }

        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(baseCanvas, 0, 0);

        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const h = heat[idx(x, y)];
                if (h === 0) continue;
                const px = (x + 0.5) * cellW;
                const py = (y + 0.5) * cellH;

                if (h === -1) {
                    // fillStyle must be fully opaque here — destination-out erases
                    // by the fill's alpha, and this would otherwise inherit
                    // whatever semi-transparent color a neighboring bright/char
                    // cell last set, leaving a faint speckled "ghost" of paper
                    // behind instead of a clean hole.
                    ctx.fillStyle = '#000';
                    ctx.globalCompositeOperation = 'destination-out';
                    ctx.beginPath();
                    ctx.arc(px, py, cellRadius, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.globalCompositeOperation = 'source-over';
                    continue;
                }

                const t = h / STAGES;
                if (t > 0.4) {
                    // actively burning — bright, additive flame glow
                    ctx.globalCompositeOperation = 'lighter';
                    ctx.fillStyle = t > 0.66 ? 'rgba(255, 248, 220, 0.95)' : 'rgba(255, 160, 40, 0.9)';
                    ctx.beginPath();
                    ctx.arc(px, py, cellRadius, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.globalCompositeOperation = 'source-over';
                    if (Math.random() < 0.05) {
                        embers.push({
                            x: px, y: py,
                            vx: (Math.random() - 0.5) * 0.03,
                            vy: -0.03 - Math.random() * 0.04,
                            size: 6 + Math.random() * 8,
                            life: 1,
                            decay: 0.012 + Math.random() * 0.014,
                        });
                    }
                } else {
                    // burning out — solid dark char left behind before it ashes over
                    ctx.fillStyle = 'rgba(20, 12, 8, 0.92)';
                    ctx.beginPath();
                    ctx.arc(px, py, cellRadius, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }

        // embers drifting up off the burning cells
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

        if (burning || embers.length > 0) {
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
    const burningIds = useRef<Set<string>>(new Set());
    const { notes, isLoading, isError, mutate } = useNotes();
    const [burnedIds, setBurnedIds] = useState<Set<string>>(new Set());

    // Starts the burn animation for a note on THIS client. `broadcast: true`
    // (a local click) also tells every other client to start the same
    // animation on their own board via the startBurn socket event; a
    // broadcast we received from another client just plays it here without
    // re-broadcasting. The guard against already-burning ids also prevents
    // a stray double click from stacking two independent burn simulations
    // on the same canvas.
    const triggerBurn = (id: string, broadcast: boolean) => {
        if (burningIds.current.has(id)) return;
        const canvas = canvasRefs.current[id];
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        burningIds.current.add(id);
        if (broadcast) socket.emit('startBurn', id);
        // Once the animation finishes, tell the server the note is gone for
        // real; its noteDeleted broadcast is what drops the canvas from the
        // page (on every client, whichever one of them burned it).
        startBurn(canvas, ctx, new SimplexNoise(), () => {
            socket.emit('deleteNote', id);
        });
    };

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
        const onRemoteBurn = (id: string) => triggerBurn(id, false);
        socket.on('noteAdded', addNote);
        socket.on('noteDeleted', removeNote);
        socket.on('startBurn', onRemoteBurn);
        return () => {
            socket.off('noteAdded', addNote);
            socket.off('noteDeleted', removeNote);
            socket.off('startBurn', onRemoteBurn);
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

            const postit = new Image();
            postit.src = postitUrl;

            postit.onload = () => {
                // Canvas's shadow properties are computed from the actual
                // alpha channel of what's drawn, not a bounding box — so
                // this naturally follows the note's silhouette (including
                // the curled-corner cutout) instead of casting a plain
                // rectangular shadow.
                ctx.save();
                ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
                ctx.shadowBlur = 10;
                ctx.shadowOffsetX = 0;
                ctx.shadowOffsetY = 5;
                ctx.drawImage(postit, 0, 0, canvas.width, canvas.height);
                ctx.restore();
            };

            canvas.onclick = () => triggerBurn(note._id, true);
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