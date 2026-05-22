# Desktop (Electron) ad / popup / redirect blocking

The web preview can only do app-level blocking (already in `src/main.jsx`).
For the desktop build, paste the following into your Electron main process —
this is the same approach the original desktop version used and is the only
place that can fully kill cross-origin popups from third-party iframes.

```js
// electron/main.cjs
const { app, BrowserWindow, session } = require("electron");

const BLOCK_HOSTS = [
  // Known ad / popup networks observed in player providers
  "popads.net", "popcash.net", "propellerads.com", "adsterra.com",
  "exoclick.com", "exosrv.com", "juicyads.com", "trafficjunky.net",
  "doubleclick.net", "googlesyndication.com", "googletagservices.com",
  "googletagmanager.com", "google-analytics.com", "adservice.google.com",
  "scorecardresearch.com", "moatads.com", "outbrain.com", "taboola.com",
  "zedo.com", "media.net", "yieldmo.com", "rubiconproject.com",
  "openx.net", "pubmatic.com", "adsrvr.org", "advertising.com",
  "amazon-adsystem.com", "casalemedia.com",
];

function isBlocked(url) {
  try {
    const h = new URL(url).hostname;
    return BLOCK_HOSTS.some((b) => h === b || h.endsWith("." + b));
  } catch { return false; }
}

function hardenSession(ses) {
  // 1. Network-level ad host blocking (cancels requests entirely)
  ses.webRequest.onBeforeRequest((details, cb) => {
    if (isBlocked(details.url)) return cb({ cancel: true });
    cb({});
  });

  // 2. Strip headers that leak referrer to ad servers
  ses.webRequest.onBeforeSendHeaders((details, cb) => {
    delete details.requestHeaders["Referer"];
    cb({ requestHeaders: details.requestHeaders });
  });
}

function hardenWindow(win) {
  // 3. Block ALL new window / popup attempts from any origin
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  // 4. Block top-frame redirects triggered by ad scripts
  win.webContents.on("will-navigate", (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault();
  });

  // 5. Same rule for nested webContents (iframes spawning windows)
  win.webContents.on("did-attach-webview", (_, contents) => {
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", (e) => e.preventDefault());
  });
}

app.whenReady().then(() => {
  hardenSession(session.defaultSession);

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox: true,                  // optional: extra renderer lockdown
      webviewTag: false,                 // we no longer use <webview>
    },
  });
  hardenWindow(win);
  win.loadFile("dist/index.html");
});
```

## Why this works on desktop and not in the web preview

Browsers run our app inside a sandbox where third-party iframe scripts have
direct access to `window.open`, navigation, and ad-server requests on their
**own** origin. The web app can only intercept the small surface its own JS
context can see (the shield in `src/main.jsx`).

Electron's main process owns the entire Chromium request pipeline, so it can:
- Cancel ad-host requests **before** they reach the iframe (`onBeforeRequest`).
- Hard-deny every popup window via `setWindowOpenHandler`.
- Block every top-frame navigation that isn't initiated by the user.

That is the closest equivalent of an installed ad-blocker extension.
