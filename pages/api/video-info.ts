import type { NextApiRequest, NextApiResponse } from 'next';
import { getVideoInfo, extractVideoId } from '@/lib/youtube';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url } = req.query;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL é obrigatória' });
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    return res.status(400).json({ error: 'URL do YouTube inválida' });
  }

  const info = await getVideoInfo(url);
  if (!info) {
    return res.status(404).json({ error: 'Vídeo não encontrado' });
  }

  return res.status(200).json({ ...info, videoId });
}
