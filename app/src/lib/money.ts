export const USDC_SCALE = 1_000_000n;
const U64_MAX = (1n << 64n) - 1n;
export function parseUSDC(value: unknown): bigint {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value))
    throw new Error("Amount must be a decimal string with at most 6 decimals");
  const [whole, fraction = ""] = value.split(".");
  const units = BigInt(whole) * USDC_SCALE + BigInt(fraction.padEnd(6, "0"));
  if (units < USDC_SCALE || units > U64_MAX)
    throw new Error("Amount must be at least 1 USDC and fit u64");
  return units;
}
export function formatUSDC(units: bigint | string): string {
  const n = BigInt(units);
  return `${n / USDC_SCALE}.${(n % USDC_SCALE).toString().padStart(6, "0")}`;
}
/** Human-facing amount; APIs keep the exact 6-decimal formatUSDC string. */
export function displayUSDC(units: bigint | string): string {
  return (Number(BigInt(units)) / 1e6).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
}
export function poolOdds(a: bigint, b: bigint): [number | null, number | null] {
  if (a <= 0n || b <= 0n) return [null, null];
  return [
    Number(((a + b) * 10000n) / a) / 10000,
    Number(((a + b) * 10000n) / b) / 10000,
  ];
}
export function quote(
  stake: bigint,
  selected: bigint,
  opposite: bigint,
  feeBps = 0,
) {
  const gross = (stake * (selected + opposite + stake)) / (selected + stake);
  const profit = gross > stake ? gross - stake : 0n;
  const fee = (profit * BigInt(feeBps)) / 10000n;
  return { gross, fee, net: gross - fee };
}
