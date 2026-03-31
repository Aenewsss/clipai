import { TranscriptSegment } from '@/types';

export interface TranscriptionProvider {
  transcribe(audioBuffer: Buffer, filename: string): Promise<TranscriptSegment[]>;
}
