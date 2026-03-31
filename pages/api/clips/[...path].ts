import type { NextApiRequest, NextApiResponse } from 'next';
import { readFile } from 'fs/promises';
import { join } from 'path';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const pathSegments = req.query.path as string[];
  if (!pathSegments?.length) return res.status(404).end();

  // Prevent path traversal
  const safePath = pathSegments.map(s => s.replace(/\.\./g, '')).join('/');
  const filePath = join(process.cwd(), 'storage', 'clips', safePath);

  try {
    const buffer = await readFile(filePath);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'public, max-age=345600'); // 4 days
    res.status(200).send(buffer);
  } catch {
    res.status(404).json({ error: 'Clip não encontrado' });
  }
}
