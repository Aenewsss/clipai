import { TranscriptSegment } from '@/types';
import { TranscriptionProvider } from '@/lib/providers/transcription/types';

export async function transcribeAudio(
  audioBuffer: Buffer,
  filename: string,
  provider: TranscriptionProvider
): Promise<TranscriptSegment[]> {
  return provider.transcribe(audioBuffer, filename);
}

export function segmentsToFullText(segments: TranscriptSegment[]): string {
  return segments.map(s => s.text).join(' ');
}
