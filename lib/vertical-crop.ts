import { spawn } from 'child_process';
import { writeFile, unlink, readFile } from 'fs/promises';
import { join, dirname } from 'path';

interface FaceData {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  speaking: boolean;
}

interface FrameData {
  time: number;
  faces: FaceData[];
  active_speaker_id: number | null;
}

interface TrackingResult {
  width: number;
  height: number;
  fps: number;
  sample_fps: number;
  frames: FrameData[];
}

const SCRIPT_PATH = join(process.cwd(), 'scripts', 'face_tracker.py');
const MAX_PAN_SPEED = 150; // px/s safety cap (EMA handles smoothness, this prevents extreme cases)
const TAU_NORMAL = 1.8; // seconds: time constant for normal face tracking (higher = lazier follow)
const TAU_SWITCH = 0.35; // seconds: time constant right after speaker change (lower = faster pan)
const SWITCH_DURATION = 1.2; // seconds to keep fast tau after a speaker switch

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => {
      const msg = d.toString();
      stderr += msg;
      if (msg.includes('[face_tracker]')) process.stderr.write(msg);
    });
    proc.on('close', (code: number) => {
      if (code !== 0) reject(new Error(stderr.slice(-800)));
      else resolve();
    });
  });
}

/** Limit pan speed between consecutive positions (safety cap only) */
function limitPanSpeed(positions: number[], timestamps: number[], maxSpeed: number): number[] {
  const result = [...positions];
  for (let i = 1; i < result.length; i++) {
    const dt = timestamps[i] - timestamps[i - 1];
    const maxDelta = maxSpeed * dt;
    const delta = result[i] - result[i - 1];
    if (Math.abs(delta) > maxDelta) {
      result[i] = result[i - 1] + Math.sign(delta) * maxDelta;
    }
  }
  return result;
}

/**
 * Compute crop X for each frame using Exponential Moving Average (EMA).
 *
 * Uses a slow time constant (TAU_NORMAL) for organic, camera-like tracking,
 * and a fast time constant (TAU_SWITCH) right after the active speaker changes,
 * so the camera cuts to the new speaker quickly without feeling like a teleport.
 */
function computeCropX(
  frames: FrameData[],
  videoWidth: number,
  cropWidth: number,
  _sampleFps: number
): number[] {
  const clamp = (v: number) => Math.max(0, Math.min(videoWidth - cropWidth, v));
  const defaultX = clamp(videoWidth / 2 - cropWidth / 2);

  // Compute raw ideal target per frame
  const targets = frames.map((frame) => {
    const speaker = frame.faces.find((f) => f.id === frame.active_speaker_id);
    if (!speaker) return defaultX;
    return clamp(speaker.x + speaker.w / 2 - cropWidth / 2);
  });

  // EMA pass with adaptive time constant
  const result: number[] = [];
  let current = targets[0];
  let prevSpeakerId = frames[0]?.active_speaker_id ?? null;
  let switchTime = -Infinity;

  for (let i = 0; i < frames.length; i++) {
    const dt = i === 0 ? 0 : frames[i].time - frames[i - 1].time;
    const speakerId = frames[i].active_speaker_id;

    // Detect speaker switch (ignore null → real switch to avoid false triggers)
    if (speakerId !== null && speakerId !== prevSpeakerId) {
      switchTime = frames[i].time;
      prevSpeakerId = speakerId;
    }

    const inSwitch = frames[i].time - switchTime < SWITCH_DURATION;
    const tau = inSwitch ? TAU_SWITCH : TAU_NORMAL;
    // EMA: alpha close to 1 = fast response, close to 0 = very lazy
    const alpha = dt > 0 ? 1 - Math.exp(-dt / tau) : 0;

    current = current + alpha * (targets[i] - current);
    result.push(current);
  }

  const timestamps = frames.map((f) => f.time);
  const limited = limitPanSpeed(result, timestamps, MAX_PAN_SPEED);
  return limited.map((x) => Math.round(clamp(x)));
}

/** Generate FFmpeg sendcmd file for dynamic crop */
async function writeSendcmdFile(
  frames: FrameData[],
  cropXPositions: number[],
  cmdPath: string
): Promise<void> {
  const lines: string[] = [];
  for (let i = 0; i < frames.length; i++) {
    const t = frames[i].time.toFixed(3);
    const x = cropXPositions[i];
    lines.push(`${t} crop x ${x};`);
  }
  await writeFile(cmdPath, lines.join('\n'));
}

/**
 * Generate a vertical (9:16, 1080x1920) version of the input video.
 * Uses MediaPipe face detection to track the active speaker and pan the crop accordingly.
 */
export async function generateVerticalClip(
  inputPath: string,
  outputPath: string
): Promise<void> {
  const tmpDir = dirname(inputPath);
  const jsonPath = join(tmpDir, 'face_tracking.json');
  const cmdPath = join(tmpDir, 'sendcmd.txt');

  try {
    // Step 1: Run face tracker Python script
    await run('python3', [SCRIPT_PATH, inputPath, jsonPath]);

    const tracking: TrackingResult = JSON.parse(await readFile(jsonPath, 'utf8'));
    const { width, height, frames, sample_fps } = tracking;

    // Step 2: Calculate crop dimensions for 9:16 from the source video
    // The crop height is the full video height, width = height * 9/16
    const cropHeight = height;
    const cropWidth = Math.round(cropHeight * 9 / 16);

    if (cropWidth >= width) {
      // Video is already narrower than 9:16 (or equal) — just scale, no crop needed
      await run('ffmpeg', [
        '-i', inputPath,
        '-vf', `scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2`,
        '-c:v', 'libx264', '-crf', '26', '-preset', 'fast',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        '-y', outputPath,
      ]);
      return;
    }

    if (frames.length === 0) {
      // No frames analyzed — use center crop
      await run('ffmpeg', [
        '-i', inputPath,
        '-vf', `crop=${cropWidth}:${cropHeight}:(iw-${cropWidth})/2:0,scale=1080:1920`,
        '-c:v', 'libx264', '-crf', '26', '-preset', 'fast',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        '-y', outputPath,
      ]);
      return;
    }

    // Step 3: Compute smooth crop X trajectory
    const cropXPositions = computeCropX(frames, width, cropWidth, sample_fps);

    // Step 4: Write sendcmd file
    await writeSendcmdFile(frames, cropXPositions, cmdPath);

    // Step 5: Apply dynamic crop with FFmpeg sendcmd
    await run('ffmpeg', [
      '-i', inputPath,
      '-vf', [
        `sendcmd=f=${cmdPath}`,
        `crop=${cropWidth}:${cropHeight}`,
        `scale=1080:1920`,
      ].join(','),
      '-c:v', 'libx264', '-crf', '26', '-preset', 'fast',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      '-y', outputPath,
    ]);

  } finally {
    unlink(jsonPath).catch(() => {});
    unlink(cmdPath).catch(() => {});
  }
}
