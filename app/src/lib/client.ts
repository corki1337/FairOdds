import { Transaction } from "@solana/web3.js";
import type { Connection } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";
export async function preparedBet(
  connection: Connection,
  wallet: WalletContextState,
  url: string,
  payload: unknown,
) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok)
    throw new Error(data.error?.message ?? "Could not prepare transaction");
  if (!wallet.signTransaction) throw new Error("Connect wallet");
  const tx = await wallet.signTransaction(
    Transaction.from(Buffer.from(data.transaction, "base64")),
  );
  const signature = await connection.sendRawTransaction(tx.serialize());
  const result = await connection.confirmTransaction(
    {
      signature,
      blockhash: data.blockhash,
      lastValidBlockHeight: data.lastValidBlockHeight,
    },
    "confirmed",
  );
  if (result.value.err) throw new Error("Transaction failed");
  return signature;
}
export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const d = await res.json();
  if (!res.ok) throw new Error(d.error?.message ?? "Network unavailable");
  return d;
}
