// Small HTTP helpers shared by the API handlers (`app.ts`, `workspaces.ts`).

import type { IncomingMessage, ServerResponse } from 'node:http';
import { Buffer } from 'node:buffer';

/** Uploads beyond this are rejected outright (scaffold guard, not a quota). */
const MAX_BODY_BYTES = 25 * 1024 * 1024;

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(data);
}

/**
 * PRD 007 Req 8: the raw request body. Pasted-image uploads are bytes, not
 * text, so the binary endpoints read them without a utf8 round trip.
 */
export function readBodyBytes(req: IncomingMessage): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    req.on('data', (chunk: Uint8Array) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    req.on('data', (chunk: Uint8Array) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * decodeURIComponent, or null on a malformed percent-escape. Request paths
 * are attacker-controlled, and a bare decodeURIComponent throws on e.g.
 * `/%zz` — uncaught in the synchronous static handler, that took the whole
 * process down.
 */
export function tryDecode(component: string): string | null {
  try {
    return decodeURIComponent(component);
  } catch {
    return null;
  }
}

/** A relative blob path from URL segments; null when malformed or escaping. */
export function cleanRelativePath(raw: string): string | null {
  const segments = raw.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return null;
  return segments.join('/');
}
