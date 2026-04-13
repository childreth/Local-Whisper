// Local Whisper — Electron Main Process
// =======================================
// Replaces app/src-tauri/src/lib.rs
//
// Flow:
//   ⌥⇧Space keydown  → send 'hotkey-press' to renderer → MediaRecorder starts
//   ⌥⇧Space keyup    → send 'hotkey-release' to renderer → MediaRecorder stops
//   Renderer          → Transformers.js Whisper transcribes
//   Renderer          → invokes 'paste-text' → main pastes via pbcopy + osascript

import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, systemPreferences } from "electron";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { execFile, execFileSync } from "child_process";
import { uIOhook, UiohookKey } from "uiohook-napi";

const __dirname = dirname(fileURLToPath(import.meta.url));

let mainWindow = null;
let tray = null;

// Track modifier state for ⌥⇧Space detection
let altHeld = false;
let shiftHeld = false;
let recordingActive = false;
let lastToggleMs = 0;

// Set to false if accessibility permission is missing so the renderer
// can query it synchronously after mounting (race-condition fix).
let accessibilityGranted = true;

// ─── Window ──────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 320,
    height: 180,
    resizable: true,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadFile(join(__dirname, "dist", "index.html"));

  // Primary: show on first paint
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.center();
  });

  // Fallback: ready-to-show can silently not fire in packaged builds
  mainWindow.webContents.once("did-finish-load", () => {
    if (!mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.center();
    }
  });

  mainWindow.webContents.on("did-fail-load", (_e, code, desc) => {
    console.error(`[main] page failed to load: ${code} ${desc}`);
  });

  // Open DevTools with Cmd+Option+I
  mainWindow.webContents.on("before-input-event", (_e, input) => {
    if (input.meta && input.alt && input.key === "i") {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  });
}

// ─── Tray ────────────────────────────────────────────────────────────────────

function createTray() {
  const iconPath = join(__dirname, "icons", "tray-idle.png");
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 });
  icon.setTemplateImage(true);

  tray = new Tray(icon);
  tray.setToolTip("Local Whisper — Ready (⌥⇧Space)");

  const menu = Menu.buildFromTemplate([
    {
      label: "Show / Hide",
      click: toggleWindow,
    },
    {
      label: "Open DevTools",
      click: () => mainWindow?.webContents.openDevTools({ mode: "detach" }),
    },
    { type: "separator" },
    {
      label: "Quit Local Whisper",
      click: () => app.quit(),
    },
  ]);

  tray.setContextMenu(menu);
  tray.on("click", toggleWindow);
}

function toggleWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

// ─── Global Hotkey (⌥⇧Space PTT) ────────────────────────────────────────────
// uiohook-napi exposes true keydown/keyup — required for PTT press-and-hold.
// Electron's globalShortcut only fires on press, not release.

function setupHotkey() {
  uIOhook.on("keydown", (e) => {
    if (e.keycode === UiohookKey.Alt)   altHeld = true;
    if (e.keycode === UiohookKey.Shift) shiftHeld = true;

    // Toggle on ⌥⇧Space — debounce 300ms to suppress duplicate events
    if (e.keycode === UiohookKey.Space && altHeld && shiftHeld) {
      const now = Date.now();
      if (now - lastToggleMs > 300) {
        lastToggleMs = now;
        recordingActive = !recordingActive;
        console.log(`[hotkey] toggle fired, sending IPC. win=${!!mainWindow} destroyed=${mainWindow?.isDestroyed()}`);
        mainWindow?.webContents.send("hotkey-toggle");
      } else {
        console.log(`[hotkey] debounced (Δ=${now - lastToggleMs}ms)`);
      }
    }
  });

  uIOhook.on("keyup", (e) => {
    if (e.keycode === UiohookKey.Alt)   altHeld = false;
    if (e.keycode === UiohookKey.Shift) shiftHeld = false;
  });

  // On macOS, uiohook needs Accessibility permission.
  // After re-signing the app, macOS resets the grant — check explicitly.
  const trusted = systemPreferences.isTrustedAccessibilityClient(false);
  if (!trusted) {
    console.warn("[hotkey] Accessibility permission not granted — prompting user");
    accessibilityGranted = false;
    // Trigger the system prompt (opens the dialog)
    systemPreferences.isTrustedAccessibilityClient(true);
    mainWindow?.webContents.once("did-finish-load", () => {
      mainWindow.webContents.send("hotkey-unavailable");
    });
    return;
  }

  try {
    uIOhook.start();
  } catch (err) {
    console.error("[hotkey] uIOhook failed to start:", err);
    mainWindow?.webContents.once("did-finish-load", () => {
      mainWindow.webContents.send("hotkey-unavailable");
    });
  }
}

// ─── IPC Handlers ────────────────────────────────────────────────────────────

ipcMain.handle("check-accessibility", () => accessibilityGranted);

ipcMain.handle("paste-text", async (_event, text) => {
  return pasteText(text);
});

ipcMain.handle("set-tray-state", (_event, state) => {
  if (!tray) return;
  const tooltips = {
    recording:    "Local Whisper — 🔴 Recording...",
    transcribing: "Local Whisper — ⏳ Transcribing...",
    error:        "Local Whisper — ❌ Error",
  };
  tray.setToolTip(tooltips[state] ?? "Local Whisper — Ready (⌥⇧Space)");
});

// ─── Paste ───────────────────────────────────────────────────────────────────

function pasteText(text) {
  return new Promise((resolve, reject) => {
    const pbcopy = execFile("pbcopy", (err) => {
      if (err) return reject(new Error(`pbcopy: ${err.message}`));
      setTimeout(() => {
        execFile(
          "osascript",
          ["-e", 'tell application "System Events" to keystroke "v" using {command down}'],
          (err2) => {
            if (err2) reject(new Error(`osascript: ${err2.message}`));
            else resolve();
          }
        );
      }, 80);
    });
    pbcopy.stdin.write(text);
    pbcopy.stdin.end();
  });
}

// ─── App Lifecycle ───────────────────────────────────────────────────────────

app.whenReady().then(() => {
  app.dock.hide(); // menubar-only, no Dock icon

  createWindow();
  createTray();
  setupHotkey();
});

app.on("window-all-closed", (e) => {
  // Prevent quitting when window is closed — stay in tray
  e.preventDefault();
});

app.on("before-quit", () => {
  uIOhook.stop();
});
