/**
 * Whisper transcription module using Transformers.js
 * Loads onnx-community/whisper-small and runs inference via WebGPU (Electron/Chromium)
 * or WASM fallback.
 */

import { pipeline } from "@huggingface/transformers";

const MODEL_ID = "onnx-community/whisper-small";
const TARGET_SR = 16000;

let pipe = null;

/**
 * Load the Whisper pipeline. Call once on app startup.
 * @param {(file: string, pct: number) => void} onProgress
 */
export async function initWhisper(onProgress) {
  pipe = await pipeline("automatic-speech-recognition", MODEL_ID, {
    device: "webgpu",
    dtype: "fp32",
    progress_callback: (data) => {
      if (data.status === "progress" && onProgress) {
        onProgress(data.file, data.progress);
      }
    },
  });
}

/**
 * Transcribe an ArrayBuffer (any audio format supported by AudioContext).
 * Used by the Electron renderer with MediaRecorder output.
 * @param {ArrayBuffer} arrayBuffer
 * @returns {Promise<string>} transcribed text
 */
export async function transcribeBuffer(arrayBuffer) {
  if (!pipe) throw new Error("Whisper model not loaded");

  const tStart = performance.now();

  const tDecodeStart = performance.now();
  const { samples, sampleRate } = await decodeAudioBuffer(arrayBuffer);
  const resampled = sampleRate === TARGET_SR ? samples : await resampleTo16kHz(samples, sampleRate);
  const audio = normalizeAudio(resampled);
  const decodeMs = performance.now() - tDecodeStart;

  const rms = Math.sqrt(audio.reduce((s, x) => s + x * x, 0) / audio.length);
  const audioDurationSec = audio.length / TARGET_SR;
  console.log(`[whisper] audio: ${audio.length} samples @ ${TARGET_SR}Hz (${audioDurationSec.toFixed(2)}s), RMS=${rms.toFixed(5)}, decode+resample=${decodeMs.toFixed(0)}ms`);
  if (rms < 0.0001) throw new Error("Audio is silent — check microphone level");

  const tInferStart = performance.now();
  const result = await pipe(audio, {
    language: "en",
    task: "transcribe",
    chunk_length_s: 30,
    stride_length_s: 5,
  });
  const inferMs = performance.now() - tInferStart;
  const totalMs = performance.now() - tStart;
  const rtf = inferMs / 1000 / audioDurationSec;
  console.log(`[whisper] transcribe: inference=${inferMs.toFixed(0)}ms, total=${totalMs.toFixed(0)}ms, RTF=${rtf.toFixed(2)}x`);

  return (result.text || "").trim();
}

// ─── Audio Decoding ───────────────────────────────────────────────────────────

/**
 * Decode any AudioContext-supported format (webm, wav, mp4, etc.) to Float32Array.
 */
async function decodeAudioBuffer(arrayBuffer) {
  const ctx = new AudioContext();
  try {
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    return {
      samples: audioBuffer.getChannelData(0),
      sampleRate: audioBuffer.sampleRate,
    };
  } finally {
    ctx.close();
  }
}

// ─── Normalization ────────────────────────────────────────────────────────────

/**
 * Peak-normalize to [-1, 1] — prevents Whisper hallucinations on quiet audio.
 */
function normalizeAudio(samples) {
  let maxAbs = 0;
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]);
    if (abs > maxAbs) maxAbs = abs;
  }
  if (maxAbs === 0) return samples;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] / maxAbs;
  return out;
}

// ─── Resampling ───────────────────────────────────────────────────────────────

/**
 * Resample using OfflineAudioContext — proper anti-aliasing, no artifacts.
 */
async function resampleTo16kHz(samples, fromRate) {
  const outLen = Math.ceil(samples.length * TARGET_SR / fromRate);
  const ctx = new OfflineAudioContext(1, outLen, TARGET_SR);
  const buf = ctx.createBuffer(1, samples.length, fromRate);
  buf.getChannelData(0).set(samples);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start(0);
  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0);
}
