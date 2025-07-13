function setBurn(id) {
    console.log(id)
    const canvas = document.getElementsByName(id)[0];
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const simplex = new SimplexNoise();

    const postit = new Image();
    postit.src = 'postit.png'; // Use a square yellow note image with transparency

    postit.onload = () => {
        ctx.drawImage(postit, 0, 0, canvas.width, canvas.height);
    };

    canvas.onclick = () => {
        startBurn();
    }

    function startBurn() {
        let radius = 5;
        const center = { x: canvas.width / 2, y: canvas.height / 2 };

        function burnFrame() {
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

            for (let y = 0; y < canvas.height; y++) {
                for (let x = 0; x < canvas.width; x++) {
                    const dx = x - center.x;
                    const dy = y - center.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    const angle = Math.atan2(dy, dx);
                    const noise = simplex.noise2D(Math.cos(angle) + radius * 0.01, Math.sin(angle) + radius * 0.01);
                    const distortedRadius = radius + noise * 15;

                    const index = (y * canvas.width + x) * 4;

                    if (distance < distortedRadius && distance > distortedRadius - 3) {
                        imageData.data[index] = 50;
                        imageData.data[index + 1] = 20;
                        imageData.data[index + 2] = 0;
                    }

                    if (distance < distortedRadius - 3) {
                        imageData.data[index + 3] = 0; // transparent
                    }
                }
            }

            ctx.putImageData(imageData, 0, 0);
            drawFireParticles(radius, center);
            radius += 2;

            if (radius < 500) requestAnimationFrame(burnFrame);
        }

        burnFrame();
    }

    function drawFireParticles(radius, center) {
        for (let i = 0; i < 30; i++) {
            const angle = Math.random() * 2 * Math.PI;
            const r = radius + Math.random() * 5;
            const x = center.x + r * Math.cos(angle);
            const y = center.y + r * Math.sin(angle);

            const flameSize = Math.random() * 3;
            ctx.beginPath();
            ctx.arc(x, y, flameSize, 0, 2 * Math.PI);
            ctx.fillStyle = `rgba(255, ${Math.floor(Math.random()*150)}, 0, 0.4)`;
            ctx.fill();
        }
    }
}