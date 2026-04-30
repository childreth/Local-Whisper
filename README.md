# Local Whisper

A macOS menubar app that transcribes speech locally using **Whisper** — no cloud, no subscription, no data leaving your machine.

Press **⌃⇧Space** to start recording, press again to stop — your words are transcribed and pasted wherever your cursor is.

---

## How it works

```
⌃⇧Space          →  audio captured locally
⌃⇧Space again    →  Whisper transcribes on-device
                    Result pasted into focused app via osascript
```

**Stack:**
- **Electron + Svelte** — native macOS menubar app
- **@huggingface/transformers** — runs `onnx-community/whisper-small` via WebGPU (WASM fallback)
- **Electron globalShortcut** — Carbon-level global hotkey

---

## Requirements

- macOS with Apple Silicon (M1/M2/M3/M4)
- Node.js 18+

---

## Setup

```bash
npm install
```

---

## Running

```bash
npm run electron:dev
```

---

## Building

```bash
npm run electron:build
```

Or use the included build script which also resets the microphone TCC permission:

```bash
chmod +x build-mac.sh
./build-mac.sh
```

> On first launch after a build, macOS will ask for **Microphone** permission. Approve it.

You also need **Accessibility** toggled on in **System Settings → Privacy & Security** — used for paste simulation via `osascript`.

---

## Project structure

```
Local Whisper/
├── src/
│   ├── main.js         # Svelte entry point
│   ├── App.svelte      # UI
│   └── lib/
│       └── whisper.js  # Transcription logic
├── main.js             # Electron main process
├── preload.cjs         # Electron preload script
├── index.html
├── icons/
├── build-mac.sh        # Build + TCC reset script
└── package.json
```

---

## Permissions

macOS requires explicit permission for:
- **Microphone** — to record audio
- **Accessibility** — to paste text into other apps
