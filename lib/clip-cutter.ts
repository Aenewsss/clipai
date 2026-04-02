import { spawn } from 'child_process';
import { readFile, unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { generateVerticalClip } from './vertical-crop';

interface ClipInput {
  start_time: number;
  end_time: number;
  title: string;
}

interface CutResult {
  title: string;
  filename: string;
  buffer: Buffer;
  verticalBuffer?: Buffer;
  verticalFilename?: string;
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code: number) => {
      if (code !== 0) reject(new Error(stderr.slice(-500)));
      else resolve();
    });
  });
}

function sanitizeFilename(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 60);
}

// Downloads only the specific time range and encodes it — used by the worker queue
export async function downloadAndCutClip(
  url: string,
  clip: ClipInput,
  index: number
): Promise<CutResult> {
  const id = randomBytes(6).toString('hex');
  const tmpDir = join(tmpdir(), `clipai_${id}`);
  await mkdir(tmpDir, { recursive: true });

  const filename = `${String(index + 1).padStart(2, '0')}_${sanitizeFilename(clip.title)}.mp4`;
  const rawPath = join(tmpDir, 'raw.mp4');
  const outputPath = join(tmpDir, filename);

  // Download only the needed section
  await run('python3', [
    '-m', 'yt_dlp',
    '--download-sections', `*${clip.start_time}-${clip.end_time}`,
    '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
    '--merge-output-format', 'mp4',
    '--no-playlist',
    (process.env.YTDLP_COOKIES_FILE ? '--cookies' : '--extractor-args'), (process.env.YTDLP_COOKIES_FILE ?? 'youtube:player_client=web_creator'),
    '-o', rawPath,
    url,
  ]);

  // Re-encode for compatibility and size (cap 720p, CRF 28)
  await run('ffmpeg', [
    '-i', rawPath,
    '-c:v', 'libx264', '-crf', '28', '-preset', 'fast',
    '-vf', "scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease",
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    '-y', outputPath,
  ]);

  const buffer = await readFile(outputPath);

  // Generate vertical (9:16) version for Reels/Shorts/TikTok
  const verticalFilename = `vertical_${filename}`;
  const verticalPath = join(tmpDir, verticalFilename);
  let verticalBuffer: Buffer | undefined;
  try {
    await generateVerticalClip(outputPath, verticalPath);
    verticalBuffer = await readFile(verticalPath);
    unlink(verticalPath).catch(() => {});
  } catch (err: any) {
    console.error(`[clip-cutter] Vertical generation failed: ${err.message}`);
  }

  unlink(rawPath).catch(() => {});
  unlink(outputPath).catch(() => {});

  return { title: clip.title, filename, buffer, verticalBuffer, verticalFilename };
}

export async function cutClips(url: string, clips: ClipInput[]): Promise<CutResult[]> {
  const id = randomBytes(6).toString('hex');
  const tmpDir = join(tmpdir(), `clipai_${id}`);
  await mkdir(tmpDir, { recursive: true });

  const videoPath = join(tmpDir, 'video.mp4');

  // Download full video
  await run('python3', [
    '-m', 'yt_dlp',
    '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
    '--merge-output-format', 'mp4',
    '--no-playlist',
    (process.env.YTDLP_COOKIES_FILE ? '--cookies' : '--extractor-args'), (process.env.YTDLP_COOKIES_FILE ?? 'youtube:player_client=web_creator'),
    '-o', videoPath,
    url,
  ]);

  const results: CutResult[] = [];

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const filename = `${String(i + 1).padStart(2, '0')}_${sanitizeFilename(clip.title)}.mp4`;
    const outputPath = join(tmpDir, filename);

    await run('ffmpeg', [
      '-i', videoPath,
      '-ss', String(clip.start_time),
      '-to', String(clip.end_time),
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-movflags', '+faststart',
      '-y',
      outputPath,
    ]);

    const buffer = await readFile(outputPath);
    results.push({ title: clip.title, filename, buffer });
    unlink(outputPath).catch(() => {});
  }

  // Cleanup original video
  unlink(videoPath).catch(() => {});

  return results;
}
