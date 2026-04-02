/**
 * Mock ntfy.sh server for testing notify.ts in isolation.
 *
 * Implements the ntfy HTTP API subset used by the gatekeeper:
 *   POST /{topic}     — publish a notification
 *   GET  /{topic}/sse — subscribe to SSE stream
 *
 * Run with: nvm exec npm run test:ntfy
 */

import * as http from 'http';

export interface PublishedMessage {
  topic: string;
  body: string;
  parsed: unknown;
  receivedAt: number;
}

export interface AutoRespondRule {
  listenTopic: string;
  respondToTopic: string;
  responseBody: string;
  delayMs?: number;
}

export class MockNtfyServer {
  private server: http.Server;
  private port = 0;
  private sseClients: Map<string, Set<http.ServerResponse>> = new Map();
  private _published: PublishedMessage[] = [];
  private autoRules: AutoRespondRule[] = [];
  private sseCounter = 0;
  private pendingTimers: ReturnType<typeof setTimeout>[] = [];

  constructor() {
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  get published(): PublishedMessage[] {
    return this._published;
  }

  getPublished(topic: string): PublishedMessage[] {
    return this._published.filter(m => m.topic === topic);
  }

  autoRespond(rule: AutoRespondRule): void {
    this.autoRules.push(rule);
  }

  reset(): void {
    this._published = [];
    this.autoRules = [];
    for (const t of this.pendingTimers) clearTimeout(t);
    this.pendingTimers = [];
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server.address() as { port: number };
        this.port = addr.port;
        resolve();
      });
      this.server.once('error', reject);
    });
  }

  stop(): Promise<void> {
    for (const clients of this.sseClients.values()) {
      for (const res of clients) {
        try { res.end(); } catch { /* ignore */ }
      }
    }
    this.sseClients.clear();
    for (const t of this.pendingTimers) clearTimeout(t);
    this.pendingTimers = [];

    return new Promise((resolve, reject) => {
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url || '/', this.baseUrl);
    const parts = url.pathname.split('/').filter(Boolean);

    if (parts.length === 1 && req.method === 'POST') {
      this.handlePublish(parts[0], req, res);
    } else if (parts.length === 2 && parts[1] === 'sse' && req.method === 'GET') {
      this.handleSSE(parts[0], req, res);
    } else {
      res.writeHead(404).end();
    }
  }

  private handlePublish(topic: string, req: http.IncomingMessage, res: http.ServerResponse): void {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      let parsed: unknown = null;
      try { parsed = JSON.parse(body); } catch { /* not JSON */ }

      this._published.push({ topic, body, parsed, receivedAt: Date.now() });

      // Broadcast to SSE listeners on this topic
      this.broadcast(topic, body);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: String(this.sseCounter++), topic }));

      // Fire auto-respond rules
      for (const rule of this.autoRules) {
        if (rule.listenTopic === topic) {
          const delay = rule.delayMs ?? 100;
          const timer = setTimeout(() => this.internalPost(rule.respondToTopic, rule.responseBody), delay);
          this.pendingTimers.push(timer);
        }
      }
    });
  }

  private handleSSE(topic: string, _req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write('event: open\ndata: {}\n\n');

    if (!this.sseClients.has(topic)) {
      this.sseClients.set(topic, new Set());
    }
    this.sseClients.get(topic)!.add(res);

    res.on('close', () => {
      this.sseClients.get(topic)?.delete(res);
    });
  }

  private broadcast(topic: string, rawBody: string): void {
    const clients = this.sseClients.get(topic);
    if (!clients || clients.size === 0) return;

    const payload = JSON.stringify({
      id: String(this.sseCounter++),
      message: rawBody,
      topic,
    });
    const line = `data: ${payload}\n\n`;
    for (const client of clients) {
      try { client.write(line); } catch { /* disconnected */ }
    }
  }

  /** Simulate a phone button tap by posting internally to a topic. */
  private internalPost(topic: string, body: string): void {
    this._published.push({ topic, body, parsed: null, receivedAt: Date.now() });
    this.broadcast(topic, body);
  }
}
