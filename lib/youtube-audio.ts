import { spawn } from 'child_process';
import { readFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

export async function downloadYouTubeAudio(url: string): Promise<{ buffer: Buffer; ext: string }> {
  const id = randomBytes(8).toString('hex');
  const outputTemplate = join(tmpdir(), `clipai_${id}.%(ext)s`);
  const outputPath = join(tmpdir(), `clipai_${id}.mp3`);

  await new Promise<void>((resolve, reject) => {
    const proc = spawn('python3', [
      '-m', 'yt_dlp',
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '5',
      '--no-playlist',
      '--extractor-args', 'youtube:player_client=ios',
      '-o', outputTemplate,
      url,
    ]);

    let stderr = '';
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
    proc.on('close', (code: number) => {
      if (code !== 0) reject(new Error(`Falha ao baixar áudio: ${stderr.slice(-300)}`));
      else resolve();
    });
  });

  const buffer = await readFile(outputPath);
  unlink(outputPath).catch(() => {});
  return { buffer, ext: 'mp3' };
}
