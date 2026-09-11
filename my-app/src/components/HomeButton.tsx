import React from 'react';
import { Link } from 'react-router-dom';

// Back out of the room to the landing page — client-side nav via Link
// (not a plain <a>) so it doesn't force a full page reload. Unstyled for
// position: sits in the top-right toolbar alongside ShareLink (see RoomPage).
export default function HomeButton() {
    return (
        <Link to="/">
            <button>← Home</button>
        </Link>
    );
}
