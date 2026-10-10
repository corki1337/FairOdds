/** One bounded demo bet. Keep the signing key local; review API transactions before signing. */
import { BorshInstructionCoder, Idl } from "@coral-xyz/anchor";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import idl from "../../app/src/lib/idl/aichain.json";
import { marketPda, vaultPda, receiptPda } from "../../app/src/lib/anchor";
import { parseUSDC } from "../../app/src/lib/money";
import { readFileSync } from "fs";
import { Keypair, Transaction, PublicKey } from "@solana/web3.js";
import { loadEnv } from "../../scripts/sources/env";
import { makeConnection } from "../../app/src/lib/rpc";
import { AIchAIN_PROGRAM_ID } from "../../app/src/lib/ids";
loadEnv();
async function main() {
  const base = process.env.FAIRODDS_URL || "http://localhost:3000";
  const walletFile = process.env.BOT_WALLET_PATH;
  if (!walletFile)
    throw new Error("Set BOT_WALLET_PATH to a local devnet keypair file");
  const wallet = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(walletFile, "utf8"))),
  );
  const get = async (url: string, init?: RequestInit) => {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`API ${r.status}`);
    return r.json();
  };
  const { markets } = await get(`${base}/api/v1/markets?status=open&limit=100`);
  const m = markets.find(
    (m: any) =>
      m.startTime > Math.floor(Date.now() / 1000) + 60 &&
      m.waitingForCounterBets,
  );
  if (!m) {
    console.log("No eligible market; no transaction sent");
    return;
  }
  const side = BigInt(m.poolUnits[0]) <= BigInt(m.poolUnits[1]) ? 0 : 1;
  const amount = process.env.BOT_STAKE || "1"; // Fixed budget, not unlimited balancing.
  const prepared = await get(`${base}/api/v1/markets/${m.id}/bet`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet: wallet.publicKey.toBase58(), side, amount }),
  });
  const tx = Transaction.from(Buffer.from(prepared.transaction, "base64"));
  if (!tx.feePayer?.equals(wallet.publicKey) || tx.signatures.length !== 1)
    throw new Error("Unexpected signer");
  const allowed = [
    new PublicKey(AIchAIN_PROGRAM_ID),
    new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
  ];
  if (
    tx.instructions.length !== 2 ||
    tx.instructions.some((ix) => !allowed.some((p) => p.equals(ix.programId)))
  )
    throw new Error("Unexpected instruction");
  const bet = tx.instructions[1],
    pid = new PublicKey(AIchAIN_PROGRAM_ID),
    market = marketPda(pid, BigInt(m.id))[0];
  const decoded = new BorshInstructionCoder(idl as Idl).decode(bet.data);
  if (
    !bet.programId.equals(pid) ||
    decoded?.name !== "placeBet" ||
    (decoded.data as any).amount.toString() !== parseUSDC(amount).toString() ||
    (decoded.data as any).team !== side
  )
    throw new Error("Unexpected bet terms");
  const ata = getAssociatedTokenAddressSync(
    new PublicKey(m.mint),
    wallet.publicKey,
  );
  const expected = [
    wallet.publicKey,
    market,
    vaultPda(pid, market)[0],
    ata,
    receiptPda(pid, market, wallet.publicKey)[0],
    PublicKey.default,
    TOKEN_PROGRAM_ID,
  ];
  if (
    bet.keys.length !== expected.length ||
    bet.keys.some((k, i) => !k.pubkey.equals(expected[i]))
  )
    throw new Error("Unexpected bet accounts");
  const create = tx.instructions[0];
  if (
    !create.programId.equals(allowed[1]) ||
    create.data.length !== 1 ||
    create.data[0] !== 1 ||
    !create.keys[1]?.pubkey.equals(ata) ||
    !create.keys[2]?.pubkey.equals(wallet.publicKey) ||
    !create.keys[3]?.pubkey.equals(new PublicKey(m.mint))
  )
    throw new Error("Unexpected token account creation");
  if (process.env.BOT_SEND !== "1") {
    console.log(
      `Prepared ${amount} demo-USDC on ${m.id}, side ${side}. Set BOT_SEND=1 after reviewing the API and wallet.`,
    );
    return;
  }
  tx.partialSign(wallet);
  const rpc = makeConnection();
  const signature = await rpc.sendRawTransaction(tx.serialize());
  const result = await rpc.confirmTransaction(
    {
      signature,
      blockhash: prepared.blockhash,
      lastValidBlockHeight: prepared.lastValidBlockHeight,
    },
    "confirmed",
  );
  if (result.value.err) throw new Error(`Transaction failed: ${signature}`);
  console.log(`https://explorer.solana.com/tx/${signature}?cluster=devnet`);
}
main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
