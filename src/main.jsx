import React from "react";
import ReactDOM from "react-dom/client";
import { installWebShim } from "./web-shim";
import App from "./App";
import "./styles/global.css";

installWebShim();

// The original Electron build used <webview> elements with custom methods
// (executeJavaScript, getWebContentsId, openDevTools, etc.). On the web we
// replace those with <iframe>s, which don't expose those methods. Install
// inert no-op stubs so legacy player code that still calls them doesn't
// throw and break video playback.
if (typeof HTMLIFrameElement !== "undefined") {
  const proto = HTMLIFrameElement.prototype;
  const noopAsync = function () {
    return Promise.resolve(null);
  };
  const stubs = [
    "executeJavaScript",
    "getWebContentsId",
    "openDevTools",
    "closeDevTools",
    "isDevToolsOpened",
    "reload",
    "stop",
    "loadURL",
    "getURL",
    "insertCSS",
    "setAudioMuted",
    "isAudioMuted",
    "capturePage",
  ];
  for (const name of stubs) {
    if (!(name in proto)) {
      Object.defineProperty(proto, name, {
        value: noopAsync,
        writable: true,
        configurable: true,
      });
    }
  }
}

// ─── Base-level ad / popup / redirect kill switch ──────────────────────
// Embedded players (videasy, vidsrc, 2embed, etc.) try to spawn popups,
// open ad tabs, and navigate the top window. The sandbox attribute on the
// iframe blocks most of it; this layer blocks anything that slips through
// (e.g. user-gesture popups, target=_blank link injections, top reloads).
if (typeof window !== "undefined") {
  // 1. Kill every window.open call from anywhere on the page.
  try {
    window.open = function blockedOpen() {
      return null;
    };
  } catch {}

  // 2. Block top-frame navigation away from the app (ad redirects).
  window.addEventListener("beforeunload", (e) => {
    // Only block if it's not the user closing the tab themselves.
    // Most ad redirects fire while document is fully active; we can't
    // distinguish perfectly, so we let it pass but strip any returnValue.
    delete e.returnValue;
  });

  // 3. Intercept clicks that try to open new tabs (target=_blank ads).
  document.addEventListener(
    "click",
    (e) => {
      const a = e.target?.closest?.("a[target=_blank], a[target='_blank']");
      if (a && !a.dataset.streamovAllow) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );

  // 4. Disable common ad-network globals if injected.
  ["adsbygoogle", "googletag", "_pop", "popMagic", "popns"].forEach((k) => {
    try {
      Object.defineProperty(window, k, {
        get() {
          return undefined;
        },
        set() {},
        configurable: false,
      });
    } catch {}
  });
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

