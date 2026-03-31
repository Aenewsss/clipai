import type { NextApiRequest, NextApiResponse } from 'next';
import { getVideoInfo } from '@/lib/youtube';
import { analyzeTranscript } from '@/lib/analyzer';
import { transcribeAudio } from '@/lib/transcription';
import { createLLMProvider } from '@/lib/providers/llm';
import { createTranscriptionProvider } from '@/lib/providers/transcription';
import { downloadYouTubeAudio } from '@/lib/youtube-audio';
import { AnalyzeResponse } from '@/types';

export const config = {
  maxDuration: 300, // 5 min timeout for Vercel Pro
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<AnalyzeResponse | { error: string }>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url, minDuration = 60, maxDuration = 90, style = 'viral' } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL do YouTube é obrigatória' });
  }

  let llm;
  let transcriptionProvider;
  try {
    llm = createLLMProvider();
    transcriptionProvider = createTranscriptionProvider();
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }

  try {
    // 1. Get video info
    const info = await getVideoInfo(url);
    const title = info?.title || 'Vídeo sem título';

    // 2. Download audio and transcribe with Whisper
    const { buffer, ext } = await downloadYouTubeAudio(url);
    const transcript = await transcribeAudio(buffer, `audio.${ext}`, transcriptionProvider);

    if (!transcript || transcript.length === 0) {
      return res.status(400).json({
        error: 'Não foi possível transcrever o áudio do vídeo.'
      });
    }

    // 3. Analyze with configured LLM provider
    const clips = await analyzeTranscript(transcript, title, {
      minDuration,
      maxDuration,
      style,
    }, llm);

    return res.status(200).json({
      jobId: Date.now().toString(36),
      status: 'done',
      title,
      transcript,
      clips,
    });

  } catch (err: any) {
    console.error('Analysis error:', err);
    return res.status(500).json({ 
      error: err.message || 'Erro interno ao processar o vídeo' 
    });
  }
}
