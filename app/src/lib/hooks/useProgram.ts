"use client";

import { useMemo } from "react";
import { AnchorProvider, Program, Idl } from "@coral-xyz/anchor";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import aichainIdl from "@/lib/idl/aichain.json";
import { AIchAIN_PROGRAM_ID } from "@/lib/ids";

/** Loose account helpers — stub IDL lacks full coder metadata until `anchor build`. */
export type AichainAccounts = {
  marketState: {
    all: () => Promise<Array<{ publicKey: PublicKey; account: any }>>;
    fetch: (key: PublicKey) => Promise<any>;
  };
  userBetReceipt: {
    fetch: (key: PublicKey) => Promise<any>;
  };
  globalConfig: {
    fetch: (key: PublicKey) => Promise<any>;
  };
};

export function useAichainProgram() {
  const { connection } = useConnection();
  const wallet = useWallet();

  return useMemo(() => {
    if (!wallet.publicKey || !wallet.signTransaction) return null;
    const provider = new AnchorProvider(
      connection,
      wallet as unknown as AnchorProvider["wallet"],
      { commitment: "confirmed" }
    );
    const program = new Program(aichainIdl as Idl, provider);
    return program as Program<Idl> & { account: AichainAccounts };
  }, [connection, wallet]);
}

export function useProgramId() {
  return useMemo(() => new PublicKey(AIchAIN_PROGRAM_ID), []);
}
