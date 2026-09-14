// PRD 027 Req 9 (issue #367): a deliberately small server-side WebSocket —
// the RFC 6455 handshake, masked client frames (fragmentation, 16- and
// 64-bit lengths), ping/pong and close — in-repo rather than a dependency,
// because the control channel needs text frames over `node:http`'s
// `'upgrade'` event and nothing else. No extension is negotiated (a client
// that offers permessage-deflate simply sends uncompressed), no subprotocol
// is claimed, and nothing here knows the agent bridge: `agentBridgeSocket.ts`
// decides who may connect and what a frame means. PRD 027 Req 14: no vendor
// import, no `Providers`, no log line — a refusal writes one HTTP status to
// the raw socket and ends it.

import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { Buffer } from 'node:buffer';

/** RFC 6455 §1.3: the fixed GUID the accept key is derived with. */
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** A frame or reassembled message larger than this closes the channel (1009). */
const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;

const OP_CONTINUATION = 0x0;
const OP_TEXT = 0x1;
const OP_BINARY = 0x2;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;

/** How long a close handshake waits for the peer before the socket is destroyed. */
const CLOSE_GRACE_MS = 1_000;

export interface WebSocketConnection {
  /** Send one text message; a no-op once the channel is closing or closed. */
  send(text: string): void;
  /** Start the close handshake (default status 1000); idempotent. */
  close(code?: number): void;
  readonly closed: boolean;
}

export interface WebSocketHandlers {
  /** One complete text message (fragments reassembled). Binary messages are dropped. */
  onMessage(text: string): void;
  /** The channel is gone — peer close, error, or our own close completing. Fires once. */
  onClose(): void;
}

/** Is this `'upgrade'` request asking for a WebSocket (RFC 6455 §4.2.1)? */
export function isWebSocketUpgrade(req: IncomingMessage): boolean {
  const upgrade = req.headers.upgrade ?? '';
  const connection = req.headers.connection ?? '';
  return (
    req.method === 'GET' &&
    upgrade.toLowerCase() === 'websocket' &&
    connection
      .toLowerCase()
      .split(',')
      .some((t) => t.trim() === 'upgrade')
  );
}

/**
 * Refuse an upgrade with an ordinary HTTP status on the raw socket — the
 * client sees no `101` and its `WebSocket` errors out. The body is JSON like
 * every other API refusal; `Connection: close` ends the exchange.
 */
export function refuseUpgrade(socket: Duplex, status: number, reason: string, body: unknown): void {
  const payload = JSON.stringify(body);
  const head =
    `HTTP/1.1 ${status} ${reason}\r\n` +
    'Content-Type: application/json; charset=utf-8\r\n' +
    `Content-Length: ${Buffer.byteLength(payload)}\r\n` +
    'Connection: close\r\n\r\n';
  socket.on('error', () => {});
  socket.end(head + payload);
}

/** RFC 6455 §4.2.2: the `Sec-WebSocket-Accept` value for a client key. */
export function acceptKeyFor(key: string): string {
  return createHash('sha1').update(key + WS_GUID).digest('base64');
}

/**
 * Complete the handshake and take over the socket. Answers `null` (after
 * refusing with 400) when the request is not a well-formed WebSocket
 * upgrade: no key, or a version other than 13.
 */
export function acceptWebSocket(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  handlers: WebSocketHandlers,
): WebSocketConnection | null {
  const key = req.headers['sec-websocket-key'];
  const version = req.headers['sec-websocket-version'];
  if (!isWebSocketUpgrade(req) || typeof key !== 'string' || !key || version !== '13') {
    refuseUpgrade(socket, 400, 'Bad Request', { error: 'malformed websocket upgrade' });
    return null;
  }
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${acceptKeyFor(key)}\r\n\r\n`,
  );

  let buffered: Buffer = Buffer.alloc(0);
  const fragments: Buffer[] = [];
  let fragmentOpcode = 0;
  let fragmentBytes = 0;
  let closing = false;
  let closed = false;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;

  const finish = () => {
    if (closed) return;
    closed = true;
    if (closeTimer) clearTimeout(closeTimer);
    socket.destroy();
    handlers.onClose();
  };

  const writeFrame = (opcode: number, payload: Buffer) => {
    if (closed || socket.destroyed) return;
    const length = payload.length;
    let header: Buffer;
    if (length < 126) {
      header = Buffer.from([0x80 | opcode, length]);
    } else if (length < 0x10000) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }
    socket.write(Buffer.concat([header, payload]));
  };

  const sendClose = (code: number) => {
    if (closing) return;
    closing = true;
    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(code, 0);
    writeFrame(OP_CLOSE, payload);
    // The peer echoes the close and ends the TCP stream; if it never does,
    // the grace timer finishes the job.
    closeTimer = setTimeout(finish, CLOSE_GRACE_MS);
  };

  /** One complete (unmasked) frame. */
  const onFrame = (fin: boolean, opcode: number, payload: Buffer) => {
    switch (opcode) {
      case OP_CLOSE: {
        if (!closing) {
          // Echo the peer's status (or 1000 when it sent none), then finish.
          const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1000;
          closing = true;
          const echo = Buffer.alloc(2);
          echo.writeUInt16BE(code, 0);
          writeFrame(OP_CLOSE, echo);
        }
        finish();
        return;
      }
      case OP_PING:
        writeFrame(OP_PONG, payload);
        return;
      case OP_PONG:
        return;
      case OP_TEXT:
      case OP_BINARY:
      case OP_CONTINUATION: {
        if (opcode === OP_CONTINUATION) {
          if (fragmentOpcode === 0) {
            sendClose(1002); // a continuation with nothing to continue
            return;
          }
        } else {
          if (fragmentOpcode !== 0) {
            sendClose(1002); // a new message while one is still fragmented
            return;
          }
          fragmentOpcode = opcode;
        }
        fragmentBytes += payload.length;
        if (fragmentBytes > MAX_MESSAGE_BYTES) {
          sendClose(1009);
          return;
        }
        fragments.push(payload);
        if (!fin) return;
        const message = fragments.length === 1 ? fragments[0] : Buffer.concat(fragments);
        const kind = fragmentOpcode;
        fragments.length = 0;
        fragmentOpcode = 0;
        fragmentBytes = 0;
        if (kind === OP_TEXT) handlers.onMessage(message.toString('utf8'));
        return;
      }
      default:
        sendClose(1002);
    }
  };

  /** Parse every complete frame in `buffered`; leave the remainder. */
  const drain = () => {
    while (!closed) {
      if (buffered.length < 2) return;
      const fin = (buffered[0] & 0x80) !== 0;
      const opcode = buffered[0] & 0x0f;
      const masked = (buffered[1] & 0x80) !== 0;
      let length = buffered[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffered.length < 4) return;
        length = buffered.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffered.length < 10) return;
        const big = buffered.readBigUInt64BE(2);
        if (big > BigInt(MAX_MESSAGE_BYTES)) {
          sendClose(1009);
          return;
        }
        length = Number(big);
        offset = 10;
      }
      // RFC 6455 §5.1: a client frame MUST be masked.
      if (!masked) {
        sendClose(1002);
        return;
      }
      if (buffered.length < offset + 4 + length) return;
      const mask = buffered.subarray(offset, offset + 4);
      const payload: Buffer = Buffer.from(buffered.subarray(offset + 4, offset + 4 + length));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      buffered = buffered.subarray(offset + 4 + length);
      onFrame(fin, opcode, payload);
    }
  };

  socket.on('data', (chunk: Buffer) => {
    if (closed) return;
    buffered = buffered.length === 0 ? chunk : Buffer.concat([buffered, chunk]);
    drain();
  });
  socket.on('error', finish);
  socket.on('close', finish);
  socket.on('end', finish);
  if (head.length > 0) {
    buffered = Buffer.from(head);
    drain();
  }

  return {
    send(text) {
      if (closing || closed) return;
      writeFrame(OP_TEXT, Buffer.from(text, 'utf8'));
    },
    close(code = 1000) {
      if (closed) return;
      sendClose(code);
    },
    get closed() {
      return closed;
    },
  };
}
