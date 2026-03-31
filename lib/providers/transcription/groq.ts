import Groq from 'groq-sdk';
import { TranscriptSegment } from '@/types';
import { TranscriptionProvider } from './types';

export class GroqProvider implements TranscriptionProvider {
  private client: Groq;

  constructor() {
    this.client = new Groq({ apiKey: process.env.GROQ_API_KEY || '' });
  }

  async transcribe(audioBuffer: Buffer, filename: string): Promise<TranscriptSegment[]> {
    const file = new File([new Uint8Array(audioBuffer)], filename, { type: 'audio/mp4' });

    const response = await this.client.audio.transcriptions.create({
      file,
      model: 'whisper-large-v3-turbo',
      response_format: 'verbose_json',
      language: 'pt',
      timestamp_granularities: ['segment'],
    });

    return (response as any).segments?.map((seg: any) => ({
      start: seg.start,
      end: seg.end,
      text: seg.text.trim(),
    })) || [];
  }
}
