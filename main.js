// Local Whisper — Electron Main Process
//
// Flow:
//   ⌃⇧Space          → globalShortcut → send 'hotkey-toggle' to renderer
//   Renderer         → MediaRecorder → Transformers.js Whisper transcribes
//   Renderer         → invokes 'paste-text' → main pastes via pbcopy + osascript

import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, globalShortcut } from "electron";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { execFile } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

let mainWindow = null;
let tray = null;

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
  tray.setToolTip("Local Whisper — Ready (⌃⇧Space)");

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

// ─── Global Hotkey ───────────────────────────────────────────────────────────

function setupHotkey() {
  const ok = globalShortcut.register("Control+Shift+Space", () => {
    mainWindow?.webContents.send("hotkey-toggle");
  });
  if (!ok) {
    mainWindow?.webContents.once("did-finish-load", () => {
      mainWindow.webContents.send("hotkey-unavailable");
    });
  }
}

// ─── IPC Handlers ────────────────────────────────────────────────────────────

ipcMain.handle("paste-text", async (_event, text) => {
  return pasteText(text);
});

ipcMain.handle("get-frontmost-app", async () => {
  return new Promise((resolve) => {
    execFile(
      "osascript",
      ["-e", 'tell application "System Events" to get name of first application process whose frontmost is true'],
      (err, stdout) => {
        if (err) return resolve(null);
        resolve(stdout.trim() || null);
      }
    );
  });
});

ipcMain.handle("set-tray-state", (_event, state) => {
  if (!tray) return;
  const tooltips = {
    recording:    "Local Whisper — 🔴 Recording...",
    transcribing: "Local Whisper — ⏳ Transcribing...",
    error:        "Local Whisper — ❌ Error",
  };
  tray.setToolTip(tooltips[state] ?? "Local Whisper — Ready (⌃⇧Space)");
});

// ─── Paste ───────────────────────────────────────────────────────────────────

function pasteText(text) {
  return new Promise((resolve, reject) => {
    const tStart = Date.now();
    console.log(`[paste] starting: ${text.length} chars`);
    const pbcopy = execFile("pbcopy", (err) => {
      if (err) {
        console.error(`[paste] pbcopy failed:`, err);
        return reject(new Error(`pbcopy: ${err.message}`));
      }
      console.log(`[paste] pbcopy ok (${Date.now() - tStart}ms), dispatching ⌘V`);
      setTimeout(() => {
        execFile(
          "osascript",
          ["-e", 'tell application "System Events" to keystroke "v" using {command down}'],
          (err2, stdout, stderr) => {
            if (err2) {
              console.error(`[paste] osascript failed (${Date.now() - tStart}ms):`, err2.message, stderr);
              const msg = `${err2.message} ${stderr || ""}`;
              if (msg.includes("1002") || msg.includes("not allowed to send keystrokes") || msg.includes("not authorized")) {
                return reject(new Error("ACCESSIBILITY_DENIED"));
              }
              return reject(new Error(`osascript: ${err2.message}`));
            }
            console.log(`[paste] done (${Date.now() - tStart}ms)`);
            resolve();
          }
        );
      }, 80);
    });
    pbcopy.stdin.on("error", (err) => {
      console.error(`[paste] pbcopy stdin error:`, err);
      reject(new Error(`pbcopy stdin: ${err.message}`));
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

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});
