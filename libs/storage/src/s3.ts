import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { ObjectStore } from './types.js';

/**
 * S3-backed object store for raw ingested payloads.
 *
 * Credentials and region are resolved by the SDK's default provider chain rather than being
 * passed in: on ECS that is the task role, locally it is `AWS_PROFILE` / `AWS_REGION` or a
 * LocalStack endpoint. Nothing here should ever hold a key.
 */
export class S3ObjectStore implements ObjectStore {
  private readonly s3: S3Client;

  constructor(private readonly bucket: string) {
    // `endpoint` is set only for LocalStack. Left undefined in every deployed environment, so
    // the SDK resolves the real regional endpoint.
    const endpoint = process.env['AWS_ENDPOINT_URL'];
    this.s3 = new S3Client(
      endpoint ? { endpoint, forcePathStyle: true } : {},
    );
  }

  async put(key: string, body: string, contentType = 'application/json'): Promise<string> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return `s3://${this.bucket}/${key}`;
  }

  async get(key: string): Promise<string> {
    const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) {
      // A 200 with no body is not something a retry fixes; surface it rather than returning
      // an empty string, which the sentiment worker would score as though it were content.
      throw new Error(`S3 object has no body: s3://${this.bucket}/${key}`);
    }
    return res.Body.transformToString();
  }
}
