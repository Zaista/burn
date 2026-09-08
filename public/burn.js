// Small pre-rendered glow used for every ember particle, so a frame only ever
// needs a cheap drawImage() instead of building a radial gradient per-particle.
let emberSprite = null;
function getEmberSprite() {
    if (emberSprite) return emberSprite;
    const size = 32;
    const sprite = document.createElement('canvas');
    sprite.width = sprite.height = size;
    const sctx = sprite.getContext('2d');
    const gradient = sctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255, 235, 180, 0.95)');
    gradient.addColorStop(0.4, 'rgba(255, 150, 40, 0.7)');
    gradient.addColorStop(1, 'rgba(255, 80, 0, 0)');
    sctx.fillStyle = gradient;
    sctx.fillRect(0, 0, size, size);
    emberSprite = sprite;
    return sprite;
}

// Burns a hole outward from the note's center. Instead of scanning every pixel
// each frame, it traces a noise-jittered polygon for the burning edge and
// erases with it — cheap canvas path fills instead of a per-pixel loop — then
// layers a charred rim, a bright ember line, and a handful of drifting ember
// particles on top.
function startBurn(canvas, ctx, simplex, onComplete) {
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const maxRadius = Math.hypot(cx, cy) + 12;
    const duration = 1300; // ms — burns at the same speed regardless of frame rate
    const sprite = getEmberSprite();

    let embers = [];
    let start = null;
    let lastTs = null;

    function edgePath(radius) {
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

    function spawnEmbers(radius, count) {
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

    function frame(ts) {
        if (start === null) { start = ts; lastTs = ts; }
        const dt = ts - lastTs;
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

function setBurn(id) {
    const canvas = document.getElementsByName(id)[0];
    const ctx = canvas.getContext('2d');
    const simplex = new SimplexNoise();

    const postit = new Image();
    postit.src = 'postit.png'; // Use a square yellow note image with transparency

    postit.onload = () => {
        ctx.drawImage(postit, 0, 0, canvas.width, canvas.height);
    };

    canvas.onclick = () => {
        // Once the animation finishes, drop the note's canvas — yellow
        // background and all — from the page entirely.
        startBurn(canvas, ctx, simplex, () => {
            canvas.remove();
        });
    };
}
