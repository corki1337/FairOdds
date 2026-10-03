export const AIchAIN_PROGRAM_ID = "CYizbVKeAyuiZUh9RBKhSw9m2o2CzFDxg95yLJWhJvUW";
export const YIELD_PARK_PROGRAM_ID = "H6wcSEryWtp2rmEu56qCi7zXMd6pmrAMH9cKHxDuM4ET";

/** Filled by setup script / env after deploy */
export const DEPLOY = {
  cluster: process.env.NEXT_PUBLIC_CLUSTER || "devnet",
  rpcUrl:
    process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com",
  usdcMint: process.env.NEXT_PUBLIC_USDC_MINT || "",
  globalPda: process.env.NEXT_PUBLIC_GLOBAL_PDA || "",
};
