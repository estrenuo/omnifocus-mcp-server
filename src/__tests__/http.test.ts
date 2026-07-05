/**
 * Unit tests for the Streamable HTTP transport (remote access).
 *
 * These tests spin up the real HTTP server on an ephemeral port and speak
 * JSON-RPC over fetch, verifying auth (Bearer header and path token),
 * session lifecycle, and MCP handshake. The OmniFocus boundary is never hit:
 * only handshake and tools/list are exercised.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { startHttpServer } from '../http.js';
// Side-effect import: registers all tools on the shared server instance
import '../index.js';

const TOKEN = 'test-token-1234567890abcdef';

let httpServer: Server;
let baseUrl: string;

const JSON_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
};

function initializeBody(id = 1) {
  return {
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'http-test-client', version: '1.0.0' },
    },
  };
}

async function initializeSession(url: string, headers: Record<string, string>): Promise<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...JSON_HEADERS, ...headers },
    body: JSON.stringify(initializeBody()),
  });
  expect(res.status).toBe(200);
  const sessionId = res.headers.get('mcp-session-id');
  expect(sessionId).toBeTruthy();
  await res.text();
  return sessionId as string;
}

beforeAll(async () => {
  httpServer = await startHttpServer({ port: 0, host: '127.0.0.1', authToken: TOKEN });
  const address = httpServer.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected a bound TCP address');
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

describe('startHttpServer', () => {
  it('refuses to start without an auth token', async () => {
    await expect(startHttpServer({ port: 0, authToken: '' })).rejects.toThrow(/auth token/i);
  });
});

describe('health endpoint', () => {
  it('responds 200 without auth', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});

describe('authentication', () => {
  it('rejects a request without credentials', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(initializeBody()),
    });
    expect(res.status).toBe(401);
  });

  it('rejects a wrong Bearer token', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, authorization: 'Bearer wrong-token' },
      body: JSON.stringify(initializeBody()),
    });
    expect(res.status).toBe(401);
  });

  it('rejects a wrong path token', async () => {
    const res = await fetch(`${baseUrl}/mcp/wrong-token`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(initializeBody()),
    });
    expect(res.status).toBe(401);
  });

  it('accepts the correct Bearer token', async () => {
    const sessionId = await initializeSession(`${baseUrl}/mcp`, {
      authorization: `Bearer ${TOKEN}`,
    });
    expect(sessionId.length).toBeGreaterThan(0);
  });

  it('accepts the correct path token (for clients that cannot send headers)', async () => {
    const sessionId = await initializeSession(`${baseUrl}/mcp/${TOKEN}`, {});
    expect(sessionId.length).toBeGreaterThan(0);
  });

  it('returns 404 for unknown paths', async () => {
    const res = await fetch(`${baseUrl}/other`, { method: 'POST', headers: JSON_HEADERS });
    expect(res.status).toBe(404);
  });
});

describe('MCP over HTTP', () => {
  it('completes the handshake and lists tools', async () => {
    const url = `${baseUrl}/mcp`;
    const auth = { authorization: `Bearer ${TOKEN}` };

    const initRes = await fetch(url, {
      method: 'POST',
      headers: { ...JSON_HEADERS, ...auth },
      body: JSON.stringify(initializeBody()),
    });
    expect(initRes.status).toBe(200);
    const sessionId = initRes.headers.get('mcp-session-id') as string;
    const initResult = (await initRes.json()) as {
      result: { serverInfo: { name: string } };
    };
    expect(initResult.result.serverInfo.name).toBe('omnifocus-mcp-server');

    const initializedRes = await fetch(url, {
      method: 'POST',
      headers: { ...JSON_HEADERS, ...auth, 'mcp-session-id': sessionId },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    expect(initializedRes.status).toBe(202);

    const listRes = await fetch(url, {
      method: 'POST',
      headers: { ...JSON_HEADERS, ...auth, 'mcp-session-id': sessionId },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    expect(listRes.status).toBe(200);
    const listResult = (await listRes.json()) as {
      result: { tools: Array<{ name: string }> };
    };
    const names = listResult.result.tools.map((t) => t.name);
    expect(names).toContain('omnifocus_list_inbox');
    expect(names).toContain('omnifocus_create_task');
  });

  it('rejects an unknown session id with 404', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        ...JSON_HEADERS,
        authorization: `Bearer ${TOKEN}`,
        'mcp-session-id': 'no-such-session',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list' }),
    });
    expect(res.status).toBe(404);
  });

  it('replaces the active session on a new initialize (single-session semantics)', async () => {
    const url = `${baseUrl}/mcp`;
    const auth = { authorization: `Bearer ${TOKEN}` };

    const sessionA = await initializeSession(url, auth);
    const sessionB = await initializeSession(url, auth);
    expect(sessionB).not.toBe(sessionA);

    // Session A is gone: a spec-compliant client re-initializes on 404.
    const staleRes = await fetch(url, {
      method: 'POST',
      headers: { ...JSON_HEADERS, ...auth, 'mcp-session-id': sessionA },
      body: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/list' }),
    });
    expect(staleRes.status).toBe(404);

    // Session B works.
    const freshRes = await fetch(url, {
      method: 'POST',
      headers: { ...JSON_HEADERS, ...auth, 'mcp-session-id': sessionB },
      body: JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tools/list' }),
    });
    expect(freshRes.status).toBe(200);
  });
});
