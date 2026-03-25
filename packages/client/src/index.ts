export interface GnanaClientConfig {
  url: string;
  apiKey?: string;
  /** Dynamic token getter — called on every request to supply a fresh JWT */
  getToken?: () => Promise<string | null | undefined> | string | null | undefined;
  /** Maximum number of retries for network errors and 5xx responses (default: 3) */
  maxRetries?: number;
  /** Request timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
}

/** Default retry configuration */
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 30_000;
const BASE_BACKOFF_MS = 1000;

export class GnanaClient {
  protected baseUrl: string;
  private apiKey?: string;
  private getToken?: GnanaClientConfig["getToken"];
  private maxRetries: number;
  private timeoutMs: number;

  readonly agents: AgentsAPI;
  readonly runs: RunsAPI;
  readonly connectors: ConnectorsAPI;
  readonly pipelineVersions: PipelineVersionsAPI;

  constructor(config: GnanaClientConfig) {
    this.baseUrl = config.url.replace(/\/$/, "");
    this.apiKey = config.apiKey;
    this.getToken = config.getToken;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.agents = new AgentsAPI(this);
    this.runs = new RunsAPI(this);
    this.connectors = new ConnectorsAPI(this);
    this.pipelineVersions = new PipelineVersionsAPI(this);
  }

  async fetch(path: string, init?: RequestInit): Promise<Response> {
    // Resolve the bearer token: prefer dynamic token, fall back to static apiKey
    let bearer = this.apiKey;
    if (this.getToken) {
      const dynamicToken = await this.getToken();
      if (dynamicToken) {
        bearer = dynamicToken;
      }
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(bearer && { Authorization: `Bearer ${bearer}` }),
      ...(init?.headers as Record<string, string>),
    };

    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      // Wait with exponential backoff before retrying (skip delay on first attempt)
      if (attempt > 0) {
        const delayMs = BASE_BACKOFF_MS * Math.pow(2, attempt - 1); // 1s, 2s, 4s
        await sleep(delayMs);
      }

      try {
        const response = await fetchWithTimeout(
          `${this.baseUrl}${path}`,
          { ...init, headers },
          this.timeoutMs,
        );

        // Don't retry on 4xx — these are client errors
        if (response.status >= 400 && response.status < 500) {
          const body = await response.text().catch(() => "");
          throw new GnanaError(response.status, body);
        }

        // Retry on 5xx server errors
        if (response.status >= 500) {
          lastError = new GnanaError(response.status, await response.text().catch(() => ""));
          if (attempt < this.maxRetries) continue;
          throw lastError;
        }

        return response;
      } catch (err) {
        // If it's a client error (4xx), don't retry — rethrow immediately
        if (err instanceof GnanaError && err.status >= 400 && err.status < 500) {
          throw err;
        }

        // Network errors and timeouts are retryable
        lastError = err;
        if (attempt >= this.maxRetries) {
          throw lastError;
        }
      }
    }

    // Should never reach here, but satisfy TypeScript
    throw lastError;
  }

  createWebSocket(path: string): WebSocket {
    const wsUrl = this.baseUrl.replace(/^http/, "ws");
    return new WebSocket(`${wsUrl}${path}`);
  }
}

export class GnanaError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`Gnana API error ${status}: ${body}`);
    this.name = "GnanaError";
  }
}

// ---- Internal helpers ----

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps globalThis.fetch with an AbortController-based timeout.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await globalThis.fetch(url, {
      ...init,
      signal: controller.signal,
    });
    return response;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new GnanaError(0, `Request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---- Agents API ----

class AgentsAPI {
  constructor(private client: GnanaClient) {}

  async list(): Promise<unknown[]> {
    const res = await this.client.fetch("/api/agents");
    return res.json() as Promise<unknown[]>;
  }

  async get(id: string): Promise<unknown> {
    const res = await this.client.fetch(`/api/agents/${id}`);
    return res.json();
  }

  async create(data: Record<string, unknown>): Promise<unknown> {
    const res = await this.client.fetch("/api/agents", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return res.json();
  }

  async update(id: string, data: Record<string, unknown>): Promise<unknown> {
    const res = await this.client.fetch(`/api/agents/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    return res.json();
  }

  async delete(id: string): Promise<void> {
    await this.client.fetch(`/api/agents/${id}`, { method: "DELETE" });
  }
}

// ---- Runs API ----

class RunsAPI {
  constructor(private client: GnanaClient) {}

  async list(options?: { limit?: number }): Promise<unknown[]> {
    const params = options?.limit ? `?limit=${options.limit}` : "";
    const res = await this.client.fetch(`/api/runs${params}`);
    return res.json() as Promise<unknown[]>;
  }

  async get(id: string): Promise<unknown> {
    const res = await this.client.fetch(`/api/runs/${id}`);
    return res.json();
  }

  async trigger(data: {
    agentId: string;
    payload?: Record<string, unknown>;
    triggerType?: string;
  }): Promise<unknown> {
    const res = await this.client.fetch("/api/runs", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return res.json();
  }

  async approve(id: string, modifications?: string): Promise<unknown> {
    const res = await this.client.fetch(`/api/runs/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ modifications }),
    });
    return res.json();
  }

  async reject(id: string, options?: { reason?: string }): Promise<unknown> {
    const res = await this.client.fetch(`/api/runs/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason: options?.reason }),
    });
    return res.json();
  }

  async cancel(id: string): Promise<unknown> {
    const res = await this.client.fetch(`/api/runs/${id}/cancel`, {
      method: "POST",
    });
    return res.json();
  }

  async logs(id: string): Promise<unknown[]> {
    const res = await this.client.fetch(`/api/runs/${id}/logs`);
    return res.json() as Promise<unknown[]>;
  }

  subscribe(runId: string, handler: (update: unknown) => void): () => void {
    const ws = this.client.createWebSocket(`/ws/runs/${runId}`);
    ws.onmessage = (event) => {
      try {
        handler(JSON.parse(event.data as string));
      } catch {
        // ignore parse errors
      }
    };
    return () => ws.close();
  }
}

// ---- Pipeline Versions API ----

class PipelineVersionsAPI {
  constructor(private client: GnanaClient) {}

  async list(agentId: string): Promise<unknown[]> {
    const res = await this.client.fetch(`/api/pipeline-versions/${agentId}`);
    return res.json() as Promise<unknown[]>;
  }

  async create(agentId: string, data: Record<string, unknown>): Promise<unknown> {
    const res = await this.client.fetch(`/api/pipeline-versions/${agentId}`, {
      method: "POST",
      body: JSON.stringify(data),
    });
    return res.json();
  }

  async get(agentId: string, versionId: string): Promise<unknown> {
    const res = await this.client.fetch(`/api/pipeline-versions/${agentId}/${versionId}`);
    return res.json();
  }
}

// ---- Connectors API ----

class ConnectorsAPI {
  constructor(private client: GnanaClient) {}

  async list(): Promise<unknown[]> {
    const res = await this.client.fetch("/api/connectors");
    return res.json() as Promise<unknown[]>;
  }

  async get(id: string): Promise<unknown> {
    const res = await this.client.fetch(`/api/connectors/${id}`);
    return res.json();
  }

  async create(data: Record<string, unknown>): Promise<unknown> {
    const res = await this.client.fetch("/api/connectors", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return res.json();
  }

  async delete(id: string): Promise<void> {
    await this.client.fetch(`/api/connectors/${id}`, { method: "DELETE" });
  }

  async tools(id: string): Promise<unknown[]> {
    const res = await this.client.fetch(`/api/connectors/${id}/tools`);
    return res.json() as Promise<unknown[]>;
  }

  async test(id: string): Promise<unknown> {
    const res = await this.client.fetch(`/api/connectors/${id}/test`, {
      method: "POST",
    });
    return res.json();
  }
}
