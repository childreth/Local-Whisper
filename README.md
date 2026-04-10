# 🎙️ Local Whisper

A macOS menubar app that transcribes speech locally using **Google Gemma 4 E2B** — no cloud, no subscription, no data leaving your machine.

Hold a hotkey, speak, release — your words appear wherever your cursor is.

---

## How it works

```
Hold ⌥⇧Space  →  cpal records mic (Rust)
Release        →  WAV sent to local Python sidecar
                   Gemma 4 E2B transcribes on MPS (Apple Silicon GPU)
                   Result pasted into focused app via osascript
```

**Stack:**
- **Tauri 2 + Svelte** — native macOS menubar app, floating UI panel
- **Rust (cpal + hound + ureq)** — audio capture, WAV encoding, HTTP to sidecar
- **Python FastAPI** — inference server, stays resident, loads model once
- **google/gemma-4-E2B-it** — 5B parameter any-to-any multimodal model via HuggingFace Transformers + MPS

---

## Requirements

- macOS with Apple Silicon (M1/M2/M3/M4)
- Python 3.11+
- Rust / Cargo
- Node.js 18+

---

## Setup

### 1. Sidecar (Python inference server)

```bash
cd sidecar
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

On first run the model (~10GB) downloads from HuggingFace automatically.

### 2. App (Tauri + Svelte)

```bash
cd app
npm install
```

---

## Running

**Terminal 1 — start the sidecar:**
```bash
cd sidecar
source venv/bin/activate
python3 sidecar.py
```

Wait for `✅ Model ready — listening on port 8765` (first run downloads the model).

**Terminal 2 — launch the app:**
```bash
open "app/src-tauri/target/release/bundle/macos/Local Whisper.app"
```

The floating panel shows **Ready** when the sidecar is up. Hold **⌥⇧Space** (Option+Shift+Space) to record, release to transcribe and paste.

---

## Building

Use the included build script — it compiles, bundles, patches the Info.plist with microphone permissions, and resets TCC so macOS re-prompts for mic access:

```bash
cd app
chmod +x build-mac.sh
./build-mac.sh
```

> On first launch after a build, macOS will ask for **Microphone** permission. Approve it.

You also need these toggled on in **System Settings → Privacy & Security:**
- **Accessibility** — for the global hotkey and paste simulation
- **Input Monitoring** — for capturing ⌥⇧Space globally

---

## Project structure

```
Local Whisper/
├── sidecar/
│   ├── sidecar.py          # FastAPI inference server (Gemma 4 E2B)
│   └── requirements.txt
└── app/
    ├── build-mac.sh        # Build + patch + TCC reset script
    ├── src/
    │   └── App.svelte      # Floating UI panel
    └── src-tauri/
        ├── src/lib.rs      # Rust: hotkey, cpal recording, paste
        ├── capabilities/
        │   └── default.json
        └── tauri.conf.json
```

---

## Hotkey

Default: **⌥⇧Space** (Option + Shift + Space)

To change it, update `Modifiers::ALT | Modifiers::SHIFT` and `Code::Space` in `app/src-tauri/src/lib.rs`, then rebuild.

---

## Known limitations

- Sidecar must be started manually each session (auto-launch coming)
- Transcription takes ~30–45s (model warmup after first use drops to ~5–10s)
- Some occasional word repetition — Gemma 4 E2B is a general model, not a dedicated ASR model
- Requires rebuilding + re-granting mic permission after each `./build-mac.sh`

---

## Model

**google/gemma-4-E2B-it** — Apache 2.0 license  
5.1B parameters, native audio input, runs fully on-device via MPS (Metal Performance Shaders).
