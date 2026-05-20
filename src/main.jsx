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

// ─── Base-level player ad / popup / redirect shield ─────────────────────
// The player iframe must stay unsandboxed for providers that block sandboxed
// embeds, so this guard blocks top-level ad redirects and popup attempts from
// the app shell instead.
if (typeof window !== "undefined") {
  let redirectGuardUntil = 0;

  window.__streamovAdShield = {
    arm(ms = 4500) {
      redirectGuardUntil = Math.max(redirectGuardUntil, Date.now() + ms);
    },
    disarm() {
      redirectGuardUntil = 0;
    },
  };

  try {
    window.open = function blockedOpen() {
      return null;
    };
  } catch {}

  window.addEventListener("beforeunload", (e) => {
    if (Date.now() < redirectGuardUntil) {
      e.preventDefault();
      e.returnValue = "";
      return "";
    }
    delete e.returnValue;
  });

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

  ["pointerenter", "pointerdown", "touchstart", "focusin"].forEach((eventName) => {
    document.addEventListener(
      eventName,
      (e) => {
        if (e.target?.closest?.("iframe[data-player-frame='true']")) {
          window.__streamovAdShield.arm(5000);
        }
      },
      true,
    );
  });

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

