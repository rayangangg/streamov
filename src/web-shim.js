// Browser shim for the Electron preload bridge (window.electron).
// Streambert's UI was written against an Electron preload that exposed a large
// IPC surface (downloads, custom player, OS keychain, window controls, etc.).
// In the web build we cannot do any of that. This shim returns sensible
// no-op defaults for every method so the UI renders and degrades gracefully.
//
// Behaviour:
//  - Async methods: resolve with null / [] / false depending on the name.
//  - Event subscribers (onX): no-op, return a noop unsubscribe.
//  - Event unsubscribers (offX): no-op.
//  - secureGet/secureSet: backed by localStorage (NOT actually secure;
//    matches the inert nature of the rest of the web shim).
//  - openExternal: opens a new tab.
//
// NOTE: this is intentionally permissive. Any unknown method returns a
// function that resolves to null, so future code paths don't crash.

const LS_SECURE_PREFIX = "streambert_secure_";

function secureGet(key) {
  try {
    return Promise.resolve(localStorage.getItem(LS_SECURE_PREFIX + key));
  } catch {
    return Promise.resolve(null);
  }
}

function secureSet(key, value) {
  try {
    if (value === null || value === undefined || value === "") {
      localStorage.removeItem(LS_SECURE_PREFIX + key);
    } else {
      localStorage.setItem(LS_SECURE_PREFIX + key, String(value));
    }
  } catch {}
  return Promise.resolve();
}

const known = {
  // Identity / platform
  getAppVersion: () => Promise.resolve("web"),
  getPlatform: () => Promise.resolve("web"),

  // Window controls (no-op on web)
  windowIsMaximized: () => Promise.resolve(false),
  onWindowMaximize: () => () => {},
  offWindowMaximize: () => {},
  setZoomFactor: () => {},

  // External links
  openExternal: (url) => {
    try {
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {}
    return Promise.resolve();
  },
  openPath: () => Promise.resolve(false),
  openPathAtTime: () => Promise.resolve(false),

  // Filesystem / downloads (unavailable on web)
  pickFolder: () => Promise.resolve(null),
  scanDirectory: () => Promise.resolve([]),
  fileExists: () => Promise.resolve(false),
  checkDownloader: () => Promise.resolve({ available: false }),
  getDownloads: () => Promise.resolve([]),
  getDownloadsSize: () => Promise.resolve(0),
  runDownload: () =>
    Promise.reject(new Error("Downloads are not available in the web edition")),
  deleteDownload: () => Promise.resolve(false),
  deleteAllDownloads: () => Promise.resolve(false),
  queryVideoProgress: () => Promise.resolve(null),

  // Subtitles
  searchSubtitles: () => Promise.resolve([]),
  getSubtitleUrl: () => Promise.resolve(null),
  downloadSubtitlesForFile: () => Promise.resolve(null),
  deleteSubtitleFile: () => Promise.resolve(false),
  pruneSubtitlePaths: () => Promise.resolve(),
  onSubtitleFound: () => () => {},
  offSubtitleFound: () => {},

  // Update flow
  detectUpdateFormat: () => Promise.resolve(null),
  downloadAndInstallUpdate: () =>
    Promise.reject(new Error("Updates are not available in the web edition")),
  onUpdateProgress: () => () => {},
  offUpdateProgress: () => {},
  onBlockedUpdate: () => () => {},
  offBlockedUpdate: () => {},

  // Backups
  getScheduledBackupSettings: () => Promise.resolve({ enabled: false }),
  setScheduledBackupSettings: () => Promise.resolve(),
  performScheduledBackup: () => Promise.resolve(false),
  onScheduledBackupRequested: () => () => {},
  offScheduledBackupRequested: () => {},

  // App lifecycle
  onConfirmClose: () => () => {},
  offConfirmClose: () => {},
  respondClose: () => {},
  resetApp: () => {
    try {
      localStorage.clear();
    } catch {}
    location.reload();
    return Promise.resolve();
  },
  clearAppCache: () => Promise.resolve(),
  clearWatchData: () => Promise.resolve(),
  getCacheSize: () => Promise.resolve(0),

  // Misc
  showNotification: (title, body) => {
    try {
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification(title, { body });
      }
    } catch {}
  },
  getBlockStats: () => Promise.resolve(null),
  getPipWebContentsId: () => Promise.resolve(null),
  onDownloadProgress: () => () => {},
  offDownloadProgress: () => {},
  onM: () => () => {},
  offM: () => {},

  // Wyzie / keychain
  wyzieValidateKey: () => Promise.resolve({ ok: false }),
  wyzieOpenRedeem: () => Promise.resolve(),
  secureGet,
  secureSet,
};

const electronShim = new Proxy(known, {
  get(target, prop) {
    if (prop in target) return target[prop];
    if (typeof prop !== "string") return undefined;
    // Auto-stub anything else: subscribers / unsubscribers / async getters.
    if (prop.startsWith("on")) return () => () => {};
    if (prop.startsWith("off")) return () => {};
    return () => Promise.resolve(null);
  },
});

export function installWebShim() {
  if (typeof window === "undefined") return;
  if (!window.electron) {
    Object.defineProperty(window, "electron", {
      value: electronShim,
      writable: false,
      configurable: false,
    });
  }
}
