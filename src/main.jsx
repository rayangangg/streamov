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

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

