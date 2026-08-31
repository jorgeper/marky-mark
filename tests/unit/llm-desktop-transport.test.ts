import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createDesktopLlmTransport,
  LLM_REQUEST_COMMAND,
  MALFORMED_ANSWER_DETAIL,
  type LlmInvoke,
} from '../../src/lib/llmDesktopTransport';
import { runLlmRequest, UNREACHABLE_MESSAGE, type LlmProviderConfig, type LlmRequest } from '../../src/lib/llmSeam';

// PRD 011 Req 12: the desktop transport — the request leaves from the Rust
// shell over IPC, so everything here drives a fake `invoke`. No test performs
// network I/O and no test contacts a provider host.

const KEY = 'sk-SENTINEL-desktop-do-not-leak-0123456789';

const CONFIG: LlmProviderConfig = { kind: 'openai', apiKey: KEY, model: 'gpt-5' };

const ask = (): LlmRequest => ({
  trigger: 'test-connection',
  prompt: 'Say hello.',
  maxOutputTokens: 32,
});

/** A fake `invoke`: it answers one canned value and records what it was handed. */
function fakeInvoke(answer: unknown | (() => Promise<unknown>)) {
  const calls: Array<{ command: string; args: Record<string, unknown> }> = [];
  const invoke: LlmInvoke = (command, args) => {
    calls.push({ command, args });
    return typeof answer === 'function' ? (answer as () => Promise<unknown>)() : Promise.resolve(answer);
  };
  return { invoke, calls };
}

/** The `request` argument the command was handed, as the Rust side sees it. */
function sentRequest(call: { args: Record<string, unknown> }): Record<string, unknown> {
  return call.args.request as Record<string, unknown>;
}

describe('PRD 011 Req 12 — the desktop transport is one IPC call to the Rust shell', () => {
  it('U898: a 200 exchange comes back as an http result, body and lower-cased headers intact', async () => {
    const { invoke, calls } = fakeInvoke({
      status: 200,
      body: '{"ok":true}',
      headers: { 'content-type': 'application/json', 'X-Request-Id': 'abc' },
    });
    const transport = createDesktopLlmTransport(invoke);
    const result = await transport({
      method: 'POST',
      url: 'https://api.openai.com/v1/responses',
      headers: { authorization: `Bearer ${KEY}` },
      body: '{"model":"gpt-5"}',
    });

    expect(result).toEqual({
      kind: 'http',
      response: {
        status: 200,
        body: '{"ok":true}',
        // Whatever casing crossed the boundary, the seam reads lower-cased names.
        headers: { 'content-type': 'application/json', 'x-request-id': 'abc' },
      },
    });
    // The command is named once, and it is handed the request as plain data.
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe(LLM_REQUEST_COMMAND);
    expect(sentRequest(calls[0])).toEqual({
      method: 'POST',
      url: 'https://api.openai.com/v1/responses',
      headers: { authorization: `Bearer ${KEY}` },
      body: '{"model":"gpt-5"}',
    });
  });

  it('U899: a 429 is a status, not an error, and its retry-after survives to the seam', async () => {
    const { invoke } = fakeInvoke({
      status: 429,
      body: '{"error":{"message":"slow down"}}',
      headers: { 'retry-after': '30' },
    });
    const response = await runLlmRequest(createDesktopLlmTransport(invoke), CONFIG, ask());
    expect(response.ok).toBe(false);
    if (response.ok) return;
    expect(response.failure.kind).toBe('rate-limited');
    expect(response.failure.status).toBe(429);
    // PRD 011 Req 10: the hint the provider sent, all the way across IPC.
    expect(response.failure.retryAfterSeconds).toBe(30);
  });

  it('U900: a 401 is classified by the provider adapters as a bad key', async () => {
    const { invoke } = fakeInvoke({
      status: 401,
      body: '{"error":{"message":"Incorrect API key provided"}}',
      headers: {},
    });
    const response = await runLlmRequest(createDesktopLlmTransport(invoke), CONFIG, ask());
    expect(response.ok).toBe(false);
    if (response.ok) return;
    expect(response.failure.kind).toBe('bad-key');
    expect(response.failure.status).toBe(401);
    expect(response.failure.providerMessage).toBe('Incorrect API key provided');
  });

  it('U901: an invoke that rejects reported no exchange — an unreachable host, never a status', async () => {
    const { invoke } = fakeInvoke(() => Promise.reject(new Error('error sending request for url (https://api.openai.com/v1/responses)')));
    const transport = createDesktopLlmTransport(invoke);

    expect(await transport({ method: 'POST', url: 'https://api.openai.com/v1/responses', headers: {}, body: '{}' })).toEqual({
      kind: 'no-response',
      detail: 'error sending request for url (https://api.openai.com/v1/responses)',
    });

    const response = await runLlmRequest(transport, CONFIG, ask());
    expect(response.ok).toBe(false);
    if (response.ok) return;
    expect(response.failure.kind).toBe('unreachable-host');
    expect(response.failure.message).toBe(UNREACHABLE_MESSAGE);
    expect(response.failure.status).toBeUndefined();
  });

  it('U902: a refused input — the command rejecting a non-POST or a file: URL — is unreachable too', async () => {
    // The Rust side validates before sending, and a refusal is its error arm.
    const { invoke } = fakeInvoke(() => Promise.reject("llm_request refuses the 'file' scheme"));
    const result = await createDesktopLlmTransport(invoke)({
      method: 'POST',
      url: 'https://api.openai.com/v1/responses',
      headers: {},
      body: '{}',
    });
    expect(result).toEqual({ kind: 'no-response', detail: "llm_request refuses the 'file' scheme" });
  });

  it('U903: an answer that is not the promised exchange is no exchange, not an invented status', async () => {
    for (const answer of [undefined, null, 'ok', { status: '200', body: '{}' }, { status: 200 }]) {
      const { invoke } = fakeInvoke(answer);
      const result = await createDesktopLlmTransport(invoke)({
        method: 'POST',
        url: 'https://api.openai.com/v1/responses',
        headers: {},
        body: '{}',
      });
      expect(result).toEqual({ kind: 'no-response', detail: MALFORMED_ANSWER_DETAIL });
    }
  });
});

describe('PRD 011 Req 7 — the key crosses to the shell in headers and comes back in nothing', () => {
  it('U904: no string the transport hands back carries the key, even when the provider quotes it', async () => {
    // A careless provider echoing the key straight back at us, over IPC.
    const { invoke, calls } = fakeInvoke({
      status: 401,
      body: `{"error":{"message":"key ${KEY} refused"}}`,
      headers: { 'x-echo': KEY },
    });
    const transport = createDesktopLlmTransport(invoke);
    const response = await runLlmRequest(transport, CONFIG, ask());

    // It travelled one way: in the request headers the command was handed.
    expect(JSON.stringify(sentRequest(calls[0]).headers)).toContain(KEY);
    expect(sentRequest(calls[0]).url).not.toContain(KEY);
    expect(sentRequest(calls[0]).body).not.toContain(KEY);
    // And it is in nothing the seam hands a caller, message or serialized failure.
    expect(JSON.stringify(response)).not.toContain(KEY);
    expect(response.ok).toBe(false);
    if (response.ok) return;
    expect(response.failure.kind).toBe('bad-key');
    expect(response.failure.providerMessage ?? '').not.toContain(KEY);
  });
});

describe('PRD 011 Req 12 — the webview CSP is not widened for the LLM path', () => {
  it('U905: connect-src still allows only IPC, naming no provider origin', () => {
    const conf = JSON.parse(
      readFileSync(fileURLToPath(new URL('../../src-tauri/tauri.conf.json', import.meta.url)), 'utf8'),
    ) as { app: { security: { csp: string } } };
    const directives = conf.app.security.csp.split(';').map((d) => d.trim());
    const connect = directives.find((d) => d.startsWith('connect-src '));
    expect(connect).toBeDefined();
    // The desktop request leaves from the Rust shell, so the webview needs no
    // outbound origin at all: widening this list fails here rather than quietly.
    expect(connect?.split(/\s+/).slice(1)).toEqual(['ipc:', 'http://ipc.localhost']);
  });
});
