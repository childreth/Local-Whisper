<script>
  import { onMount, onDestroy } from "svelte";
  import { initWhisper, transcribeBuffer } from "./lib/whisper.js";

  // ─── State ──────────────────────────────────────────────────────────────
  /** @type {"loading" | "idle" | "recording" | "transcribing" | "error" | "needs-permission" | "needs-accessibility"} */
  let appState    = "loading";
  let lastText    = "";
  let errorMsg    = "";
  let elapsedSecs = 0;
  let loadProgress = "";
  let recordingTimer = null;

  // MediaRecorder state
  let mediaStream  = null;
  let recorder     = null;
  let audioChunks  = [];

  // Frontmost app tracking
  let frontmostApp = "";
  let frontmostTimer = null;
  const SELF_NAMES = new Set(["Electron", "Local Whisper", "local-whisper"]);

  // ─── Helpers ────────────────────────────────────────────────────────────
  function formatTime(secs) {
    const m = String(Math.floor(secs / 60)).padStart(2, "0");
    const s = String(secs % 60).padStart(2, "0");
    return `${m}:${s}`;
  }

  function setError(msg) {
    appState = "error";
    errorMsg = msg;
    window.electron?.setTrayState("error");
    setTimeout(() => { appState = "idle"; errorMsg = ""; window.electron?.setTrayState("idle"); }, 4000);
  }

  // ─── Recording ──────────────────────────────────────────────────────────

  async function startRecording() {
    if (appState !== "idle") return;
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      audioChunks = [];
      recorder = new MediaRecorder(mediaStream);
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };
      recorder.onstop = onRecordingStop;
      recorder.start();

      appState = "recording";
      elapsedSecs = 0;
      recordingTimer = setInterval(() => elapsedSecs++, 1000);
      window.electron?.setTrayState("recording");
    } catch (e) {
      setError(`Mic error: ${e.message}`);
    }
  }

  function stopRecording() {
    if (appState !== "recording" || !recorder) return;
    clearInterval(recordingTimer);
    recorder.stop();
    mediaStream?.getTracks().forEach((t) => t.stop());
    appState = "transcribing";
    window.electron?.setTrayState("transcribing");
  }

  async function onRecordingStop() {
    try {
      const blob = new Blob(audioChunks, { type: recorder.mimeType });
      const arrayBuffer = await blob.arrayBuffer();
      const text = await transcribeBuffer(arrayBuffer);
      lastText = text;
      if (text) await window.electron?.pasteText(text);
      appState = "idle";
      window.electron?.setTrayState("idle");
    } catch (e) {
      console.error("[transcribe]", e);
      if (e.message?.includes("ACCESSIBILITY_DENIED")) {
        appState = "needs-accessibility";
        window.electron?.setTrayState("error");
        return;
      }
      setError(e.message || "Transcription failed");
    }
  }

  function dismissAccessibility() {
    appState = "idle";
    window.electron?.setTrayState("idle");
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────
  onMount(async () => {
    // Register IPC handlers before any async work so we don't miss messages
    // sent while the Whisper model is loading.
    window.electron?.onHotkeyToggle(() => {
      if (appState === "idle") startRecording();
      else if (appState === "recording") stopRecording();
    });

    window.electron?.onHotkeyUnavailable(() => {
      appState = "needs-permission";
    });

    // Poll frontmost app so the UI shows where dictation will land
    const pollFrontmost = async () => {
      const name = await window.electron?.getFrontmostApp();
      if (name && !SELF_NAMES.has(name)) frontmostApp = name;
    };
    pollFrontmost();
    frontmostTimer = setInterval(pollFrontmost, 1000);

    try {
      await initWhisper((file, pct) => {
        loadProgress = `${file}: ${Math.round(pct)}%`;
      });
      appState = "idle";
      window.electron?.setTrayState("idle");
    } catch (e) {
      appState = "error";
      errorMsg = `Model load failed: ${e.message}`;
    }
  });

  onDestroy(() => {
    clearInterval(recordingTimer);
    clearInterval(frontmostTimer);
    mediaStream?.getTracks().forEach((t) => t.stop());
  });
</script>

<!-- ─── UI ─────────────────────────────────────────────────────────────── -->
<main
  class="container"
  class:recording={appState === "recording"}
  class:error={appState === "error"}
>
  {#if appState === "loading"}
    <div class="status">
      <span class="dot pulse grey"></span>
      <span>Loading model...</span>
    </div>
    {#if loadProgress}
      <p class="hint">{loadProgress}</p>
    {/if}

  {:else if appState === "idle"}
    <div class="status">
      <span class="dot grey"></span>
      <span>Ready</span>
    </div>
    {#if lastText}
      <p class="last-text">"{lastText}"</p>
    {/if}

  {:else if appState === "recording"}
    <div class="status">
      <span class="dot pulse red"></span>
      <span>Recording {formatTime(elapsedSecs)}</span>
    </div>
    <p class="hint">Press ⌃⇧Space again to transcribe</p>

  {:else if appState === "transcribing"}
    <div class="status">
      <span class="dot pulse amber"></span>
      <span>Transcribing...</span>
    </div>

  {:else if appState === "error"}
    <div class="status">
      <span class="dot red"></span>
      <span class="error-text">{errorMsg || "Transcription failed"}</span>
    </div>

  {:else if appState === "needs-permission"}
    <div class="status">
      <span class="dot red"></span>
      <span>Accessibility permission required</span>
    </div>
    <p class="hint">Grant access in System Settings → Privacy &amp; Security → Accessibility, then relaunch.</p>

  {:else if appState === "needs-accessibility"}
    <div class="status">
      <span class="dot red"></span>
      <span class="error-text">Can't paste — Accessibility blocked</span>
    </div>
    <p class="hint">
      Transcription saved to clipboard. To auto-paste:<br/>
      1. Open <b>System Settings → Privacy &amp; Security → Accessibility</b><br/>
      2. Enable <b>Local Whisper</b> (or <b>Electron</b> in dev)<br/>
      3. If already listed, toggle it off and on, then relaunch
    </p>
    {#if lastText}
      <p class="last-text">"{lastText}"</p>
    {/if}
    <button class="dismiss" on:click={dismissAccessibility}>Dismiss</button>
  {/if}

  {#if frontmostApp}
    <p class="target">→ {frontmostApp}</p>
  {/if}

  <footer>⌃⇧Space to start / stop</footer>
</main>

<style>
  :global(*, *::before, *::after) { box-sizing: border-box; margin: 0; padding: 0; }
  :global(body) {
    background: transparent;
    font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif;
    -webkit-font-smoothing: antialiased;
    user-select: none;
    -webkit-user-select: none;
  }

  .container {
    width: 320px;
    min-height: 100px;
    background: rgba(30, 30, 32, 0.92);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 14px;
    padding: 18px 20px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    color: #fff;
    transition: background 0.2s;
    -webkit-app-region: drag; /* Electron drag region (replaces data-tauri-drag-region) */
  }
  .container.recording { background: rgba(40, 20, 20, 0.94); }
  .container.error     { background: rgba(40, 20, 20, 0.94); }

  .status {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 14px;
    font-weight: 500;
  }

  .dot {
    width: 9px; height: 9px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .dot.grey  { background: #888; }
  .dot.red   { background: #ff3b30; }
  .dot.amber { background: #ff9500; }
  .dot.pulse { animation: pulse 1.2s ease-in-out infinite; }

  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50%       { opacity: 0.5; transform: scale(0.85); }
  }

  .last-text {
    font-size: 12px;
    color: rgba(255,255,255,0.5);
    font-style: italic;
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .hint {
    font-size: 11px;
    color: rgba(255,255,255,0.4);
  }

  .error-text {
    color: #ff6b6b;
    font-size: 13px;
  }

  .target {
    font-size: 11px;
    color: rgba(255,255,255,0.55);
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  footer {
    font-size: 10px;
    color: rgba(255,255,255,0.25);
    margin-top: 4px;
  }

  .dismiss {
    -webkit-app-region: no-drag;
    align-self: flex-start;
    font-size: 11px;
    padding: 4px 10px;
    background: rgba(255,255,255,0.1);
    color: #fff;
    border: 1px solid rgba(255,255,255,0.2);
    border-radius: 6px;
    cursor: pointer;
  }
  .dismiss:hover { background: rgba(255,255,255,0.18); }
</style>
