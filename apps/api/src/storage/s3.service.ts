import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { storageConfig } from '../config/namespaces';

export interface ObjectHead {
  size: number;
  contentType: string | undefined;
  etag: string | undefined;
}

export interface PresignedUrl {
  url: string;
  expiresAt: Date;
}

/**
 * Object storage, always through presigned URLs.
 *
 * **Every GET and HEAD a browser performs goes through a presigned URL.** This is in
 * CLAUDE.md in bold and it is not a style preference: SigV4 request signing puts the
 * signature in an `Authorization` header over a canonical set of headers, and
 * Cloudflare rewrites headers in transit, so a header-signed request that is valid
 * when it leaves the browser is invalid when MinIO sees it. A presigned URL carries
 * the signature in the query string, which nothing along the path touches.
 *
 * Bytes never pass through this process. Uploads are a presigned PUT straight from the
 * browser to storage and downloads are a presigned GET; Node only ever issues the URL
 * and verifies afterwards that the object is what was declared.
 */
@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);

  /** Server-side operations: HEAD, DELETE. Uses the internal endpoint. */
  private readonly client: S3Client;

  /**
   * Signs the URLs the browser will use. Separate because the signature covers the
   * Host header: signing `http://minio:9000` produces URLs that fail with
   * SignatureDoesNotMatch the moment a browser resolves the public name instead.
   */
  private readonly presigner: S3Client;

  constructor(
    @Inject(storageConfig.KEY) private readonly config: ConfigType<typeof storageConfig>,
  ) {
    this.client = this.createClient(config.endpoint);
    this.presigner =
      config.publicEndpoint === config.endpoint
        ? this.client
        : this.createClient(config.publicEndpoint);
  }

  private createClient(endpoint: string): S3Client {
    return new S3Client({
      endpoint,
      region: this.config.region,
      forcePathStyle: this.config.forcePathStyle,
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      },
      /**
       * Recent AWS SDK releases add `x-amz-sdk-checksum-algorithm` and a CRC32 trailer
       * to PutObject by default. On a presigned URL that header becomes part of the
       * signature, so the browser — which knows nothing about it — sends a request
       * that does not match and MinIO answers 403. Requesting checksums only when the
       * operation requires them keeps the signed header set to what a browser can
       * actually reproduce.
       */
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  get bucket(): string {
    return this.config.bucket;
  }

  /**
   * A URL the browser PUTs the bytes to.
   *
   * `contentType` is signed, so the client must send exactly that header — a client
   * that declares `image/png` cannot then upload with `text/html`. The content LENGTH
   * is deliberately not signed: browsers set it themselves and a mismatch would fail
   * as an opaque 403. Size is verified against the stored object at commit instead,
   * which is the check that cannot be talked out of.
   */
  async presignPut(key: string, contentType: string): Promise<PresignedUrl> {
    const expiresIn = this.config.presignExpiresSeconds;
    const url = await getSignedUrl(
      this.presigner,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn },
    );
    return { url, expiresAt: new Date(Date.now() + expiresIn * 1_000) };
  }

  /**
   * A URL the browser GETs the bytes from.
   *
   * `fileName` sets Content-Disposition so the download is saved under the name the
   * user gave it rather than the UUID-prefixed key. It is quoted and stripped of
   * quotes and control characters: the value ends up in a response header, and an
   * unescaped one is a header-injection primitive.
   */
  async presignGet(key: string, fileName?: string): Promise<PresignedUrl> {
    const expiresIn = this.config.presignExpiresSeconds;
    const safeName = fileName?.replace(/["\\\r\n]/g, '').slice(0, 200);

    const url = await getSignedUrl(
      this.presigner,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(safeName ? { ResponseContentDisposition: `attachment; filename="${safeName}"` } : {}),
      }),
      { expiresIn },
    );
    return { url, expiresAt: new Date(Date.now() + expiresIn * 1_000) };
  }

  /** What storage actually holds at that key, or undefined when nothing does. */
  async head(key: string): Promise<ObjectHead | undefined> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        size: result.ContentLength ?? 0,
        contentType: result.ContentType,
        // Quotes are part of the HTTP ETag syntax, not part of the value.
        etag: result.ETag?.replace(/"/g, ''),
      };
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /**
   * Best-effort bulk delete for the janitor. Failures are logged, not thrown: one
   * unreachable object must not stop the sweep, and the row stays behind to be retried
   * on the next run.
   */
  async deleteMany(keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return;

    // DeleteObjects caps at 1000 keys per call.
    for (let index = 0; index < keys.length; index += 1_000) {
      const batch = keys.slice(index, index + 1_000);
      try {
        const result = await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
          }),
        );
        for (const failure of result.Errors ?? []) {
          this.logger.warn(`failed to delete ${failure.Key}: ${failure.Code} ${failure.Message}`);
        }
      } catch (error) {
        this.logger.warn(`bulk delete of ${batch.length} objects failed: ${String(error)}`);
      }
    }
  }
}

function isNotFound(error: unknown): boolean {
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    candidate?.name === 'NotFound' ||
    candidate?.name === 'NoSuchKey' ||
    candidate?.$metadata?.httpStatusCode === 404
  );
}
