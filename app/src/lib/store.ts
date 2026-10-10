import * as fs from "fs/promises";
import * as path from "path";
import { randomUUID } from "crypto";
/** Shared durable Redis REST storage in hosting, atomic files for local development. */
export async function redis(command: (string | number)[]) {
  const url = process.env.KV_REST_API_URL,
    token = process.env.KV_REST_API_TOKEN;
  if (!url || !token)
    throw new Error("KV_REST_API_URL and KV_REST_API_TOKEN required");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("Shared store unavailable");
  const body = await response.json();
  if (body.error) throw new Error("Shared store command failed");
  return body.result;
}
export const remoteStore = () => !!process.env.KV_REST_API_URL;
export async function readStore<T>(
  key: string,
  file: string,
  fallback: T,
): Promise<T> {
  if (remoteStore()) {
    const value = await redis(["GET", `fairodds:${key}`]);
    return value ? JSON.parse(value) : fallback;
  }
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw e;
  }
}
export async function writeStore(key: string, file: string, value: unknown) {
  if (remoteStore()) {
    await redis(["SET", `fairodds:${key}`, JSON.stringify(value)]);
    return;
  }
  if (process.env.VERCEL) {
    if (key === "anomalies") {
      try {
        await fs.writeFile(path.join("/tmp", `${key}.json`), JSON.stringify(value));
      } catch {}
      return;
    }
    throw new Error(
      "Configure KV_REST_API_URL and KV_REST_API_TOKEN for catalog updates on Vercel",
    );
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value));
  await fs.rename(tmp, file);
}
export async function withLease<T>(key: string, fn: () => Promise<T>) {
  const value = randomUUID(),
    lock = `fairodds:lease:${key}`;
  if (!remoteStore()) return fn();
  if (!(await redis(["SET", lock, value, "NX", "EX", 120])))
    throw new Error("Keeper already running");
  try {
    return await fn();
  } finally {
    await redis([
      "EVAL",
      "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
      1,
      lock,
      value,
    ]);
  }
}
