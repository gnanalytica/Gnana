export interface GnanaClientConfig {
  url: string;
  apiKey?: string;
}

export class GnanaClient {
  private baseUrl: string;
  private apiKey?: string;

  readonly agents: AgentsAPI;
  readonly runs: RunsAPI;
  readonly connectors: ConnectorsAPI;

  constructor(config: GnanaClientConfig) {
    this.baseUrl = config.url.replace(/\/$/, "");
    this.apiKey = config.apiKey;
    this.agents = new AgentsAPI(this);
    this.runs = new RunsAPI(this);
    this.connectors = new ConnectorsAPI(this);
  }

  async fetch(path: string, init?: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(this.apiKey && { Authorization: `Bearer ${this.apiKey}` }),
      ...(init?.headers as Record<string, string>),
    };

    const response = await globalThis.fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new GnanaError(response.status, body);
    }

    return response;
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
