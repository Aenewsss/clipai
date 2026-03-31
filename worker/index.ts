import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { downloadYouTubeAudio } from '../lib/youtube-audio';
import { transcribeAudio } from '../lib/transcription';
import { analyzeTranscript } from '../lib/analyzer';
import { getVideoInfo } from '../lib/youtube';
import { createLLMProvider } from '../lib/providers/llm';
import { createTranscriptionProvider } from '../lib/providers/transcription';

const POLL_INTERVAL_MS = 5000;

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios');
  return createClient(url, key);
}

async function updateJob(supabase: ReturnType<typeof getClient>, id: string, fields: Record<string, unknown>) {
  await supabase.from('jobs').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id);
}

async function processJob(supabase: ReturnType<typeof getClient>, job: any) {
  const { id, url, style, min_duration, max_duration } = job;
  console.log(`[worker] Processing job ${id}: ${url}`);

  try {
    // 1. Get title
    await updateJob(supabase, id, { status: 'processing', step: 'downloading' });
    const info = await getVideoInfo(url);
    const title = info?.title || 'Vídeo sem título';

    // 2. Download + transcribe
    const { buffer, ext } = await downloadYouTubeAudio(url);
    await updateJob(supabase, id, { step: 'transcribing', title });

    const transcriptionProvider = createTranscriptionProvider();
    const transcript = await transcribeAudio(buffer, `audio.${ext}`, transcriptionProvider);
    await updateJob(supabase, id, { step: 'analyzing', transcript });

    // 3. Analyze
    const llm = createLLMProvider();
    const clips = await analyzeTranscript(transcript, title, { minDuration: min_duration, maxDuration: max_duration, style }, llm);
    await updateJob(supabase, id, { status: 'done', step: 'done', clips });

    console.log(`[worker] Job ${id} done — ${clips.length} clips`);
  } catch (err: any) {
    console.error(`[worker] Job ${id} failed:`, err.message);
    await updateJob(supabase, id, { status: 'error', step: 'error', error: err.message });
  }
}

async function poll(supabase: ReturnType<typeof getClient>) {
  const { data: jobs } = await supabase
    .from('jobs')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1);

  if (jobs?.length) {
    await processJob(supabase, jobs[0]);
  }
}

async function main() {
  console.log('[worker] Starting ClipAI worker...');
  const supabase = getClient();

  while (true) {
    try {
      await poll(supabase);
    } catch (err: any) {
      console.error('[worker] Poll error:', err.message);
    }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

main();
