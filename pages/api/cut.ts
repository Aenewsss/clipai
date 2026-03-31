import type { NextApiRequest, NextApiResponse } from 'next';
import { cutClips } from '@/lib/clip-cutter';
import { createStorageProvider } from '@/lib/providers/storage';

export const config = {
  maxDuration: 300,
};

const FOUR_DAYS_MS = 4 * 24 * 60 * 60 * 1000;

interface CutClipInput {
  start_time: number;
  end_time: number;
  title: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url, jobId, clips } = req.body as {
    url: string;
    jobId: string;
    clips: CutClipInput[];
  };

  if (!url || !jobId || !clips?.length) {
    return res.status(400).json({ error: 'url, jobId e clips são obrigatórios' });
  }

  let storage;
  try {
    storage = createStorageProvider();
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }

  // Cleanup old files (>4 days) on each cut request
  storage.cleanup(FOUR_DAYS_MS).catch(() => {});

  try {
    const cutResults = await cutClips(url, clips);

    const saved = await Promise.all(
      cutResults.map(async (clip) => {
        const key = `${jobId}/${clip.filename}`;
        const clipUrl = await storage.upload(key, clip.buffer, 'video/mp4');
        return { title: clip.title, filename: clip.filename, url: clipUrl };
      })
    );

    return res.status(200).json({ clips: saved });
  } catch (err: any) {
    console.error('Cut error:', err);
    return res.status(500).json({ error: err.message || 'Erro ao cortar os clips' });
  }
}
