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

  // Waveform bars (22 of them, matches design)
  const WAVE_BARS = Array.from({ length: 22 }, (_, i) => 20 + Math.sin(i * 1.3) * 14);

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
    window.electron?.onHotkeyToggle(() => {
      if (appState === "idle") startRecording();
      else if (appState === "recording") stopRecording();
    });

    window.electron?.onHotkeyUnavailable(() => {
      appState = "needs-permission";
    });

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

  // ─── Derived UI vars ────────────────────────────────────────────────────
  $: surfaceMode =
    appState === "recording" ? "coral" :
    appState === "transcribing" || appState === "loading" ? "dark" :
    "cream";

  $: statusLabel =
    appState === "loading"             ? "Loading model" :
    appState === "idle"                ? "Ready" :
    appState === "recording"           ? `Recording ${formatTime(elapsedSecs)}` :
    appState === "transcribing"        ? "Processing" :
    appState === "error"               ? "Error" :
    appState === "needs-permission"    ? "Permission needed" :
    appState === "needs-accessibility" ? "Accessibility blocked" :
    "Ready";
</script>

<!-- ─── UI ─────────────────────────────────────────────────────────────── -->
<main class="popover" data-surface={surfaceMode}>
  <!-- Status row -->
  <div class="status-row">
    <span class="dot" class:pulse={appState === "recording" || appState === "transcribing" || appState === "loading"}></span>
    <span class="label">{statusLabel}</span>
  </div>

  <!-- Body: waveform when recording, transcript otherwise -->
  {#if appState === "recording"}
    <div class="waveform" aria-hidden="true">
      {#each WAVE_BARS as h, i}
        <span class="bar" style="height: {h}%; animation-delay: {i * 0.04}s"></span>
      {/each}
    </div>
  {:else if appState === "loading"}
    <p class="transcript dim">{loadProgress || "Initializing Whisper…"}</p>
  {:else if appState === "transcribing"}
    <p class="transcript dim">Transcribing…</p>
  {:else if appState === "error"}
    <p class="transcript error">{errorMsg || "Transcription failed"}</p>
  {:else if appState === "needs-permission"}
    <p class="transcript dim">Grant access in System Settings → Privacy &amp; Security → Accessibility, then relaunch.</p>
  {:else if appState === "needs-accessibility"}
    <p class="transcript dim">
      Saved to clipboard. Enable <b>Local Whisper</b> in System Settings → Privacy &amp; Security → Accessibility.
    </p>
    {#if lastText}
      <p class="transcript">"{lastText}"</p>
    {/if}
    <button class="dismiss" on:click={dismissAccessibility}>Dismiss</button>
  {:else if lastText}
    <p class="transcript">"{lastText}"</p>
  {:else}
    <p class="transcript placeholder">Press the shortcut to dictate</p>
  {/if}

  <!-- Meta row: app context + shortcut -->
  <div class="meta-row">
    <span class="app-chip">
      <span class="arrow">→</span>{frontmostApp || "—"}
    </span>
    <span class="shortcut">⌃⇧Space to start / stop</span>
  </div>
</main>

<style>
  :global(*, *::before, *::after) { box-sizing: border-box; margin: 0; padding: 0; }
  :global(body) {
    background: transparent;
    -webkit-font-smoothing: antialiased;
    user-select: none;
    -webkit-user-select: none;
  }

  /* ─── Design tokens ────────────────────────────────────────────────── */
  .popover {
    --coral:        #cc785c;
    --ink:          #141413;
    --body:        #3d3d3a;
    --muted:        #6c6a64;
    --muted-soft:   #8e8b82;
    --hairline:     #e6dfd8;
    --canvas:       #faf9f5;
    --surface-dark: #181715;
    --on-dark:      #faf9f5;
    --on-dark-soft: #a09d96;
    --accent-teal:  #5db8a6;
    --error:        #c64545;

    --serif: 'Cormorant Garamond', 'Tiempos Headline', Georgia, serif;
    --sans:  Inter, -apple-system, BlinkMacSystemFont, sans-serif;
    --mono:  'JetBrains Mono', ui-monospace, monospace;

    width: 340px;
    border-radius: 14px;
    padding: 20px 24px 18px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    font-family: var(--sans);
    -webkit-app-region: drag;
    transition: background 0.4s ease, box-shadow 0.4s ease, border-color 0.4s ease, color 0.3s;

    /* Default = cream */
    background: var(--canvas);
    color: var(--ink);
    border: 1px solid var(--hairline);
    box-shadow: 0 2px 12px rgba(20,20,19,0.08);
  }

  .popover[data-surface="coral"] {
    background: var(--coral);
    color: #fff;
    border: 1px solid rgba(255,255,255,0.15);
    box-shadow: 0 8px 40px rgba(204,120,92,0.5);
  }

  .popover[data-surface="dark"] {
    background: var(--surface-dark);
    color: var(--on-dark);
    border: 1px solid rgba(255,255,255,0.06);
    box-shadow: 0 8px 40px rgba(0,0,0,0.4);
  }

  /* ─── Status row ───────────────────────────────────────────────────── */
  .status-row {
    display: flex;
    align-items: center;
    gap: 9px;
  }
  .label {
    font-family: var(--sans);
    font-size: 17px;
    font-weight: 500;
    letter-spacing: -0.2px;
    color: inherit;
  }

  .dot {
    width: 10px; height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
    display: inline-block;
    position: relative;
  }
  /* Cream-state dot: hollow outline */
  .popover[data-surface="cream"] .dot {
    background: transparent;
    border: 2px solid var(--muted-soft);
  }
  .popover[data-surface="cream"] .status-row .dot.pulse {
    border-color: transparent;
    background: var(--accent-teal);
    box-shadow: 0 0 0 3px rgba(93,184,166,0.13);
  }
  /* Coral-state dot */
  .popover[data-surface="coral"] .dot {
    background: rgba(255,255,255,0.9);
  }
  /* Dark-state dot (processing/loading) */
  .popover[data-surface="dark"] .dot {
    background: var(--accent-teal);
    box-shadow: 0 0 0 3px rgba(93,184,166,0.13);
  }
  .dot.pulse::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: currentColor;
    opacity: 0.35;
    animation: pulseRing 1.4s ease-out infinite;
    color: var(--accent-teal);
  }
  .popover[data-surface="coral"] .dot.pulse::before {
    color: rgba(255,255,255,0.9);
  }

  @keyframes pulseRing {
    0%   { transform: scale(1);   opacity: 0.35; }
    100% { transform: scale(2.6); opacity: 0;    }
  }

  /* ─── Transcript ───────────────────────────────────────────────────── */
  .transcript {
    font-family: var(--serif);
    font-style: italic;
    font-weight: 400;
    font-size: 16px;
    line-height: 1.55;
    margin: 0;
    transition: color 0.3s, opacity 0.3s;
  }
  .popover[data-surface="cream"] .transcript { color: var(--body); }
  .popover[data-surface="coral"]  .transcript { color: rgba(255,255,255,0.86); }
  .popover[data-surface="dark"]   .transcript { color: var(--on-dark-soft); }

  .transcript.dim         { opacity: 0.55; }
  .transcript.placeholder { opacity: 0.45; }
  .transcript.error       { color: var(--error); font-style: normal; font-family: var(--sans); font-size: 14px; }

  /* ─── Waveform (recording) ─────────────────────────────────────────── */
  .waveform {
    display: flex;
    align-items: center;
    gap: 3px;
    height: 28px;
  }
  .bar {
    display: block;
    width: 3px;
    border-radius: 2px;
    background: rgba(255,255,255,0.7);
    animation: waveBar 0.8s ease-in-out infinite;
    transform-origin: center;
  }
  @keyframes waveBar {
    0%, 100% { transform: scaleY(0.4); }
    50%       { transform: scaleY(1.0); }
  }

  /* ─── Meta row ─────────────────────────────────────────────────────── */
  .meta-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .app-chip {
    font-family: var(--sans);
    font-size: 13px;
    font-weight: 500;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 60%;
  }
  .arrow { opacity: 0.7; }

  .shortcut {
    font-family: var(--mono);
    font-size: 11px;
    opacity: 0.7;
    white-space: nowrap;
  }

  /* Surface-specific muted color for meta row */
  .popover[data-surface="cream"] .app-chip { color: var(--ink); }
  .popover[data-surface="cream"] .shortcut { color: var(--muted-soft); }
  .popover[data-surface="coral"] .app-chip,
  .popover[data-surface="coral"] .shortcut { color: rgba(255,255,255,0.78); }
  .popover[data-surface="dark"]  .app-chip { color: var(--on-dark); }
  .popover[data-surface="dark"]  .shortcut { color: var(--on-dark-soft); }

  /* ─── Dismiss button (needs-accessibility) ─────────────────────────── */
  .dismiss {
    -webkit-app-region: no-drag;
    align-self: flex-start;
    font-family: var(--sans);
    font-size: 12px;
    font-weight: 500;
    padding: 6px 12px;
    background: var(--canvas);
    color: var(--ink);
    border: 1px solid var(--hairline);
    border-radius: 8px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .dismiss:active { background: var(--hairline); }
</style>
