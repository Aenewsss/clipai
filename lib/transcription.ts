import { spawn } from 'child_process';
import { readFile, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { TranscriptSegment } from '@/types';
import { TranscriptionProvider } from '@/lib/providers/transcription/types';

const CHUNK_SIZE_LIMIT = 24 * 1024 * 1024; // 24MB

async function getAudioDuration(buffer: Buffer): Promise<number> {
  const id = randomBytes(8).toString('hex');
  const tmpPath = join(tmpdir(), `clipai_dur_${id}.mp3`);
  await writeFile(tmpPath, buffer);

  return new Promise<number>((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      tmpPath,
    ]);

    let stdout = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.on('close', (code: number) => {
      unlink(tmpPath).catch(() => {});
      if (code !== 0) reject(new Error('ffprobe falhou ao obter duração'));
      else resolve(parseFloat(stdout.trim()));
    });
  });
}

async function extractChunk(buffer: Buffer, startSec: number, durationSec: number): Promise<Buffer> {
  const id = randomBytes(8).toString('hex');
  const inputPath = join(tmpdir(), `clipai_in_${id}.mp3`);
  const outputPath = join(tmpdir(), `clipai_chunk_${id}.mp3`);
  await writeFile(inputPath, buffer);

  await new Promise<void>((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-ss', String(startSec),
      '-t', String(durationSec),
      '-i', inputPath,
      '-acodec', 'copy',
      '-y',
      outputPath,
    ]);

    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code: number) => {
      unlink(inputPath).catch(() => {});
      if (code !== 0) reject(new Error(`ffmpeg chunk falhou: ${stderr.slice(-200)}`));
      else resolve();
    });
  });

  const chunk = await readFile(outputPath);
  unlink(outputPath).catch(() => {});
  return chunk;
}

async function splitAudioIfNeeded(
  audioBuffer: Buffer,
): Promise<{ buffer: Buffer; offsetSeconds: number }[]> {
  if (audioBuffer.length <= CHUNK_SIZE_LIMIT) {
    return [{ buffer: audioBuffer, offsetSeconds: 0 }];
  }

  const totalDuration = await getAudioDuration(audioBuffer);
  const numChunks = Math.ceil(audioBuffer.length / (20 * 1024 * 1024));
  const chunkDuration = totalDuration / numChunks;

  const chunks: { buffer: Buffer; offsetSeconds: number }[] = [];
  for (let i = 0; i < numChunks; i++) {
    const startSec = i * chunkDuration;
    const buffer = await extractChunk(audioBuffer, startSec, chunkDuration);
    chunks.push({ buffer, offsetSeconds: startSec });
  }

  return chunks;
}

export async function transcribeAudio(
  audioBuffer: Buffer,
  filename: string,
  provider: TranscriptionProvider
): Promise<TranscriptSegment[]> {
  const chunks = await splitAudioIfNeeded(audioBuffer);

  if (chunks.length === 1) {
    return provider.transcribe(chunks[0].buffer, filename);
  }

  console.log(`[transcription] Áudio grande — dividindo em ${chunks.length} partes`);

  const allSegments: TranscriptSegment[] = [];
  for (const chunk of chunks) {
    const segments = await provider.transcribe(chunk.buffer, filename);
    for (const seg of segments) {
      allSegments.push({
        start: seg.start + chunk.offsetSeconds,
        end: seg.end + chunk.offsetSeconds,
        text: seg.text,
      });
    }
  }

  return allSegments;
}

export function segmentsToFullText(segments: TranscriptSegment[]): string {
  return segments.map(s => s.text).join(' ');
}
