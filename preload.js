// Local Whisper — Preload / IPC Bridge
// ======================================
// Exposes a safe, minimal API to the renderer via contextBridge.
// Renderer code uses window.electron.* — no direct Node.js access.

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electron", {
  // Hotkey events from main process
  onHotkeyPress:   (cb) => ipcRenderer.on("hotkey-press",   () => cb()),
  onHotkeyRelease: (cb) => ipcRenderer.on("hotkey-release", () => cb()),

  // Commands to main process
  pasteText:     (text)  => ipcRenderer.invoke("paste-text",     text),
  setTrayState:  (state) => ipcRenderer.invoke("set-tray-state", state),
});
