export const AIchAIN_PROGRAM_ID = "4FNHp1MjhJTqZZqQq333qrDBduT9orpF4zMTdXXUT1dg";
export const YIELD_PARK_PROGRAM_ID = "6XUoUhwMgdurDYu47VKEpqAKczbkY36H22xHr9o9DNHS";

/** Wallet that ran setup-devnet / owns GlobalConfig authority */
export const ADMIN_PUBKEY = "4W3PzT8zz2kkKUccegRwFZNCNXL9ZwdwYZJVMzsZqBQo";

/** Filled by setup script / env after deploy. RPC selection lives in lib/rpc.ts. */
export const DEPLOY = {
  cluster: process.env.NEXT_PUBLIC_CLUSTER || "devnet",
  usdcMint: process.env.NEXT_PUBLIC_USDC_MINT || "",
  globalPda: process.env.NEXT_PUBLIC_GLOBAL_PDA || "",
};
