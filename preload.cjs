// Local Whisper — Preload / IPC Bridge
// Preload scripts must use CommonJS (no ES module import)
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electron", {
  onHotkeyToggle:     (cb) => ipcRenderer.on("hotkey-toggle",     () => cb()),
  onHotkeyUnavailable:(cb) => ipcRenderer.on("hotkey-unavailable",() => cb()),
  checkAccessibility: ()     => ipcRenderer.invoke("check-accessibility"),
  pasteText:          (text)  => ipcRenderer.invoke("paste-text",     text),
  setTrayState:       (state) => ipcRenderer.invoke("set-tray-state", state),
});
