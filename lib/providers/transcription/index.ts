import { TranscriptionProvider } from './types';
import { GroqProvider } from './groq';

export function createTranscriptionProvider(): TranscriptionProvider {
  const provider = process.env.TRANSCRIPTION_PROVIDER || 'groq';

  switch (provider) {
    case 'groq':
      return new GroqProvider();
    default:
      throw new Error(`Transcription provider desconhecido: "${provider}". Use "groq".`);
  }
}

export type { TranscriptionProvider };
