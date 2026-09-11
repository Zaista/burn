import React, { useState } from 'react';

// Sharing a room is just sharing its URL — there's no invite flow, the link
// itself grants access. This just saves a manual copy from the address bar.
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
        <button
            onClick={copyLink}
            style={{
                position: 'fixed',
                top: 16,
                right: 16,
                zIndex: 9999,
            }}
        >
            {copied ? 'Link copied!' : 'Share room'}
        </button>
    );
}
