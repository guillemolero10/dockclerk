// Browser only: turns what MediaRecorder gave us (webm/opus on Chrome and Android, mp4/aac on Safari) into the WAV that
// Meta's voice model takes: mono, 16-bit, 16 kHz. No library and no server binary: the browser already decodes both formats.

import { downsample, encodeWav, toMono, WAV_RATE } from "./wav";

export async function recordingToWav(blob: Blob): Promise<Blob> {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const context = new Ctx();
  try {
    const bytes = await blob.arrayBuffer();
    // Callback form too: old Safari has no promise version. Resolving twice is harmless.
    const decoded = await new Promise<AudioBuffer>((resolve, reject) => {
      const promise = context.decodeAudioData(bytes, resolve, reject) as Promise<AudioBuffer> | undefined;
      promise?.then(resolve, reject);
    });
    return wavFromBuffer(decoded);
  } finally {
    void context.close();
  }
}

function wavFromBuffer(buffer: AudioBuffer): Blob {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const mono = downsample(toMono(channels), buffer.sampleRate, WAV_RATE);
  return new Blob([encodeWav(mono, WAV_RATE) as BlobPart], { type: "audio/wav" });
}
