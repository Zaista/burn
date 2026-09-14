import React, {useEffect, useMemo, useRef, useState} from 'react';
import { useNotes, type Note } from '../hooks/useNotes';
import SimplexNoise from './SimplexNoise';
import { socket } from '../socket';
import postitUrl from '../assets/postit.png';
import coalUrl from '../assets/coal.png';

// Notes are 200x200 — a bit smaller reads as roughly 80% of that.
const COAL_SIZE = 160;

// The board is laid out in a fixed logical size — roughly a typical laptop
// screen — instead of whatever the actual device's viewport happens to be.
// Every position (coal, dispenser, notes) is computed in these board-local
// pixels, and the whole board is then rendered inside a container of exactly
// this size that gets CSS-scaled (uniformly, so it never distorts) to fit
// the real viewport — see the `scaleRef`/`zoomRef` state in NoteList. A
// laptop/desktop viewport close to this size ends up at ~1:1 scale, i.e.
// looks exactly like it always has; a phone just gets a small, fully
// zoomed-out view of the same board, which the user can pinch-zoom into.
// This is what makes two different screens agree on "the same distance from
// the coal": that used to be a fraction of each device's own (differently
// sized) viewport, so it was only ever the same *relative* to that device's
// screen. Fractions are now taken against these fixed dimensions instead,
// so they mean the same absolute board position everywhere.
const BOARD_WIDTH = 1440;
const BOARD_HEIGHT = 900;

// The zoom-in gesture (two-finger pinch, or ctrl+wheel on a trackpad) is
// implemented entirely ourselves as a transform on the board's own
// container — see zoomRef/panRef/applyBoardTransform below — rather than
// relying on the browser's native pinch-zoom (disabled via index.html's
// viewport meta). Native pinch-zoom magnifies the *whole rendered page*,
// including HeaderMenu/RoomTitle's `position: fixed` elements, which then
// have to be dragged back into view with JS every time the browser's own
// zoom moves them — that compensation is inherently laggy (it's reacting a
// frame or more behind the browser's own compositor-level zoom) and reads
// as shaky. Scoping the zoom to just this component's own transform means
// `position: fixed` siblings elsewhere are never touched by it at all, so
// there's nothing to compensate for. Zoom is clamped to [1, MAX_ZOOM] — 1
// (never below) is the auto-fit view above; there's no reason to zoom out
// further than that.
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

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

// A note is "placed" once it has a saved x/y (from a previous drag, by
// anyone). Until then it lives in the legacy fallback stack below.
const isPlaced = (note: Note): boolean =>
    typeof note.position?.x === 'number' && typeof note.position?.y === 'number';

// Notes are a fixed 200x200 board-local px, and positions are
// stored/broadcast as fractions (0..1ish) of the fixed BOARD_WIDTH/
// BOARD_HEIGHT — never of the real device's viewport, which is what used to
// make a note saved on one screen land somewhere else entirely on a very
// differently-sized one (see BOARD_WIDTH's comment above).
//
// Critically, the fraction has to be of the note's CENTER, not its
// top-left corner: the note's fixed half-width/height offset from center
// doesn't scale the way a fraction does, so converting the corner directly
// still drifts. E.g. a note centered on the board (top-left x=620) converts,
// corner-first, to fraction 620/1440=0.43 — re-expanded on another board
// size that's no longer anywhere near center. Converting the CENTER
// (x=720 -> fraction 0.5, same as the coal's own 50%) is exact regardless
// of board size.
const NOTE_SIZE = 200;
const topLeftToCenterFraction = (topLeftPx: number, dimension: number): number =>
    (topLeftPx + NOTE_SIZE / 2) / dimension;
const centerFractionToTopLeft = (fraction: number, dimension: number): number =>
    fraction * dimension - NOTE_SIZE / 2;

// A note saved before positions became fractions has a raw top-left pixel
// value instead (typically in the hundreds) — a real fraction is
// essentially never this large. Treat anything past a sane fraction range
// as that legacy format and use it as-is (it's already a top-left px, no
// center adjustment needed) rather than reinterpreting it as a fraction;
// the first time anyone drags that note, it's silently re-saved in the
// new format (see setNotePosition).
const LEGACY_PIXEL_THRESHOLD = 3;
const notePositionToPixels = (position: { x: number; y: number }) => ({
    left: Math.abs(position.x) > LEGACY_PIXEL_THRESHOLD ? position.x : centerFractionToTopLeft(position.x, BOARD_WIDTH),
    top: Math.abs(position.y) > LEGACY_PIXEL_THRESHOLD ? position.y : centerFractionToTopLeft(position.y, BOARD_HEIGHT),
});

const STACK_OFFSET_STEP = 6; // fan spacing shared by both stacks below

// The corner dispenser: a fixed, never-shrinking pile of blank notes. It
// isn't backed by real documents — grabbing one just spawns a real note at
// the drop point (see the dispenser effect further down) while the pile
// itself snaps right back to DISPENSER_COUNT notes.
const DISPENSER_ORIGIN = { x: 20, y: 20 };
const DISPENSER_COUNT = 4;

// Real notes created before the dispenser existed (or otherwise missing a
// saved position) fall back to piling up here instead, offset below the
// dispenser so the two stacks don't visually merge.
const LEGACY_STACK_ORIGIN = { x: 20, y: 20 + 200 + DISPENSER_COUNT * STACK_OFFSET_STEP + 20 };

// A pointer move shorter than this still counts as a click (burns the
// note, or is ignored on a dispenser note) rather than a drag — otherwise a
// hand that isn't perfectly still while clicking would accidentally start
// dragging.
const DRAG_THRESHOLD = 4;

// The coal always sits dead-center of the board (see the <img> below, which
// is centered with left/top: 50%) — computed once in board-local pixels so
// hit-testing (isOverCoal, the ignition point in triggerBurn) never needs to
// measure the actual rendered DOM, which would otherwise have to account for
// the board's CSS scale (see `scale` below) to get back to board-local px.
const COAL_BOX = {
    left: BOARD_WIDTH / 2 - COAL_SIZE / 2,
    top: BOARD_HEIGHT / 2 - COAL_SIZE / 2,
    right: BOARD_WIDTH / 2 + COAL_SIZE / 2,
    bottom: BOARD_HEIGHT / 2 + COAL_SIZE / 2,
};

// How much to uniformly shrink (or, capped at 1, never grow) the fixed
// BOARD_WIDTH x BOARD_HEIGHT board to "contain"-fit the real viewport —
// scaling both axes by the same factor is what keeps distances and angles
// on the board identical everywhere, instead of the old per-axis viewport
// fraction, which stretched x and y independently and distorted them. A
// laptop/desktop viewport at or above the board's own size gets scale 1,
// i.e. today's exact look; a phone gets a small, fully-visible, pinch-
// zoomable view of the same board.
function computeScale(): number {
    if (typeof window === 'undefined') return 1;
    return Math.min(1, window.innerWidth / BOARD_WIDTH, window.innerHeight / BOARD_HEIGHT);
}

// Loaded once and reused for every note — was a fresh `new Image()` per
// paintNote() call, so rapid successive redraws (e.g. live-typing sync
// firing on every keystroke) could each wait on their own onload and finish
// out of order, letting a stale call's text land on top of a newer one.
// Drawing synchronously once this is loaded removes that async gap.
let postitImage: HTMLImageElement | null = null;
function withPostitImage(onReady: (img: HTMLImageElement) => void) {
    if (postitImage && postitImage.complete) {
        onReady(postitImage);
        return;
    }
    if (!postitImage) {
        postitImage = new Image();
        postitImage.src = postitUrl;
    }
    postitImage.addEventListener('load', () => onReady(postitImage!), { once: true });
}

// Draws the note artwork (with its alpha-aware drop shadow) onto a canvas.
// Shared by real notes and the dispenser's template notes, which need to
// look identical.
function paintNote(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, onDone?: () => void) {
    withPostitImage((postit) => {
        // Canvas's shadow properties are computed from the actual alpha
        // channel of what's drawn, not a bounding box — so this naturally
        // follows the note's silhouette (including the curled-corner
        // cutout) instead of casting a plain rectangular shadow.
        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 5;
        ctx.drawImage(postit, 0, 0, canvas.width, canvas.height);
        ctx.restore();
        onDone?.();
    });
}

const TEXT_MAX_FONT_SIZE = 22;
const TEXT_MIN_FONT_SIZE = 10;
const TEXT_PADDING = 24; // inset from the canvas edges the text has to fit within
const TEXT_FONT_FAMILY = 'system-ui, sans-serif';
const TEXT_COLOR = '#2b2418';

// Greedy word-wrap: breaks `text` into lines no wider than maxWidth under
// ctx's current font.
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const lines: string[] = [];
    text.split('\n').forEach(paragraph => {
        const words = paragraph.split(/\s+/).filter(Boolean);
        if (words.length === 0) { lines.push(''); return; }
        let line = '';
        words.forEach(word => {
            const candidate = line ? `${line} ${word}` : word;
            if (line && ctx.measureText(candidate).width > maxWidth) {
                lines.push(line);
                line = word;
            } else {
                line = candidate;
            }
        });
        lines.push(line);
    });
    return lines;
}

// Draws a note's text centered on the canvas, shrinking the font size (down
// to TEXT_MIN_FONT_SIZE) until the wrapped text fits vertically — like Miro,
// longer notes get smaller text instead of overflowing. Past that floor it
// just wraps at the smallest size and may clip; that's the "certain limit".
function drawNoteText(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, text: string) {
    if (!text.trim()) return;
    const maxWidth = canvas.width - TEXT_PADDING * 2;
    const maxHeight = canvas.height - TEXT_PADDING * 2;

    let fontSize = TEXT_MAX_FONT_SIZE;
    let lines: string[] = [];
    let lineHeight = fontSize * 1.25;
    for (; fontSize >= TEXT_MIN_FONT_SIZE; fontSize--) {
        ctx.font = `${fontSize}px ${TEXT_FONT_FAMILY}`;
        lines = wrapText(ctx, text, maxWidth);
        lineHeight = fontSize * 1.25;
        if (lines.length * lineHeight <= maxHeight) break;
    }

    ctx.font = `${fontSize}px ${TEXT_FONT_FAMILY}`;
    ctx.fillStyle = TEXT_COLOR;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const startY = canvas.height / 2 - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, i) => ctx.fillText(line, canvas.width / 2, startY + i * lineHeight));
}

// Paints the full note — artwork plus its text — used everywhere a note
// needs to be (re)drawn: initial mount and after an edit.
function renderNote(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, text: string, onDone?: () => void) {
    paintNote(ctx, canvas, () => {
        drawNoteText(ctx, canvas, text);
        onDone?.();
    });
}

// Burns a hole outward from the note's center using a coarse cellular-
// automaton grid instead of a single vector outline. Each cell independently
// "catches" from an already-burning neighbor with some randomness (biased by
// a static per-cell noise field standing in for paper density), so the fire
// eats outward in uneven, organic fingers rather than a uniform ring. Every
// burning cell then runs through a real flame color ramp — white-hot, then
// orange, then a dark char — before turning to ash and disappearing. This is
// the standard technique for a convincing "burning paper" look; a single
// jittered outline (the previous approach) reads as a stylized wipe, not fire.
function startBurn(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, simplex: SimplexNoise, onComplete?: () => void, ignitionPoint?: { x: number; y: number }) {
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

    // Lights a 3x3 cluster around a grid cell; returns whether anything
    // actually caught (the cell might be off the note's visible artwork).
    function igniteAround(cx: number, cy: number): boolean {
        let ignited = false;
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const gx = cx + dx, gy = cy + dy;
                if (gx >= 0 && gx < cols && gy >= 0 && gy < rows && visible[idx(gx, gy)]) {
                    heat[idx(gx, gy)] = STAGES;
                    ignited = true;
                }
            }
        }
        return ignited;
    }

    // Starts from wherever the note is touching the coal (ignitionPoint, in
    // canvas-local pixels), not always dead-center, so the fire reads as
    // catching from the contact point. Falls back to the center if that
    // point happens to land off the note's visible artwork (e.g. a
    // transparent corner) or no ignition point was given.
    const centerX = Math.round((cols - 1) / 2);
    const centerY = Math.round((rows - 1) / 2);
    if (ignitionPoint) {
        const gx = Math.min(cols - 1, Math.max(0, Math.round(ignitionPoint.x / cellW - 0.5)));
        const gy = Math.min(rows - 1, Math.max(0, Math.round(ignitionPoint.y / cellH - 0.5)));
        if (!igniteAround(gx, gy)) igniteAround(centerX, centerY);
    } else {
        igniteAround(centerX, centerY);
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
    const stepInterval = 25; // ms per CA generation — controls how fast the fire spreads (original 35 / 1.4)
    const maxDuration = 3214; // safety cap so a burn always finishes even in a worst-case spread roll (original 4500 / 1.4)

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

const NoteList: React.FC<{ roomId: string }> = ({ roomId }) => {

    const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
    const initializedIds = useRef<Set<string>>(new Set());
    const burningIds = useRef<Set<string>>(new Set());
    const stackSlots = useRef(0);
    const dispenserRefs = useRef<(HTMLCanvasElement | null)[]>([]);
    // How much the fixed-size board is currently scaled down (or, capped at
    // 1, not scaled at all) to fit the real viewport — see computeScale.
    // Plain refs, not state: the board's transform is written straight to
    // the DOM (see applyBoardTransform) on every pointer/wheel move so a
    // pinch or scroll-zoom feels immediate — round-tripping that through
    // React state/re-render on every gesture frame would be both slower and
    // unnecessary, since nothing else in this component's render output
    // depends on the current scale/zoom/pan.
    const scaleRef = useRef<number>(computeScale());
    // User-driven zoom on top of the auto-fit scaleRef above (see MAX_ZOOM),
    // and the raw-pixel pan offset that goes with it once zoomed past what
    // fits the screen — both start neutral and reset whenever the viewport
    // resizes (see the resize handler below), since old pan/zoom bounds
    // otherwise stop making sense the moment the fit scale changes under it.
    const zoomRef = useRef(1);
    const panRef = useRef({ x: 0, y: 0 });
    // The two DOM nodes applyBoardTransform writes to directly: the outer
    // one carries pan (translate only), the inner one carries the
    // center-and-scale that already existed — see the return statement.
    const panWrapperRef = useRef<HTMLDivElement | null>(null);
    const boardScaleRef = useRef<HTMLDivElement | null>(null);
    // The actual, total screen-px-per-board-px factor right now — fit scale
    // times user zoom — used everywhere a screen-space distance (a drag, an
    // edit overlay's font size) needs converting to/from board-local pixels.
    const getDisplayScale = () => scaleRef.current * zoomRef.current;
    const applyBoardTransform = () => {
        const displayScale = getDisplayScale();
        if (boardScaleRef.current) {
            boardScaleRef.current.style.transform = `translate(-50%, -50%) scale(${displayScale})`;
        }
        if (panWrapperRef.current) {
            panWrapperRef.current.style.transform = `translate(${panRef.current.x}px, ${panRef.current.y}px)`;
        }
    };
    // Stops pan from ever revealing empty space past the board's own edges:
    // once the rendered board is bigger than the viewport on an axis, the
    // most you can pan is however far it takes to bring the far edge flush
    // with the screen edge; if it's smaller than the viewport, there's
    // nothing to pan on that axis at all (locked to 0, i.e. centered).
    const clampPan = (p: { x: number; y: number }, zoom: number): { x: number; y: number } => {
        const displayScale = scaleRef.current * zoom;
        const maxX = Math.max(0, (BOARD_WIDTH * displayScale - window.innerWidth) / 2);
        const maxY = Math.max(0, (BOARD_HEIGHT * displayScale - window.innerHeight) / 2);
        return { x: Math.min(maxX, Math.max(-maxX, p.x)), y: Math.min(maxY, Math.max(-maxY, p.y)) };
    };
    // The pan needed so that whatever board point sat under screen point
    // `anchorOld` before this zoom/pan step ends up under `anchorNew`
    // afterwards — i.e. "zoom (and optionally drag) around a fixed point"
    // instead of always around the board's center. For a plain scroll-zoom
    // (mouse stays put) anchorOld and anchorNew are the same point; a pinch
    // passes the midpoint's last and current position so panning happens
    // for free as a side effect of the fingers themselves moving.
    const panAfterZoom = (
        anchorOld: { x: number; y: number },
        anchorNew: { x: number; y: number },
        oldZoom: number,
        newZoom: number,
        oldPan: { x: number; y: number },
    ): { x: number; y: number } => {
        const k = newZoom / oldZoom;
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        return {
            x: (anchorNew.x - cx) - (anchorOld.x - cx) * k + oldPan.x * k,
            y: (anchorNew.y - cy) - (anchorOld.y - cy) * k + oldPan.y * k,
        };
    };
    // Pointers currently being tracked for a possible pan/pinch, and the
    // running state of whichever gesture is active — pinchRef once exactly
    // two are down (recomputed from the *previous* frame, not the gesture's
    // start, so a pinch that drifts sideways pans naturally instead of only
    // ever zooming around where it began), panDragRef while exactly one is
    // down (a plain one-finger drag once you're zoomed in — same
    // frame-to-frame-delta approach). claimedPointerIds is how a pointer
    // that's actually dragging a note or a dispenser template (see their
    // own onpointerdown/up below) opts itself out of being read as part of
    // either gesture, so it doesn't fight a note drag for the same touch.
    const activeBoardPointers = useRef<Map<number, { x: number; y: number }>>(new Map());
    const pinchRef = useRef<{ lastDist: number; lastMid: { x: number; y: number } } | null>(null);
    const panDragRef = useRef<{ x: number; y: number } | null>(null);
    const claimedPointerIds = useRef<Set<number>>(new Set());

    const onBoardPointerDown = (e: React.PointerEvent) => {
        if (claimedPointerIds.current.has(e.pointerId)) return;
        activeBoardPointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (activeBoardPointers.current.size === 2) {
            const [p1, p2] = Array.from(activeBoardPointers.current.values());
            pinchRef.current = {
                lastDist: Math.hypot(p1.x - p2.x, p1.y - p2.y),
                lastMid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
            };
            panDragRef.current = null; // a second finger just landed — the pinch above takes over panning too
        } else if (activeBoardPointers.current.size === 1) {
            panDragRef.current = { x: e.clientX, y: e.clientY };
        }
    };
    const onBoardPointerMove = (e: React.PointerEvent) => {
        if (!activeBoardPointers.current.has(e.pointerId)) return;
        activeBoardPointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (activeBoardPointers.current.size === 2 && pinchRef.current) {
            const [p1, p2] = Array.from(activeBoardPointers.current.values());
            const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
            const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
            const { lastDist, lastMid } = pinchRef.current;
            const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomRef.current * (dist / lastDist)));
            const newPan = clampPan(panAfterZoom(lastMid, mid, zoomRef.current, newZoom, panRef.current), newZoom);
            zoomRef.current = newZoom;
            panRef.current = newPan;
            pinchRef.current = { lastDist: dist, lastMid: mid };
            applyBoardTransform();
        } else if (activeBoardPointers.current.size === 1 && panDragRef.current) {
            const cur = { x: e.clientX, y: e.clientY };
            const newPan = clampPan({
                x: panRef.current.x + (cur.x - panDragRef.current.x),
                y: panRef.current.y + (cur.y - panDragRef.current.y),
            }, zoomRef.current);
            panRef.current = newPan;
            panDragRef.current = cur;
            applyBoardTransform();
        }
    };
    const onBoardPointerEnd = (e: React.PointerEvent) => {
        activeBoardPointers.current.delete(e.pointerId);
        const remaining = Array.from(activeBoardPointers.current.values());
        if (remaining.length === 2) {
            // Dropped straight from 3 pointers to 2 (a third finger lifting
            // off) — start a fresh pinch baseline from here rather than one
            // that's now stale.
            pinchRef.current = {
                lastDist: Math.hypot(remaining[0].x - remaining[1].x, remaining[0].y - remaining[1].y),
                lastMid: { x: (remaining[0].x + remaining[1].x) / 2, y: (remaining[0].y + remaining[1].y) / 2 },
            };
            panDragRef.current = null;
        } else if (remaining.length === 1) {
            // One finger of a pinch lifted — hand off to a one-finger pan
            // continuing from exactly where the remaining finger already
            // is, so nothing jumps.
            pinchRef.current = null;
            panDragRef.current = remaining[0];
        } else {
            pinchRef.current = null;
            panDragRef.current = null;
        }
    };

    // Tracks innerWidth across resizes so a mobile on-screen keyboard
    // opening (e.g. focusing the edit textarea in startEditingNote below)
    // can be told apart from an actual layout change: a keyboard only ever
    // shrinks the *height* of the viewport, never its width, while a real
    // resize/rotation changes width too. Without this, typing into a note
    // would silently reset the user's zoom/pan mid-edit, since focusing the
    // textarea opens the keyboard, which fires a `resize` event just like a
    // real one would.
    const lastWidthRef = useRef(window.innerWidth);
    useEffect(() => {
        const onResize = () => {
            if (window.innerWidth === lastWidthRef.current) return;
            lastWidthRef.current = window.innerWidth;
            scaleRef.current = computeScale();
            zoomRef.current = 1;
            panRef.current = { x: 0, y: 0 };
            applyBoardTransform();
        };
        window.addEventListener('resize', onResize);
        window.addEventListener('orientationchange', onResize);
        return () => {
            window.removeEventListener('resize', onResize);
            window.removeEventListener('orientationchange', onResize);
        };
    // applyBoardTransform only touches refs/DOM nodes, never a stale
    // reactive value, so the closure captured here at mount stays correct —
    // no need to re-subscribe every render just to satisfy exhaustive-deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Trackpad pinch (and ctrl+scroll) arrives as a `wheel` event with
    // ctrlKey set — the same zoom math as a touch pinch, just with a single
    // fixed anchor (the cursor) instead of a moving midpoint. Wired up as a
    // real (non-passive) DOM listener rather than React's onWheel: React
    // registers wheel listeners as passive for scroll-performance reasons,
    // which silently no-ops preventDefault — and it's needed here to stop
    // the browser's own page-zoom/scroll from also firing on top of ours.
    useEffect(() => {
        const el = panWrapperRef.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            if (!e.ctrlKey) return; // a plain two-finger scroll has nothing to scroll here — leave it alone
            e.preventDefault();
            const anchor = { x: e.clientX, y: e.clientY };
            const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoomRef.current * Math.exp(-e.deltaY * 0.01)));
            const newPan = clampPan(panAfterZoom(anchor, anchor, zoomRef.current, newZoom, panRef.current), newZoom);
            zoomRef.current = newZoom;
            panRef.current = newPan;
            applyBoardTransform();
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    // Grabs from the dispenser, keyed by a token unique to that grab. The
    // real note is created the moment a grab turns into an actual drag (see
    // the dispenser effect below) — well before it's dropped — so every
    // other client sees it appear immediately instead of only once this
    // client lets go of it. `realId` is filled in once the server's
    // `noteAdded` echoes back (see the addNote handler); `dropped` is filled
    // in once this client actually releases the pointer (see onpointerup).
    // A grab is only finalized (see tryFinalizeDispenserSpawn) once BOTH are
    // set — whichever happens second triggers it — since until then we
    // don't yet know either the note's real id or where it landed.
    const pendingSpawns = useRef<Map<string, {
        canvas: HTMLCanvasElement;
        slotX: number;
        slotY: number;
        realId?: string;
        dropped?: { x: number; y: number };
    }>>(new Map());
    // Real note ids spawned by THIS client dragging them off the dispenser
    // that are still being actively dragged (not yet dropped). Their real
    // canvas already exists — and is fully live for every other client,
    // including receiving this client's own note_dragging updates — but is
    // kept hidden on THIS client until the drag ends, since the dispenser's
    // template canvas is what's actually tracking the pointer during that
    // window; showing both at once would look like a visible duplicate.
    const dispenserOriginNoteIds = useRef<Set<string>>(new Set());
    // A shared, ever-increasing counter: whichever note was grabbed most
    // recently — by this client or, via note_dragging, another one — gets
    // the highest z-index and stays on top, like the last sticky note you
    // touched on a real desk.
    const zCounter = useRef(1);
    const bringToFront = (canvas: HTMLCanvasElement) => {
        canvas.style.zIndex = String(++zCounter.current);
    };
    const { notes, isLoading, isError, mutate } = useNotes(roomId);
    const [burnedIds, setBurnedIds] = useState<Set<string>>(new Set());
    // Handlers assigned inside the per-note init effect only run once per
    // note (it's guarded so re-renders don't reset an in-progress burn),
    // which freezes their closures to whatever `notes` was on that first
    // render. Reading through this ref instead — kept in sync on every
    // render — avoids acting on a stale snapshot from when the note first
    // mounted (e.g. re-opening the editor would otherwise always show the
    // note's original, blank text instead of whatever it currently says).
    const notesRef = useRef<Note[] | undefined>(notes);
    notesRef.current = notes;

    // Whether a note dropped with its board-local top-left at (x, y) — it's
    // always 200x200 — overlaps the coal, i.e. it's been "placed on the
    // coal" and should start burning instead of just staying put there.
    // Compared against the constant, board-local COAL_BOX rather than a
    // measured DOM rect so this stays correct regardless of the board's
    // current display scale (see getDisplayScale above).
    const isOverCoal = (x: number, y: number): boolean =>
        x < COAL_BOX.right && x + NOTE_SIZE > COAL_BOX.left && y < COAL_BOX.bottom && y + NOTE_SIZE > COAL_BOX.top;

    // Moves a note's canvas to its position (given as a board fraction —
    // see notePositionToPixels), and remembers it in the SWR cache so a
    // later re-render (or a page you didn't drag on) doesn't put it back in
    // the stack.
    const setNotePosition = (id: string, fx: number, fy: number) => {
        const canvas = canvasRefs.current[id];
        if (canvas) {
            canvas.style.left = `${centerFractionToTopLeft(fx, BOARD_WIDTH)}px`;
            canvas.style.top = `${centerFractionToTopLeft(fy, BOARD_HEIGHT)}px`;
        }
        mutate(current => current?.map(n => (n._id === id ? { ...n, position: { x: fx, y: fy } } : n)), {
            revalidate: false,
        });
    };

    // Redraws a note's canvas with new text and remembers it in the SWR
    // cache — used both right after this client finishes editing and when
    // another client's note_text_changed arrives.
    const setNoteText = (id: string, text: string) => {
        const canvas = canvasRefs.current[id];
        if (canvas) {
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                renderNote(ctx, canvas, text);
            }
        }
        mutate(current => current?.map(n => (n._id === id ? { ...n, text } : n)), {
            revalidate: false,
        });
    };

    // Double-click opens a plain <textarea> positioned exactly over the
    // note — canvas has no native text editing, so this overlays a real
    // input, then bakes the result back into the canvas (via setNoteText)
    // once the user clicks away. Escape cancels without committing.
    const startEditingNote = (id: string) => {
        if (burningIds.current.has(id)) return;
        const canvas = canvasRefs.current[id];
        if (!canvas) return;
        const originalText = notesRef.current?.find(n => n._id === id)?.text ?? '';
        const box = canvas.getBoundingClientRect();

        // box is in real screen pixels — already scaled down/up by the
        // board's current display scale (fit scale * user zoom, see
        // getDisplayScale) — but TEXT_PADDING/TEXT_MAX_FONT_SIZE are
        // board-local (canvas buffer) constants, so this overlay textarea (a
        // real DOM element, unlike the canvas itself, has no separate
        // "buffer" to auto-scale) needs its own padding/font scaled to match
        // however small or large the note is currently rendering on screen.
        const editScale = getDisplayScale();
        const padding = TEXT_PADDING * editScale;
        const fontSize = TEXT_MAX_FONT_SIZE * editScale;
        const availableWidth = box.width - padding * 2;
        const availableHeight = box.height - padding * 2;

        const textarea = document.createElement('textarea');
        textarea.value = originalText;
        Object.assign(textarea.style, {
            position: 'fixed',
            left: `${box.left + padding}px`,
            top: `${box.top + padding}px`,
            width: `${availableWidth}px`,
            height: `${availableHeight}px`,
            zIndex: String(++zCounter.current),
            border: 'none',
            outline: 'none',
            resize: 'none',
            overflowY: 'hidden',
            background: 'transparent',
            textAlign: 'center',
            font: `${fontSize}px ${TEXT_FONT_FAMILY}`,
            color: TEXT_COLOR,
            boxSizing: 'border-box',
        });
        // The textarea's background is transparent (so the note's texture/
        // shadow still shows through while editing) — but that means the
        // canvas underneath is still visible too, and it still has the OLD
        // text baked into its pixels until a commit redraws it. Blank the
        // text out for the duration of the edit so it doesn't show through
        // and visually overlap what's being typed on top of it.
        const redrawCanvasText = (text: string) => {
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            if (text) renderNote(ctx, canvas, text);
            else paintNote(ctx, canvas);
        };
        redrawCanvasText('');

        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();

        // Textareas always start their text at the top with no built-in way
        // to vertically center it — fake it with padding-top, sized to
        // whatever's left above the current text block so it sits centered
        // the same way the committed, canvas-rendered text does.
        const measureCtx = canvas.getContext('2d');
        const updateVerticalCentering = () => {
            if (!measureCtx) return;
            measureCtx.font = `${fontSize}px ${TEXT_FONT_FAMILY}`;
            const lines = wrapText(measureCtx, textarea.value || ' ', availableWidth);
            const lineHeight = fontSize * 1.25;
            const topPad = Math.max(0, (availableHeight - lines.length * lineHeight) / 2);
            textarea.style.paddingTop = `${topPad}px`;
        };
        updateVerticalCentering();
        // Live-broadcast every keystroke (no DB write — too frequent, same
        // as dragging) so other clients see the text appear as it's typed,
        // not just once this client commits it.
        textarea.addEventListener('input', () => {
            updateVerticalCentering();
            socket.emit('note_typing', { id, text: textarea.value });
        });

        let settled = false;
        const commit = () => {
            if (settled) return;
            settled = true;
            textarea.remove();
            const text = textarea.value.replace(/\s+$/, ''); // trailing newlines (e.g. from Enter before blurring) shouldn't be saved
            if (text !== originalText) {
                setNoteText(id, text);
                socket.emit('note_text_changed', { id, text });
            } else {
                redrawCanvasText(originalText); // nothing changed — just restore what editing blanked out
            }
        };
        const cancel = () => {
            if (settled) return;
            settled = true;
            textarea.remove();
            redrawCanvasText(originalText);
        };
        textarea.addEventListener('blur', commit);
        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') cancel();
        });
    };

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

        // Start the fire from wherever the note is touching the coal
        // rather than always dead-center: the closest point on the note's
        // board-local rect to the coal's center, converted to canvas-local
        // pixel coordinates. Clamping the coal's center into the note's
        // rect gives that closest point directly. Computed from the same
        // board-local constants/style values used everywhere else (rather
        // than measuring the DOM) so it stays correct regardless of the
        // board's current CSS scale — canvas-local pixels (canvas.width is
        // always NOTE_SIZE) and board-local pixels are the same units here,
        // no scale conversion needed.
        const noteLeft = parseFloat(canvas.style.left) || 0;
        const noteTop = parseFloat(canvas.style.top) || 0;
        const coalCenterX = (COAL_BOX.left + COAL_BOX.right) / 2;
        const coalCenterY = (COAL_BOX.top + COAL_BOX.bottom) / 2;
        const closestX = Math.min(Math.max(coalCenterX, noteLeft), noteLeft + NOTE_SIZE);
        const closestY = Math.min(Math.max(coalCenterY, noteTop), noteTop + NOTE_SIZE);
        const ignitionPoint: { x: number; y: number } = { x: closestX - noteLeft, y: closestY - noteTop };

        // Once the animation finishes, tell the server the note is gone for
        // real; its noteDeleted broadcast is what drops the canvas from the
        // page (on every client, whichever one of them burned it).
        startBurn(canvas, ctx, new SimplexNoise(), () => {
            socket.emit('deleteNote', id);
        }, ignitionPoint);
    };

    // Completes a dispenser grab once both halves of it are known: the real
    // note's id (from the server's noteAdded, via the addNote handler below)
    // and where this client actually dropped it (from onpointerup) — either
    // can arrive first, so both call sites call this and it only acts once
    // neither is missing. From here on it's just "a regular note was dropped
    // somewhere", reusing the exact same coal-check/burn/move-and-persist
    // logic as dragging any already-placed note.
    const tryFinalizeDispenserSpawn = (token: string, attemptsLeft = 30) => {
        const pending = pendingSpawns.current.get(token);
        if (!pending || !pending.realId || !pending.dropped) return;
        const { canvas, slotX, slotY, realId, dropped } = pending;

        // The real note's own canvas (rendered from `visibleNotes`, once
        // React processes the noteAdded state update) might not exist yet —
        // the server's response and this client's own drop can in principle
        // land in the very same tick. Wait a frame and retry rather than
        // silently dropping the final position (or a burn).
        const realCanvas = canvasRefs.current[realId];
        if (!realCanvas) {
            if (attemptsLeft > 0) requestAnimationFrame(() => tryFinalizeDispenserSpawn(token, attemptsLeft - 1));
            return;
        }

        pendingSpawns.current.delete(token);
        dispenserOriginNoteIds.current.delete(realId);
        realCanvas.style.visibility = ''; // reveal — the template below takes its place
        // bringToFront was only ever called on the *template* canvas during
        // the drag (see its onpointerdown below) — the real canvas stayed
        // hidden this whole time and never got its own z-index bumped, so
        // without this it could surface behind a note dragged more recently
        // than it was created, instead of on top like a just-dragged note
        // should be.
        bringToFront(realCanvas);

        // The real canvas has been sitting (invisibly) whereever it was
        // first created — near the dispenser, at the position sent with the
        // original addNote — since it never actually followed the drag (see
        // the dispenser effect above, where only the template canvas
        // tracks the pointer). Move it to the actual drop point before
        // doing anything else with it, so a burn started below ignites at
        // the coal, not back at the dispenser.
        realCanvas.style.left = `${dropped.x}px`;
        realCanvas.style.top = `${dropped.y}px`;

        // Snap the template back to its slot — the real note's own canvas
        // (already live for every other client since the moment it was
        // grabbed) takes over from here.
        canvas.style.left = `${slotX}px`;
        canvas.style.top = `${slotY}px`;

        if (isOverCoal(dropped.x, dropped.y)) {
            triggerBurn(realId, true);
            return;
        }
        const fx = topLeftToCenterFraction(dropped.x, BOARD_WIDTH);
        const fy = topLeftToCenterFraction(dropped.y, BOARD_HEIGHT);
        socket.emit('note_drag_end', { id: realId, x: fx, y: fy });
        setNotePosition(realId, fx, fy);
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
    // the next revalidation, so new notes show up instantly (this is what
    // makes a note grabbed from the dispenser visible to everyone else right
    // away, at wherever it currently is, rather than only once it's dropped).
    const addNote = (note: Note & { clientToken?: string }) => {
        mutate(current => (current?.some(n => n._id === note._id) ? current : [...(current ?? []), note]), {
            revalidate: false,
        });
        // This is the real note a dispenser grab (see the dispenser effect
        // below) was waiting on — record its id, and keep our own copy of
        // its canvas hidden for now if that grab is still in progress (i.e.
        // hasn't been dropped yet — see dispenserOriginNoteIds above).
        if (note.clientToken) {
            const pending = pendingSpawns.current.get(note.clientToken);
            if (pending) {
                pending.realId = note._id;
                if (!pending.dropped) dispenserOriginNoteIds.current.add(note._id);
                tryFinalizeDispenserSpawn(note.clientToken);
            }
        }
    };

    // Tells the server which room this socket belongs to, so every event it
    // sends/receives from here on is scoped to this room's board instead of
    // leaking to every other room. Re-sent on every 'connect' (initial
    // connect and any reconnect) since the server only remembers it for the
    // lifetime of that one underlying connection.
    useEffect(() => {
        const join = () => socket.emit('joinRoom', roomId);
        join();
        socket.on('connect', join);
        return () => {
            socket.off('connect', join);
        };
    }, [roomId]);

    // The server deletes the note and broadcasts noteDeleted to every client
    // (including this one) once it's gone — that's what actually drops it
    // from the board, whether it was burned here or in another tab.
    useEffect(() => {
        const onRemoteBurn = (id: string) => triggerBurn(id, false);
        // Live position updates from another client dragging a note (no DB
        // write yet — see note_dragging on the server) and the final
        // position once they let go. Only moves the canvas on THIS client;
        // the dragging client already moved its own via setNotePosition.
        const onDragging = ({ id, x, y }: { id: string; x: number; y: number }) => {
            const canvas = canvasRefs.current[id];
            if (canvas) {
                canvas.style.left = `${centerFractionToTopLeft(x, BOARD_WIDTH)}px`;
                canvas.style.top = `${centerFractionToTopLeft(y, BOARD_HEIGHT)}px`;
                bringToFront(canvas); // another client just grabbed/moved this one — keep the "last touched" ordering in sync
            }
        };
        const onMoved = ({ id, x, y }: { id: string; x: number; y: number }) => setNotePosition(id, x, y);
        // Live text updates from another client's in-progress edit — just
        // repaints the canvas, doesn't touch the SWR cache (mirrors
        // onDragging above); note_text_changed is what actually commits it.
        const onTyping = ({ id, text }: { id: string; text: string }) => {
            const canvas = canvasRefs.current[id];
            const ctx = canvas?.getContext('2d');
            if (!canvas || !ctx) return;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            renderNote(ctx, canvas, text);
        };
        const onTextChanged = ({ id, text }: { id: string; text: string }) => setNoteText(id, text);
        socket.on('noteAdded', addNote);
        socket.on('noteDeleted', removeNote);
        socket.on('startBurn', onRemoteBurn);
        socket.on('note_dragging', onDragging);
        socket.on('note_moved', onMoved);
        socket.on('note_typing', onTyping);
        socket.on('note_text_changed', onTextChanged);
        return () => {
            socket.off('noteAdded', addNote);
            socket.off('noteDeleted', removeNote);
            socket.off('startBurn', onRemoteBurn);
            socket.off('note_dragging', onDragging);
            socket.off('note_moved', onMoved);
            socket.off('note_typing', onTyping);
            socket.off('note_text_changed', onTextChanged);
        };
    // addNote/setNotePosition/setNoteText aren't in the deps array on
    // purpose: each only touches refs (canvasRefs, pendingSpawns,
    // dispenserOriginNoteIds) or mutate's functional-update form, never a
    // stale reactive value directly, so the listeners registered at mount
    // stay correct for the life of the component — no need to re-subscribe
    // every render just to satisfy exhaustive-deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // The corner dispenser: DISPENSER_COUNT template notes that are never
    // spent. Dragging one off spawns a real note the instant that grab turns
    // into an actual drag — not at the drop, see onpointermove below — so
    // every other client sees it appear immediately and can watch it get
    // dragged around, instead of only seeing it pop into existence once
    // released. This client keeps dragging the template canvas exactly as
    // before; the real note's own canvas (already live for everyone else)
    // stays hidden here until the drop (see dispenserOriginNoteIds), at
    // which point the template snaps back to its slot, ready to be grabbed
    // again. Runs once — the dispenser has nothing to do with which real
    // notes exist.
    useEffect(() => {
        for (let i = 0; i < DISPENSER_COUNT; i++) {
            const canvas = dispenserRefs.current[i];
            if (!canvas) continue;
            canvas.width = 200;
            canvas.height = 200;
            canvas.style.position = 'absolute';
            canvas.style.touchAction = 'none';

            const slotX = DISPENSER_ORIGIN.x + i * STACK_OFFSET_STEP;
            const slotY = DISPENSER_ORIGIN.y + i * STACK_OFFSET_STEP;
            canvas.style.left = `${slotX}px`;
            canvas.style.top = `${slotY}px`;

            const ctx = canvas.getContext('2d');
            if (!ctx) continue;
            paintNote(ctx, canvas);

            let dragOrigin: { pointerX: number; pointerY: number } | null = null;
            let dragged = false;
            // Set the moment this grab creates a real note (see
            // onpointermove) — lets onpointerup know which pendingSpawns
            // entry this drop resolves.
            let activeToken: string | null = null;

            canvas.onpointerdown = (e) => {
                canvas.setPointerCapture(e.pointerId);
                claimedPointerIds.current.add(e.pointerId); // opts this pointer out of being read as one half of a board pinch
                bringToFront(canvas);
                dragged = false;
                activeToken = null;
                dragOrigin = { pointerX: e.clientX, pointerY: e.clientY };
            };

            canvas.onpointermove = (e) => {
                if (!dragOrigin) return;
                // The click-vs-drag threshold is a physical-finger distance,
                // so it's judged in real screen px; only the actual movement
                // applied to the canvas needs converting to board-local px
                // (dividing by the board's current display scale), since
                // canvas.style.left/top are always in that unit.
                const screenDx = e.clientX - dragOrigin.pointerX;
                const screenDy = e.clientY - dragOrigin.pointerY;
                if (!dragged && Math.hypot(screenDx, screenDy) < DRAG_THRESHOLD) return;
                const justGrabbed = !dragged;
                dragged = true;
                const dx = screenDx / getDisplayScale();
                const dy = screenDy / getDisplayScale();
                const x = slotX + dx;
                const y = slotY + dy;
                canvas.style.left = `${x}px`;
                canvas.style.top = `${y}px`;

                const fx = topLeftToCenterFraction(x, BOARD_WIDTH);
                const fy = topLeftToCenterFraction(y, BOARD_HEIGHT);

                if (justGrabbed) {
                    activeToken = `${Date.now()}-${Math.random()}`;
                    pendingSpawns.current.set(activeToken, { canvas, slotX, slotY });
                    socket.emit('addNote', { text: '', position: { x: fx, y: fy }, clientToken: activeToken });
                } else if (activeToken) {
                    // Live position only (no DB write here, too frequent —
                    // same as an already-placed note being dragged) — and
                    // only once the real id has actually come back; a few
                    // early frames are dropped otherwise, which self-heals
                    // as soon as it resolves.
                    const pending = pendingSpawns.current.get(activeToken);
                    if (pending?.realId) {
                        socket.emit('note_dragging', { id: pending.realId, x: fx, y: fy });
                    }
                }
            };

            canvas.onpointerup = (e) => {
                canvas.releasePointerCapture(e.pointerId);
                claimedPointerIds.current.delete(e.pointerId);
                const wasDragged = dragged;
                const dropX = parseFloat(canvas.style.left) || slotX;
                const dropY = parseFloat(canvas.style.top) || slotY;
                dragOrigin = null;
                dragged = false;
                if (!wasDragged) {
                    canvas.style.left = `${slotX}px`;
                    canvas.style.top = `${slotY}px`;
                    return;
                }
                const token = activeToken;
                activeToken = null;
                const pending = token ? pendingSpawns.current.get(token) : undefined;
                if (!token || !pending) return; // dragged implies justGrabbed already set this above
                pending.dropped = { x: dropX, y: dropY };
                // Safety net: if the real note's id never arrives (dropped
                // connection, server error), don't leave the template
                // stranded off its slot forever.
                setTimeout(() => {
                    if (!pendingSpawns.current.delete(token)) return; // already resolved
                    canvas.style.left = `${slotX}px`;
                    canvas.style.top = `${slotY}px`;
                }, 4000);
                tryFinalizeDispenserSpawn(token);
            };
        }
    // tryFinalizeDispenserSpawn isn't in the deps array on purpose, same
    // reasoning as the socket-listener effect above: it only touches refs
    // and other ref-only functions (isOverCoal, setNotePosition,
    // triggerBurn), so the closures wired up here at mount stay correct —
    // no need to re-run this whole effect (and re-paint/rewire every
    // dispenser slot) just to satisfy exhaustive-deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

            // Freely draggable anywhere on the board — placed notes render
            // at their saved position, everything else piles up in the
            // corner stack until someone drags it out.
            canvas.style.position = 'absolute';
            canvas.style.touchAction = 'none'; // don't let touch-scroll fight the drag
            if (isPlaced(note)) {
                const { left, top } = notePositionToPixels(note.position);
                canvas.style.left = `${left}px`;
                canvas.style.top = `${top}px`;
            } else {
                // Legacy fallback — new notes always come from the
                // dispenser with a position already set, so this only
                // applies to notes created before the dispenser existed.
                const slot = stackSlots.current++;
                canvas.style.left = `${LEGACY_STACK_ORIGIN.x + slot * STACK_OFFSET_STEP}px`;
                canvas.style.top = `${LEGACY_STACK_ORIGIN.y + slot * STACK_OFFSET_STEP}px`;
            }

            // A grab from the dispenser (see the dispenser effect below)
            // that's still in progress on THIS client — its real canvas is
            // already live for everyone else, but stays hidden here until
            // the drag ends, since the dispenser's own template canvas is
            // what's actually tracking the pointer until then.
            if (dispenserOriginNoteIds.current.has(note._id)) {
                canvas.style.visibility = 'hidden';
            }

            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            renderNote(ctx, canvas, note.text ?? '');

            canvas.ondblclick = () => startEditingNote(note._id);

            // Pointer-based drag, distinguished from a click by movement
            // distance: a short move still counts as a click (burns the
            // note); crossing DRAG_THRESHOLD switches to dragging it around
            // and suppresses the burn on release.
            let dragOrigin: { pointerX: number; pointerY: number; startLeft: number; startTop: number } | null = null;
            let dragged = false;

            canvas.onpointerdown = (e) => {
                if (burningIds.current.has(note._id)) return; // already on fire — leave it be
                canvas.setPointerCapture(e.pointerId);
                claimedPointerIds.current.add(e.pointerId); // opts this pointer out of being read as one half of a board pinch
                bringToFront(canvas);
                dragged = false;
                dragOrigin = {
                    pointerX: e.clientX,
                    pointerY: e.clientY,
                    startLeft: parseFloat(canvas.style.left) || 0,
                    startTop: parseFloat(canvas.style.top) || 0,
                };
            };

            canvas.onpointermove = (e) => {
                if (!dragOrigin) return;
                // The click-vs-drag threshold is a physical-finger distance,
                // so it's judged in real screen px; only the actual movement
                // applied to the canvas needs converting to board-local px
                // (dividing by the board's current display scale), since
                // canvas.style.left/top are always in that unit.
                const screenDx = e.clientX - dragOrigin.pointerX;
                const screenDy = e.clientY - dragOrigin.pointerY;
                if (!dragged && Math.hypot(screenDx, screenDy) < DRAG_THRESHOLD) return;
                dragged = true;
                const x = dragOrigin.startLeft + screenDx / getDisplayScale();
                const y = dragOrigin.startTop + screenDy / getDisplayScale();
                canvas.style.left = `${x}px`;
                canvas.style.top = `${y}px`;
                // Live position only — no DB write here, too frequent (see server).
                // Sent as a center-relative board fraction (see
                // topLeftToCenterFraction) so it lands in the right spot
                // on a differently-sized screen, not just this one.
                socket.emit('note_dragging', { id: note._id, x: topLeftToCenterFraction(x, BOARD_WIDTH), y: topLeftToCenterFraction(y, BOARD_HEIGHT) });
            };

            canvas.onpointerup = (e) => {
                canvas.releasePointerCapture(e.pointerId);
                claimedPointerIds.current.delete(e.pointerId);
                const wasDragged = dragged;
                dragOrigin = null;
                dragged = false;
                if (!wasDragged) return; // a plain click no longer does anything — burning is triggered by dropping on the coal
                const x = parseFloat(canvas.style.left) || 0;
                const y = parseFloat(canvas.style.top) || 0;
                if (isOverCoal(x, y)) {
                    triggerBurn(note._id, true);
                    return;
                }
                const fx = topLeftToCenterFraction(x, BOARD_WIDTH);
                const fy = topLeftToCenterFraction(y, BOARD_HEIGHT);
                socket.emit('note_drag_end', { id: note._id, x: fx, y: fy });
                setNotePosition(note._id, fx, fy);
            };
        })

    // setNotePosition/startEditingNote aren't in the deps array on purpose,
    // same reasoning as the socket-listener effect above: this effect's own
    // initializedIds guard means each note's canvas is only ever wired up
    // once, and both functions only touch refs or mutate's functional-
    // update form, so whichever closure got captured on that first run stays
    // correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visibleNotes]);



    const setCanvasRef = (id: string) => (el: HTMLCanvasElement | null): void => {
        if (el) canvasRefs.current[id] = el;
        else delete canvasRefs.current[id];
    };

    // The dispenser canvases must always render, even while notes are still
    // loading — the dispenser-setup effect above has an empty dependency
    // array (it only runs once), so if these were behind the isLoading/
    // isError early returns like before, they wouldn't exist yet on the
    // render that effect fires after, and the dispenser would never get
    // wired up at all.
    return (
        // Outer layer: owns pan only (a raw-px translate), and is where the
        // pinch/scroll-zoom gesture is actually listened for — see
        // onBoardPointer*/the wheel effect above. `position: fixed; inset: 0`
        // spans the full viewport so it can catch a second finger landing
        // anywhere on the board, and having its own `transform` (even a
        // no-op translate(0,0) at rest) makes it the containing block for
        // the `position: fixed` board div below, which is what lets pan
        // move it. touchAction 'none' hands the whole gesture to us instead
        // of letting the browser also try to scroll/zoom underneath it.
        <div
            ref={panWrapperRef}
            style={{ position: 'fixed', inset: 0, transform: 'translate(0px, 0px)', touchAction: 'none' }}
            onPointerDown={onBoardPointerDown}
            onPointerMove={onBoardPointerMove}
            onPointerUp={onBoardPointerEnd}
            onPointerCancel={onBoardPointerEnd}
        >
            {/* The board itself: a fixed BOARD_WIDTH x BOARD_HEIGHT box,
                centered in the panned viewport and uniformly scaled to fit
                it times the user's current zoom (see getDisplayScale) —
                this is what makes every device agree on the same layout.
                `position: fixed` here (rather than on each child, as
                before) is what establishes this div as the containing block
                for its `position: absolute` children below, so the
                coal/dispenser/notes only ever need to think in board-local
                pixels. */}
            <div
                ref={boardScaleRef}
                style={{
                    position: 'fixed',
                    top: '50%',
                    left: '50%',
                    width: BOARD_WIDTH,
                    height: BOARD_HEIGHT,
                    transform: `translate(-50%, -50%) scale(${getDisplayScale()})`,
                    transformOrigin: 'center center',
                }}
            >
                <img
                    src={coalUrl}
                    alt=""
                    style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        width: COAL_SIZE,
                        height: COAL_SIZE,
                        pointerEvents: 'none', // sits under draggable notes without blocking them
                    }}
                />
                {Array.from({ length: DISPENSER_COUNT }, (_, i) => (
                    <canvas key={`dispenser-${i}`} ref={(el) => { dispenserRefs.current[i] = el; }} />
                ))}
                {isLoading && <p>Loading...</p>}
                {isError && <p style={{ color: 'red' }}>Failed to load notes</p>}
                {!isLoading && !isError && visibleNotes.map((note) => (
                    <canvas key={note._id} id={note._id} ref={setCanvasRef(String(note._id))} />
                ))}
            </div>
        </div>
    )
};

export default NoteList;