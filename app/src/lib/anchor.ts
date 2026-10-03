import { AnchorProvider, Idl, Program } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import { AIchAIN_PROGRAM_ID, YIELD_PARK_PROGRAM_ID } from "./ids";
import aichainIdl from "./idl/aichain.json";
import yieldParkIdl from "./idl/yield_park.json";

export function getConnection(rpcUrl: string) {
  return new Connection(rpcUrl, "confirmed");
}

export function getAichainProgram(provider: AnchorProvider) {
  return new Program(aichainIdl as Idl, provider);
}

export function getYieldParkProgram(provider: AnchorProvider) {
  return new Program(yieldParkIdl as Idl, provider);
}

export function encodeTeamName(name: string): number[] {
  const buf = Buffer.alloc(32);
  Buffer.from(name).copy(buf);
  return Array.from(buf);
}

export function decodeTeamName(bytes: number[] | Uint8Array): string {
  const buf = Buffer.from(bytes);
  return buf.toString("utf8").replace(/\0/g, "").trim();
}

export function marketPda(programId: PublicKey, matchId: bigint | number) {
  const bn = BigInt(matchId);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(bn);
  return PublicKey.findProgramAddressSync([Buffer.from("market"), buf], programId);
}

export function oraclePda(programId: PublicKey, matchId: bigint | number) {
  const bn = BigInt(matchId);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(bn);
  return PublicKey.findProgramAddressSync([Buffer.from("oracle"), buf], programId);
}

export function vaultPda(programId: PublicKey, market: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), market.toBuffer()],
    programId
  );
}

export function receiptPda(programId: PublicKey, market: PublicKey, user: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), market.toBuffer(), user.toBuffer()],
    programId
  );
}

export function globalPda(programId: PublicKey) {
  return PublicKey.findProgramAddressSync([Buffer.from("global")], programId);
}

export function parkPda(programId: PublicKey, mint: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("park"), mint.toBuffer()],
    programId
  );
}

export function positionPda(yieldProgram: PublicKey, park: PublicKey, owner: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), park.toBuffer(), owner.toBuffer()],
    yieldProgram
  );
}

export function parkVaultPda(yieldProgram: PublicKey, park: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("park-vault"), park.toBuffer()],
    yieldProgram
  );
}

export function treasuryPda(programId: PublicKey, global: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("treasury"), global.toBuffer()],
    programId
  );
}

export type MarketStatusKey = "open" | "locked" | "resolved" | "cancelled";

export function statusKey(status: Record<string, unknown>): MarketStatusKey {
  return Object.keys(status)[0] as MarketStatusKey;
}

export function impliedOdds(poolSelected: number, total: number): number {
  if (poolSelected <= 0 || total <= 0) return 0;
  return total / poolSelected;
}

export { AIchAIN_PROGRAM_ID, YIELD_PARK_PROGRAM_ID };
