import { Storage } from '@google-cloud/storage';
import type { ObjectStore } from './types.js';

export class GcsObjectStore implements ObjectStore {
  private readonly storage = new Storage();

  constructor(private readonly bucket: string) {}

  async put(key: string, body: string, contentType = 'application/json'): Promise<string> {
    await this.storage.bucket(this.bucket).file(key).save(body, { contentType });
    return `gs://${this.bucket}/${key}`;
  }

  async get(key: string): Promise<string> {
    const [buf] = await this.storage.bucket(this.bucket).file(key).download();
    return buf.toString('utf8');
  }
}
