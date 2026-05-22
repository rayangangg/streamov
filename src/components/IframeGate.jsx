import React, { useState } from "react";

/**
 * Click-to-play opaque shield rendered ABOVE a third-party iframe.
 * - Stops the iframe from auto-firing ad popups/redirects before user intent.
 * - On click, arms the global ad-shield window and reveals the iframe.
 * - This is the maximum a web build can do against cross-origin iframe ads.
 *
 * Place as a sibling AFTER the <iframe> in an `position: relative` container.
 */
export default function IframeGate({ label = "Click to play", subtitle }) {
  const [open, setOpen] = useState(false);
  if (open) return null;
  return (
    <button
      type="button"
      onClick={() => {
        try {
          window.__streamovAdShield?.arm(8000);
        } catch {}
        setOpen(true);
      }}
      aria-label={label}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 5,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        background:
          "radial-gradient(ellipse at center, rgba(20,20,28,0.92) 0%, rgba(0,0,0,0.98) 80%)",
        border: "none",
        cursor: "pointer",
        color: "#fff",
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        style={{
          width: 88,
          height: 88,
          borderRadius: "50%",
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.18)",
          display: "grid",
          placeItems: "center",
        }}
      >
        <svg width="38" height="38" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: 0.2 }}>{label}</div>
      <div style={{ fontSize: 12, opacity: 0.6, maxWidth: 320, textAlign: "center" }}>
        {subtitle ||
          "Ad-shield armed. Popups and redirects from the stream provider are blocked at the app layer."}
      </div>
    </button>
  );
}
