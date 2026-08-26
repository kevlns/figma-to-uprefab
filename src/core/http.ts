/**
 * Figma REST transport with:
 *   - per-request timeout (AbortController)
 *   - bounded retry on HTTP 429 / 5xx with exponential backoff + jitter
 *   - fixture injection so tests exercise deterministic discovery / node docs
 *     without network
 *   - never logs the token (callers must pass a Redactor)
 */

import { CliError } from "./errors.js";

export interface FigmaTransportOptions {
  token: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  /** Inject a fetch-like implementation for tests. */
  fetchImpl?: typeof fetch;
  /** Optional logging hook receiving method + path (never the token). */
  onRequest?: (method: string, path: string, attempt: number) => void;
  /** Backoff base in ms; default 250. */
  backoffBaseMs?: number;
}

export interface FigmaHttpResponse<T> {
  status: number;
  headers: Headers;
  body: T;
}

const DEFAULT_BASE_URL = "https://api.figma.com/v1";

export class FigmaTransport {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly onRequest?: (method: string, path: string, attempt: number) => void;
  private readonly backoffBaseMs: number;

  constructor(options: FigmaTransportOptions) {
    this.token = options.token;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.maxRetries = options.maxRetries ?? 4;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.onRequest = options.onRequest;
    this.backoffBaseMs = options.backoffBaseMs ?? 250;
  }

  async get<T>(path: string): Promise<T> {
    const url = path.startsWith("http") ? path : `${this.baseUrl}/${path.replace(/^\/+/, "")}`;
    let attempt = 0;
    // A small cache of statuses per attempt for tests.
    for (;;) {
      attempt++;
      this.onRequest?.("GET", path, attempt);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: "GET",
          headers: { "X-Figma-Token": this.token, Accept: "application/json" },
          signal: controller.signal,
        });
      } catch (error) {
        clearTimeout(timer);
        const reason = error instanceof Error ? error.message : String(error);
        if (attempt <= this.maxRetries) {
          await this.sleepWithJitter(attempt);
          continue;
        }

        throw new CliError("RST_NETWORK", `Figma request failed after ${attempt} attempt(s): ${reason}`);
      }
      clearTimeout(timer);

      const status = response.status;
      if (status >= 200 && status < 300) {
        return (await response.json()) as T;
      }

      if (this.isRetryable(status) && attempt <= this.maxRetries) {
        await this.sleepWithJitter(attempt);
        continue;
      }

      const bodyText = await response.text().catch(() => "");
      throw new CliError(
        "RST_HTTP",
        `Figma API returned HTTP ${status} for ${path}.`,
        1,
        bodyText.length > 200 ? `${bodyText.slice(0, 200)}...` : bodyText,
      );
    }
  }

  private isRetryable(status: number): boolean {
    return status === 429 || (status >= 500 && status <= 599);
  }

  private async sleepWithJitter(attempt: number): Promise<void> {
    const base = this.backoffBaseMs * 2 ** (attempt - 1);
    const jitter = Math.random() * base * 0.3;
    await new Promise((resolve) => setTimeout(resolve, base + jitter));
  }
}

/** Chunk an array into batches of at most `size`. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size) as T[]);
  }

  return out;
}

/** Download a raw byte payload (PNG) with timeout; returns an ArrayBuffer. */
export async function downloadBytes(
  url: string,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch; maxRetries?: number; backoffBaseMs?: number } = {},
): Promise<ArrayBuffer> {
  const timeoutMs = options.timeoutMs ?? 60000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxRetries = options.maxRetries ?? 4;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { signal: controller.signal });
      if (response.ok) return await response.arrayBuffer();
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === maxRetries) {
        throw new CliError("RST_IMAGE_DOWNLOAD", `Failed to download image: HTTP ${response.status} for ${url.slice(0, 80)}...`);
      }
    } catch (error) {
      if (error instanceof CliError || attempt === maxRetries) throw error;
    } finally {
      clearTimeout(timer);
    }
    const delay = (options.backoffBaseMs ?? 250) * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new CliError("RST_IMAGE_DOWNLOAD", `Failed to download image: ${url.slice(0, 80)}...`);
}
