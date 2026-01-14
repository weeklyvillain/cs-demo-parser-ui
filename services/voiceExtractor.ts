import { OpusDecoder } from 'opus-decoder';

/**
 * Voice extraction utilities
 * Based on: https://github.com/LaihoE/demoparser/blob/main/examples/voice_to_wav/main.py
 */

export interface VoiceData {
  steamid: string;
  bytes: Uint8Array;
  tick?: number;
}

/**
 * Decode Opus audio bytes to PCM
 */
export async function decodeOpusAudio(
  opusBytes: Uint8Array[],
  sampleRate: number = 48000,
  channels: number = 1
): Promise<Int16Array> {
  const decoder = new OpusDecoder({
    sampleRate,
    channels,
    frameSize: 960, // Standard frame size for CS2 voice
  });

  const pcmFrames: Int16Array[] = [];

  for (const bytes of opusBytes) {
    try {
      const pcm = await decoder.decode(bytes);
      pcmFrames.push(pcm);
    } catch (error) {
      console.warn('Failed to decode Opus frame:', error);
    }
  }

  decoder.destroy();

  // Concatenate all PCM frames
  const totalLength = pcmFrames.reduce((sum, frame) => sum + frame.length, 0);
  const result = new Int16Array(totalLength);
  let offset = 0;
  for (const frame of pcmFrames) {
    result.set(frame, offset);
    offset += frame.length;
  }

  return result;
}

/**
 * Convert PCM data to WAV file format
 */
export function pcmToWav(pcmData: Int16Array, sampleRate: number = 48000, channels: number = 1): Blob {
  const length = pcmData.length;
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);

  // WAV header
  const writeString = (offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // audio format (1 = PCM)
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true); // byte rate
  view.setUint16(32, channels * 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, length * 2, true);

  // Write PCM data
  const pcmView = new Int16Array(buffer, 44);
  pcmView.set(pcmData);

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Remove silence from PCM audio data
 * @param pcmData PCM audio data
 * @param threshold Silence threshold (default: 100)
 * @param minSilenceDuration Minimum duration of silence to remove (in samples)
 * @returns PCM data with silence removed
 */
export function removeSilence(
  pcmData: Int16Array,
  threshold: number = 100,
  minSilenceDuration: number = 4800 // ~100ms at 48kHz
): Int16Array {
  const result: number[] = [];
  let silenceStart = -1;
  let consecutiveSilence = 0;

  for (let i = 0; i < pcmData.length; i++) {
    const amplitude = Math.abs(pcmData[i]);
    
    if (amplitude < threshold) {
      if (silenceStart === -1) {
        silenceStart = i;
      }
      consecutiveSilence++;
    } else {
      // If we found silence but it's too short, keep it
      if (silenceStart !== -1 && consecutiveSilence < minSilenceDuration) {
        // Keep the silence samples
        for (let j = silenceStart; j < i; j++) {
          result.push(pcmData[j]);
        }
      }
      // Reset silence tracking
      silenceStart = -1;
      consecutiveSilence = 0;
      result.push(pcmData[i]);
    }
  }

  // Handle trailing silence
  if (silenceStart !== -1 && consecutiveSilence >= minSilenceDuration) {
    // Remove trailing silence
  } else if (silenceStart !== -1) {
    // Keep short trailing silence
    for (let j = silenceStart; j < pcmData.length; j++) {
      result.push(pcmData[j]);
    }
  }

  return new Int16Array(result);
}

/**
 * Download a blob as a file
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

