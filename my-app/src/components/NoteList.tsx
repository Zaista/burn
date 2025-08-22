import React, {useEffect, useRef} from 'react';
import { useNotes } from '../hooks/useNotes';
import SimplexNoise from './SimplexNoise';



const NoteList: React.FC = () => {

    const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
    const { notes, isLoading, isError } = useNotes();

    useEffect(() => {
        notes?.forEach((note) => {
            const canvas = canvasRefs.current[note._id];
            if (!canvas) return;
            canvas.width = 200;
            canvas.height = 200;
            canvas.dataset.id = note._id;
            canvas.setAttribute('name', note._id);

            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) return;
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const simplex = new SimplexNoise();

            const postit = new Image();
            postit.src = './assets/postit.png';

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
        })

    }, [notes]);



    if (isLoading) return <p>Loading...</p>;
    if (isError) return <p style={{ color: 'red' }}>Failed to load notes</p>;

    // return <canvas ref={canvasRef} />;

    const setCanvasRef = (id: string) => (el: HTMLCanvasElement | null): void => {
        if (el) canvasRefs.current[id] = el;
        else delete canvasRefs.current[id];
    };

    return (
        <div>
            {notes.map((note) => (
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