import { spawn } from 'child_process';
import { readFile, unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

interface ClipInput {
  start_time: number;
  end_time: number;
  title: string;
}

interface CutResult {
  title: string;
  filename: string;
  buffer: Buffer;
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
  return title.replace(/[^a-zA-Z0-9À-ÿ\s-]/g, '').replace(/\s+/g, '_').slice(0, 60);
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
