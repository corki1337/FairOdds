const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const lastCall = new Map<string, number>();

/**
 * GET JSON with a per-host minimum spacing and backoff on 429/5xx. Returns null instead of
 * throwing so a provider outage reads as an abstention, not a crash.
 */
export async function getJson<T>(
  url: string,
  opts: { headers?: Record<string, string>; paceMs?: number; retries?: number } = {}
): Promise<T | null> {
  const host = new URL(url).host;
  const pace = opts.paceMs ?? 1_000;
  for (let attempt = 0; ; attempt++) {
    const wait = (lastCall.get(host) ?? 0) + pace - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall.set(host, Date.now());
    let res: Response;
    try {
      res = await fetch(url, { headers: opts.headers, signal: AbortSignal.timeout(20_000) });
    } catch (e) {
      if (attempt >= (opts.retries ?? 2)) {
        console.warn(`${host}: ${String((e as Error).message ?? e)}`);
        return null;
      }
      await sleep(2_000 * (attempt + 1));
      continue;
    }
    if (res.ok) return (await res.json()) as T;
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= (opts.retries ?? 2)) {
      console.warn(`${host}${new URL(url).pathname}: HTTP ${res.status}`);
      return null;
    }
    await sleep(5_000 * (attempt + 1));
  }
}
