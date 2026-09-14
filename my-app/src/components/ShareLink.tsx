import React, { useState } from 'react';

// Sharing a room is just sharing its URL — there's no invite flow, the link
// itself grants access. This just saves a manual copy from the address bar.
// Unstyled for position: rendered inside HeaderMenu's dropdown, alongside
// HomeButton.
export default function ShareLink() {
    const [copied, setCopied] = useState(false);

    const copyLink = async () => {
        try {
            await navigator.clipboard.writeText(window.location.href);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // Clipboard access can be denied (permissions, insecure context) —
            // fail silently, the link is still right there in the address bar.
        }
    };

    return (
        <button onClick={copyLink} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {copied ? (
                '✓ Link copied!'
            ) : (
                <>
                    {/* A plain emoji here (e.g. 🔗) renders in full color on
                        most platforms regardless of CSS — an inline SVG
                        with an explicit stroke color is what actually keeps
                        it black. */}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </svg>
                    Share room
                </>
            )}
        </button>
    );
}
