import { describe, expect, it } from "vitest";
import { FigmaTransport, chunk, downloadBytes } from "../src/core/http.js";

describe("FigmaTransport retry behavior", () => {
  it("retries 429 and 5xx with backoff, then succeeds", async () => {
    let calls = 0;
    const transport = new FigmaTransport({
      token: "tok",
      fetchImpl: (async () => {
        calls++;
        if (calls <= 2) {
          return new Response("rate limited", { status: 429 });
        }

        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as unknown as typeof fetch,
      maxRetries: 4,
      backoffBaseMs: 5,
    });
    const body = await transport.get<{ ok: boolean }>("files/abc");
    expect(body.ok).toBe(true);
    expect(calls).toBe(3);
  });

  it("fails with RST_HTTP after exhausting retries", async () => {
    const transport = new FigmaTransport({
      token: "tok",
      fetchImpl: (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch,
      maxRetries: 2,
      backoffBaseMs: 5,
    });
    await expect(transport.get("files/abc")).rejects.toThrow(/RST_HTTP/);
  });

  it("treats 404 as non-retryable", async () => {
    const transport = new FigmaTransport({
      token: "tok",
      fetchImpl: (async () => new Response("nf", { status: 404 })) as unknown as typeof fetch,
      maxRetries: 3,
      backoffBaseMs: 5,
    });
    await expect(transport.get("files/abc")).rejects.toThrow(/HTTP 404/);
  });
});

describe("chunk batching", () => {
  it("splits ids into fixed-size batches", () => {
    const ids = Array.from({ length: 7 }, (_, i) => `n${i}`);
    const batches = chunk(ids, 3);
    expect(batches.map((b) => b.length)).toEqual([3, 3, 1]);
  });
});

describe("downloadBytes", () => {
  const pngUrl = "https://cdn.example.com/a.png";

  it("retries 5xx then succeeds", async () => {
    let calls = 0;
    const bytes = await downloadBytes(pngUrl, {
      fetchImpl: (async () => {
        calls++;
        if (calls === 1) return new Response("boom", { status: 502 });
        return new Response(new Uint8Array([1, 2, 3]).buffer as ArrayBuffer, { status: 200 });
      }) as unknown as typeof fetch,
      maxRetries: 2,
      backoffBaseMs: 5,
    });
    expect(new Uint8Array(bytes)).toEqual(new Uint8Array([1, 2, 3]));
    expect(calls).toBe(2);
  });

  it("fails fast on non-retryable status", async () => {
    let calls = 0;
    await expect(
      downloadBytes(pngUrl, {
        fetchImpl: (async () => {
          calls++;
          return new Response("nf", { status: 404 });
        }) as unknown as typeof fetch,
        maxRetries: 3,
        backoffBaseMs: 5,
      }),
    ).rejects.toThrow(/RST_IMAGE_DOWNLOAD/);
    expect(calls).toBe(1);
  });

  it("exhausts retries then throws RST_IMAGE_DOWNLOAD", async () => {
    let calls = 0;
    await expect(
      downloadBytes(pngUrl, {
        fetchImpl: (async () => {
          calls++;
          return new Response("boom", { status: 500 });
        }) as unknown as typeof fetch,
        maxRetries: 2,
        backoffBaseMs: 5,
      }),
    ).rejects.toThrow(/RST_IMAGE_DOWNLOAD/);
    expect(calls).toBe(3);
  });
});
