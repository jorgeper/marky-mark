// PRD 007 Req 3: the Azure Blob Storage implementation of the storage seam.
// This module is the ONLY place `@azure/storage-blob` is imported (the seam
// grep in the acceptance criteria holds the whole of server/ and src/ to
// that). PRD 007 Req 4: pointed at Azurite's well-known dev endpoint by the
// local-mode config, the same code gets real e2e coverage offline.

import { BlobServiceClient } from '@azure/storage-blob';
import type { ContainerClient } from '@azure/storage-blob';
import { Buffer } from 'node:buffer';
import type { FileStat, StorageProvider, StoredBytes } from '../types.ts';

async function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createBlobStorageProvider(connectionString: string, container: string): StorageProvider {
  const containerClient: ContainerClient =
    BlobServiceClient.fromConnectionString(connectionString).getContainerClient(container);

  return {
    kind: 'azure-blob',
    async init(): Promise<void> {
      await containerClient.createIfNotExists();
    },
    async read(path: string): Promise<{ content: string; etag: string } | null> {
      try {
        const res = await containerClient.getBlockBlobClient(path).download();
        return {
          // readableStreamBody is always set in Node (undefined only in
          // the SDK's browser builds, which expose blobBody instead).
          content: await streamToString(res.readableStreamBody!),
          etag: res.etag ?? '',
        };
      } catch (err) {
        if ((err as { statusCode?: number }).statusCode === 404) return null;
        throw err;
      }
    },
    async write(path: string, content: string): Promise<{ etag: string }> {
      const data = Buffer.from(content, 'utf8');
      const res = await containerClient.getBlockBlobClient(path).upload(data, data.length);
      return { etag: res.etag ?? '' };
    },
    // PRD 007 Req 20: Blob Storage's own If-Match precondition does the work —
    // the check and the write are one atomic request against the service, so
    // two members saving at once cannot both win. 412 (the service's
    // ConditionNotMet) means the blob moved on since the caller's read; 404
    // means it was deleted meanwhile, which is equally "not the blob you
    // read". Both answer null, leaving whatever is stored untouched.
    async writeIfMatch(path: string, content: string, ifMatch: string): Promise<{ etag: string } | null> {
      const data = Buffer.from(content, 'utf8');
      try {
        const res = await containerClient
          .getBlockBlobClient(path)
          .upload(data, data.length, { conditions: { ifMatch } });
        return { etag: res.etag ?? '' };
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 412 || status === 404) return null;
        throw err;
      }
    },
    // PRD 007 Req 8: the byte-level pair — pasted images in, image bytes out.
    async readBytes(path: string): Promise<StoredBytes | null> {
      try {
        const client = containerClient.getBlockBlobClient(path);
        const buffer = await client.downloadToBuffer();
        const props = await client.getProperties();
        return {
          data: new Uint8Array(buffer),
          contentType: props.contentType ?? 'application/octet-stream',
          etag: props.etag ?? '',
        };
      } catch (err) {
        if ((err as { statusCode?: number }).statusCode === 404) return null;
        throw err;
      }
    },
    async writeBytes(path: string, data: Uint8Array, contentType: string): Promise<{ etag: string }> {
      const res = await containerClient
        .getBlockBlobClient(path)
        .upload(data, data.length, { blobHTTPHeaders: { blobContentType: contentType } });
      return { etag: res.etag ?? '' };
    },
    async delete(path: string): Promise<boolean> {
      const res = await containerClient.getBlockBlobClient(path).deleteIfExists();
      return res.succeeded;
    },
    async list(prefix: string): Promise<FileStat[]> {
      const out: FileStat[] = [];
      for await (const blob of containerClient.listBlobsFlat({ prefix })) {
        out.push({
          path: blob.name,
          size: blob.properties.contentLength ?? 0,
          lastModified: blob.properties.lastModified?.toISOString() ?? '',
          etag: blob.properties.etag ?? '',
        });
      }
      return out;
    },
  };
}
