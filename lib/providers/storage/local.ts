import { mkdir, writeFile, readdir, rm, stat } from 'fs/promises';
import { join } from 'path';
import { StorageProvider } from './types';

const STORAGE_DIR = join(process.cwd(), 'storage', 'clips');

export class LocalStorageProvider implements StorageProvider {
  async upload(key: string, buffer: Buffer, _contentType: string): Promise<string> {
    const filePath = join(STORAGE_DIR, key);
    const dir = filePath.substring(0, filePath.lastIndexOf('/'));
    await mkdir(dir, { recursive: true });
    await writeFile(filePath, buffer);
    return `/api/clips/${key}`;
  }

  async cleanup(maxAgeMs: number): Promise<number> {
    let deleted = 0;
    try {
      const jobs = await readdir(STORAGE_DIR);
      const cutoff = Date.now() - maxAgeMs;
      for (const job of jobs) {
        const jobPath = join(STORAGE_DIR, job);
        const info = await stat(jobPath);
        if (info.mtimeMs < cutoff) {
          await rm(jobPath, { recursive: true, force: true });
          deleted++;
        }
      }
    } catch {}
    return deleted;
  }
}
