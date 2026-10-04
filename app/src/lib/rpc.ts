/**
 * Single place that decides which RPC the app and the devnet scripts talk to.
 *
 * The public devnet endpoint rate-limits and drops connections often enough to break a demo,
 * so every request goes through a retrying fetch and can fall back to a second endpoint.
 */
import { Connection, type ConnectionConfig } from "@solana/web3.js";

const DEFAULT_RPC = "https://api.devnet.solana.com";

export function rpcEndpoints(): string[] {
  const primary =
    process.env.NEXT_PUBLIC_RPC_URL || process.env.ANCHOR_PROVIDER_URL || DEFAULT_RPC;
  const fallbacks = (process.env.NEXT_PUBLIC_RPC_FALLBACKS || process.env.RPC_FALLBACKS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set([primary, ...fallbacks, DEFAULT_RPC])];
}

export const RPC_URL = rpcEndpoints()[0];

const MAX_ATTEMPTS = 8;

function retryable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Retries throttled and transient failures, rotating through the configured endpoints.
 * `input` is always the endpoint URL here, because web3.js posts JSON-RPC to the base URL.
 */
export async function retryingFetch(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1]
): Promise<Response> {
  const endpoints = rpcEndpoints();
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const url = typeof input === "string" ? endpoints[attempt % endpoints.length] : input;
    try {
      const res = await fetch(url, init);
      if (!retryable(res.status)) return res;
      lastError = new Error(`RPC ${res.status}`);
    } catch (e) {
      lastError = e;
    }
    await sleep(600 * 2 ** Math.min(attempt, 5));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function makeConnection(url = RPC_URL, config: ConnectionConfig = {}): Connection {
  return new Connection(url, { commitment: "confirmed", fetch: retryingFetch, ...config });
}
