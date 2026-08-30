import crypto from "node:crypto";

export const MCP_VERSION = "3.0.0";
export const CLIENT_CONTRACT_VERSION = "2";

export type AuthMode = "none" | "optional-session" | "session" | "trading";
export type ApiSurface = "spot" | "futures";

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  auth?: AuthMode;
  surface?: ApiSurface;
  idempotencyKey?: string;
  tradingAccount?: string;
  headers?: Record<string, string>;
}

export interface PexbotClientOptions {
  apiBase?: string;
  futuresBase?: string;
  apiKey?: string | null;
  sessionToken?: string | null;
  tradingAccount?: string | null;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export class PexbotApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = "PexbotApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function deriveFuturesBase(apiBase: string): string {
  if (/\/api\/v1$/.test(apiBase)) {
    return apiBase.replace(/\/api\/v1$/, "/api/v2/futures");
  }
  return `${apiBase}/api/v2/futures`;
}

function safeErrorMessage(payload: unknown, fallback: string): { message: string; code?: string } {
  if (!payload || typeof payload !== "object") return { message: fallback };
  const record = payload as Record<string, unknown>;
  const message = typeof record.message === "string" ? record.message : fallback;
  const code = typeof record.error === "string" ? record.error : undefined;
  return { message, code };
}

export class PexbotClient {
  readonly apiBase: string;
  readonly futuresBase: string;
  readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly configuredApiKey: string | null;
  private readonly defaultTradingAccount: string | null;
  private runtimeApiKey: string | null = null;
  private sessionToken: string | null;

  constructor(options: PexbotClientOptions = {}) {
    this.apiBase = withoutTrailingSlash(
      options.apiBase ?? process.env.PEXBOT_API_URL ?? "https://pex.bot/api/v1",
    );
    this.futuresBase = withoutTrailingSlash(
      options.futuresBase ??
        process.env.PEXBOT_FUTURES_API_URL ??
        deriveFuturesBase(this.apiBase),
    );
    this.configuredApiKey = options.apiKey ?? process.env.PEXBOT_API_KEY ?? null;
    this.sessionToken = options.sessionToken ?? process.env.PEXBOT_TOKEN ?? null;
    this.defaultTradingAccount =
      options.tradingAccount ?? process.env.PEXBOT_TRADING_ACCOUNT ?? null;
    this.timeoutMs = options.timeoutMs ?? Number(process.env.PEXBOT_TIMEOUT_MS ?? 10_000);
    this.fetchFn = options.fetchFn ?? fetch;
  }

  hasApiKey(): boolean {
    return Boolean(this.configuredApiKey || this.runtimeApiKey);
  }

  hasSession(): boolean {
    return Boolean(this.sessionToken);
  }

  setSessionToken(token: string): void {
    this.sessionToken = token;
  }

  setRuntimeApiKey(key: string): void {
    this.runtimeApiKey = key;
  }

  clearSession(): void {
    this.sessionToken = null;
  }

  async get<T>(path: string, options: Omit<RequestOptions, "method"> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: "GET" });
  }

  async post<T>(path: string, body: unknown, options: Omit<RequestOptions, "method" | "body"> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: "POST", body });
  }

  async put<T>(path: string, body: unknown, options: Omit<RequestOptions, "method" | "body"> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: "PUT", body });
  }

  async delete<T>(path: string, options: Omit<RequestOptions, "method"> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: "DELETE" });
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    if (!path.startsWith("/")) throw new Error("API path must start with '/'");
    const method = options.method ?? "GET";
    const base = options.surface === "futures" ? this.futuresBase : this.apiBase;
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": `pexbot-mcp/${MCP_VERSION}`,
      "X-Pexbot-Client": "mcp",
      "X-Pexbot-Client-Version": MCP_VERSION,
      "X-Pexbot-Client-Contract": CLIENT_CONTRACT_VERSION,
      "X-Pexbot-Client-Build": MCP_VERSION,
      ...options.headers,
    };

    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

    const tradingAccount = options.tradingAccount ?? this.defaultTradingAccount;
    if (tradingAccount) headers["X-Trading-Account"] = tradingAccount;

    const auth = options.auth ?? "none";
    if (auth === "session") {
      if (!this.sessionToken) {
        throw new Error("A user session is required. Set PEXBOT_TOKEN or call the login tool first.");
      }
      headers.Authorization = `Bearer ${this.sessionToken}`;
    } else if (auth === "optional-session") {
      if (this.sessionToken) headers.Authorization = `Bearer ${this.sessionToken}`;
    } else if (auth === "trading") {
      const key = this.configuredApiKey || this.runtimeApiKey;
      if (key) headers["X-API-Key"] = key;
      else if (this.sessionToken) headers.Authorization = `Bearer ${this.sessionToken}`;
      else {
        throw new Error(
          "Trading authentication is required. Set PEXBOT_API_KEY or PEXBOT_TOKEN, or call login/register first.",
        );
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchFn(`${base}${path}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
      const raw = await response.text();
      let payload: unknown = null;
      if (raw) {
        try {
          payload = JSON.parse(raw);
        } catch {
          payload = raw;
        }
      }
      if (!response.ok) {
        const fallback = `PexBot ${method} ${path} failed with HTTP ${response.status}`;
        const info = safeErrorMessage(payload, fallback);
        throw new PexbotApiError(info.message, response.status, info.code, payload);
      }
      return payload as T;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`PexBot ${method} ${path} timed out after ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function encodePath(value: string): string {
  return encodeURIComponent(value);
}

export function queryString(values: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function createAgentRegistrationToken(
  secret: string,
  values: {
    timestamp: string;
    email: string;
    modelName: string;
    macAddress: string;
    hostname: string;
    cpuInfo: string;
    nonce: string;
    solution: string;
  },
): string {
  const binding = [
    values.email.trim().toLowerCase(),
    values.modelName.trim(),
    values.macAddress.trim(),
    values.hostname.trim(),
    values.cpuInfo.trim(),
    values.nonce,
    values.solution,
  ].join("\0");
  const bindingHash = crypto.createHash("sha256").update(binding).digest("hex");
  const message = `v1:${values.timestamp}:${bindingHash}`;
  const signature = crypto.createHmac("sha256", secret).update(message).digest("hex");
  return `${values.timestamp}.${signature}`;
}
