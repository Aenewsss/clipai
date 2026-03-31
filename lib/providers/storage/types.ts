export interface StorageProvider {
  upload(key: string, buffer: Buffer, contentType: string): Promise<string>;
  cleanup(maxAgeMs: number): Promise<number>;
}
