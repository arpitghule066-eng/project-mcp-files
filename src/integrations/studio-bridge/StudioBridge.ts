import http from "node:http";
import crypto from "node:crypto";

interface BridgeRequest {
  id: string;
  operation: string;
  args: Record<string, unknown>;
  createdAt: number;
}

export class StudioBridge {
  private server: http.Server | null = null;
  private readonly requests = new Map<string, BridgeRequest>();
  private readonly results = new Map<string, unknown>();
  private connected = false;
  private lastSeen = 0;

  constructor(private readonly port: number, private readonly token: string) {}

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.port, "127.0.0.1", () => resolve());
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null;
  }

  async request(operation: string, args: Record<string, unknown>, timeoutMs = 5000): Promise<unknown> {
    if (!this.connected || Date.now() - this.lastSeen > 30000) {
      throw new Error("Studio plugin bridge is disconnected");
    }
    const id = crypto.randomUUID();
    this.requests.set(id, { id, operation, args, createdAt: Date.now() });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.results.has(id)) {
        const result = this.results.get(id);
        this.results.delete(id);
        return result;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    this.requests.delete(id);
    throw new Error("Studio plugin bridge request timed out");
  }

  status(): Record<string, unknown> {
    return { connected: this.connected && Date.now() - this.lastSeen <= 30000, lastSeen: this.lastSeen ? new Date(this.lastSeen).toISOString() : null };
  }

  private authenticate(req: http.IncomingMessage): boolean {
    return req.headers.authorization === `Bearer ${this.token}`;
  }

  private readJson(req: http.IncomingMessage, limit = 1_000_000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let body = "";
      req.on("data", (chunk: Buffer) => {
        body += chunk.toString("utf8");
        if (Buffer.byteLength(body) > limit) reject(new Error("Request body exceeds size limit"));
      });
      req.on("end", () => {
        try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error("Invalid JSON")); }
      });
    });
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    res.setHeader("Content-Type", "application/json");
    if (!this.authenticate(req)) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    try {
      if (req.method === "POST" && req.url === "/plugin/ping") {
        this.connected = true;
        this.lastSeen = Date.now();
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (req.method === "GET" && req.url === "/studio/request") {
        this.connected = true;
        this.lastSeen = Date.now();
        const pending = [...this.requests.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
        res.end(JSON.stringify({ request: pending ?? null }));
        return;
      }
      if (req.method === "POST" && req.url === "/studio/result") {
        const body = await this.readJson(req) as { id?: string; result?: unknown };
        if (!body.id) throw new Error("Result id is required");
        this.results.set(body.id, body.result);
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "Not found" }));
    } catch (error) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Request failed" }));
    }
  }
}
