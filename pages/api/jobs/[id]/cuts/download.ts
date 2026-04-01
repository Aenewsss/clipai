import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseClient } from '@/lib/supabase';
import archiver from 'archiver';

export const config = { api: { responseLimit: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { id: jobId } = req.query as { id: string };
  const supabase = getSupabaseClient();

  const { data: cuts, error } = await supabase
    .from('cuts')
    .select('id, title, clip_url, status, clip_index')
    .eq('job_id', jobId)
    .eq('status', 'done')
    .order('clip_index', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  if (!cuts?.length) return res.status(404).json({ error: 'Nenhum corte concluído encontrado' });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="clips_${jobId.slice(0, 8)}.zip"`);

  const archive = archiver('zip', { zlib: { level: 0 } });
  archive.pipe(res as any);

  for (const cut of cuts) {
    if (!cut.clip_url) continue;
    try {
      const fileRes = await fetch(cut.clip_url);
      if (!fileRes.ok) continue;

      const filename = `${String(cut.clip_index + 1).padStart(2, '0')}_${cut.title.slice(0, 50).replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_')}.mp4`;
      const buffer = Buffer.from(await fileRes.arrayBuffer());
      archive.append(buffer, { name: filename });
    } catch {
      // skip failed files
    }
  }

  await archive.finalize();
}
