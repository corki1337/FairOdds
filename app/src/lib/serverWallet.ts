import {
  Connection,
  Keypair,
  SendOptions,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import { utils } from "@coral-xyz/anchor";

/**
 * Loads a Keypair from environment variables (JSON array or Base58).
 */
export function loadServerKeypair(): Keypair | null {
  const raw = process.env.KEEPER_PRIVATE_KEY || process.env.CRANK_PRIVATE_KEY;
  if (!raw) return null;

  try {
    let trimmed = raw.trim();
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      trimmed = trimmed.slice(1, -1).trim();
    }
    if (trimmed.startsWith("[")) {
      return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(trimmed)));
    }
    return Keypair.fromSecretKey(utils.bytes.bs58.decode(trimmed));
  } catch (err) {
    console.error("Invalid keeper signer configuration");
    return null;
  }
}

/**
 * Wraps a Keypair in a WalletContextState-compatible interface
 * suitable for backend / serverless transactions (cranks, keeper).
 */
export function createServerWallet(
  keypair: Keypair,
): WalletContextState & { payer: Keypair } {
  return {
    publicKey: keypair.publicKey,
    payer: keypair,
    signTransaction: async <T extends Transaction | VersionedTransaction>(
      tx: T,
    ): Promise<T> => {
      if ("version" in tx) {
        tx.sign([keypair]);
      } else {
        (tx as Transaction).partialSign(keypair);
      }
      return tx;
    },
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(
      txs: T[],
    ): Promise<T[]> => {
      for (const tx of txs) {
        if ("version" in tx) {
          tx.sign([keypair]);
        } else {
          (tx as Transaction).partialSign(keypair);
        }
      }
      return txs;
    },
    connected: true,
    autoConnect: false,
    connecting: false,
    disconnecting: false,
    select: () => {},
    connect: async () => {},
    disconnect: async () => {},
    sendTransaction: async (
      tx: Transaction | VersionedTransaction,
      connection: Connection,
      options?: SendOptions,
    ) => {
      if ("version" in tx) {
        tx.sign([keypair]);
        return await connection.sendTransaction(tx, options);
      } else {
        tx.partialSign(keypair);
        return await connection.sendTransaction(tx, [keypair], options);
      }
    },
    wallet: null,
    wallets: [],
  } as unknown as WalletContextState & { payer: Keypair };
}
