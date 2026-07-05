/**
 * Streamable HTTP transport for remote access (issue #24).
 *
 * Exposes the MCP server over HTTP so remote clients — most importantly
 * claude.ai custom connectors (used by the Claude iOS app) — can reach
 * OmniFocus. The server binds to localhost by default; expose it publicly
 * through a tunnel (e.g. Cloudflare Tunnel), never by opening ports.
 *
 * Auth: a shared secret, accepted either as `Authorization: Bearer <token>`
 * or as a path token (`/mcp/<token>`). The path form exists because claude.ai
 * custom connectors cannot send custom headers.
 *
 * Sessions: single active session. Each MCP tool call is stateless (one JXA
 * round trip), so a new `initialize` simply replaces the previous session;
 * spec-compliant clients whose session was replaced get 404 and re-initialize.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { server } from "./server.js";

export interface HttpServerOptions {
  port: number;
  host?: string;
  authToken: string;
}

const MAX_BODY_BYTES = 4 * 1024 * 1024;

function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB);
}

function isAuthorized(req: IncomingMessage, pathToken: string | null, authToken: string): boolean {
  const header = req.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ") && safeEqual(header.slice(7), authToken)) {
    return true;
  }
  return pathToken !== null && safeEqual(pathToken, authToken);
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown, extraHeaders?: Record<string, string>): void {
  res.writeHead(status, { "content-type": "application/json", ...extraHeaders });
  res.end(JSON.stringify(body));
}

function jsonRpcError(code: number, message: string) {
  return { jsonrpc: "2.0", error: { code, message }, id: null };
}

export async function startHttpServer(options: HttpServerOptions): Promise<Server> {
  const { port, host = "127.0.0.1", authToken } = options;

  if (!authToken) {
    throw new Error(
      "An auth token is required for the HTTP transport (set MCP_AUTH_TOKEN). " +
      "Refusing to expose OmniFocus without authentication."
    );
  }

  let transport: StreamableHTTPServerTransport | null = null;

  const httpServer = createServer(async (req, res) => {
    let rpcMethod: string | undefined;
    res.on("finish", () => {
      const redactedPath = url ? url.pathname.replace(/^\/mcp\/[^/]+/, "/mcp/:token") : req.url;
      console.error(
        `${new Date().toISOString()} ${req.method} ${redactedPath}${rpcMethod ? ` [${rpcMethod}]` : ""} → ${res.statusCode}`
      );
    });
    let url: URL | undefined;
    try {
      url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const segments = url.pathname.split("/").filter(Boolean);

      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, { status: "ok" });
        return;
      }

      if (segments[0] !== "mcp" || segments.length > 2) {
        sendJson(res, 404, jsonRpcError(-32000, "Not found"));
        return;
      }

      const pathToken = segments.length === 2 ? decodeURIComponent(segments[1]) : null;
      if (!isAuthorized(req, pathToken, authToken)) {
        sendJson(res, 401, jsonRpcError(-32001, "Unauthorized"), { "www-authenticate": "Bearer" });
        return;
      }

      let body: unknown;
      if (req.method === "POST") {
        try {
          body = await readJsonBody(req);
        } catch (error) {
          sendJson(res, 400, jsonRpcError(-32700, error instanceof Error ? error.message : "Parse error"));
          return;
        }
        if (body !== null && typeof body === "object" && "method" in body) {
          rpcMethod = String((body as { method: unknown }).method);
        }
      }

      if (req.method === "POST" && isInitializeRequest(body)) {
        // Single active session: a new initialize replaces the previous one.
        if (transport) {
          await transport.close();
        }
        const newTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
          onsessionclosed: () => {
            if (transport === newTransport) {
              transport = null;
            }
          },
        });
        transport = newTransport;
        await server.connect(newTransport);
      }

      if (!transport) {
        sendJson(res, 400, jsonRpcError(-32000, "No active session: send an initialize request first"));
        return;
      }

      await transport.handleRequest(req, res, body);
    } catch (error) {
      console.error("HTTP transport error:", error);
      if (!res.headersSent) {
        sendJson(res, 500, jsonRpcError(-32603, "Internal server error"));
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => resolve());
  });

  const address = httpServer.address();
  const actualPort = address !== null && typeof address === "object" ? address.port : port;
  console.error(`OmniFocus MCP Server listening on http://${host}:${actualPort}/mcp`);

  return httpServer;
}
