# Local Whisper

A macOS menubar app that transcribes speech locally using **Whisper** — no cloud, no subscription, no data leaving your machine.

Hold a hotkey, speak, release — your words appear wherever your cursor is.

---

## How it works

```
Hold hotkey      →  audio captured locally
Release          →  Whisper transcribes on-device
                    Result pasted into focused app via osascript
```

**Stack:**
- **Electron + Svelte** — native macOS menubar app
- **@huggingface/transformers** — runs Whisper fully on-device
- **uiohook-napi** — global hotkey capture

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

You also need these toggled on in **System Settings → Privacy & Security:**
- **Accessibility** — for paste simulation
- **Input Monitoring** — for the global hotkey

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
├── preload.js          # Electron preload script
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
- **Input Monitoring** — to capture the global hotkey
