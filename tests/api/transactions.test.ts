import { expect } from "chai";
import { BN, BorshInstructionCoder } from "@coral-xyz/anchor";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  parseUSDC,
  formatUSDC,
  poolOdds,
  quote,
} from "../../app/src/lib/money";
import {
  reader,
  buildMatchBet,
  buildMatchActionBet,
  ApiError,
} from "../../app/src/lib/server/markets";
import { buildSeasonBet } from "../../app/src/lib/server/seasons";
import { crankDecision } from "../../app/src/lib/keeper";
import {
  seasonJobs,
  validateManifest,
  SeasonManifest,
} from "../../app/src/lib/season-jobs";
import {
  pandaScoreDiffJobs,
  scoreDiffJobs,
  jobsForMatch,
  jobCandidatesForMatch,
  feedHashOf,
} from "../../app/src/lib/switchboard";
import { UNMARKETABLE_ID_OFFSET } from "../../app/src/lib/fixtures";
import { OracleJob } from "@switchboard-xyz/common";
const manifest: SeasonManifest = {
  id: "1",
  title: "League 2026",
  kind: 0,
  historicalDemo: false,
  cutoff: 2000000000,
  endTime: 2001000000,
  resolveDeadline: 2001100000,
  leagueSize: 18,
  year: 2026,
  participants: [
    { name: "A", ids: { openligadb: "40", footballData: "5" } },
    { name: "B", ids: { openligadb: "6", footballData: "6" } },
  ],
  sources: [
    { source: "openligadb", league: "bl1" },
    { source: "footballData", league: "BL1" },
  ],
};
describe("exact money", () => {
  it("round trips maximum u64 and rejects invalid input", () => {
    expect(parseUSDC("18446744073709.551615")).to.equal((1n << 64n) - 1n);
    expect(formatUSDC(1234567n)).to.equal("1.234567");
    for (const value of [
      1,
      "0.9",
      "-1",
      "1e3",
      "1.0000001",
      "18446744073709.551616",
      "Infinity",
    ])
      expect(() => parseUSDC(value)).to.throw();
  });
  it("has no odds when either side is empty and deducts only profit fee", () => {
    expect(poolOdds(0n, 100n)).to.deep.equal([null, null]);
    expect(quote(100000000n, 0n, 300000000n, 50)).to.deep.equal({
      gross: 400000000n,
      fee: 1500000n,
      net: 398500000n,
    });
  });
});
describe("unsigned bet builder", () => {
  it("serializes only the requested wallet, side, amount and canonical token accounts", async () => {
    const ctx = reader(),
      user = Keypair.generate().publicKey,
      mint = Keypair.generate().publicKey;
    (ctx.program.account as any).marketState.fetchNullable = async () => ({
      status: { open: {} },
      startTime: new BN(Math.floor(Date.now() / 1000) + 1000),
      usdcMint: mint,
    });
    (ctx.program.account as any).userBetReceipt.fetchNullable = async () =>
      null;
    ctx.connection.getLatestBlockhash = async () => ({
      blockhash: PublicKey.default.toBase58(),
      lastValidBlockHeight: 100,
    });
    const out = await buildMatchBet("10", user.toBase58(), 1, "12.345678", ctx);
    const tx = Transaction.from(Buffer.from(out.transaction, "base64"));
    expect(tx.feePayer!.equals(user)).to.equal(true);
    expect(tx.signatures.every((s) => s.signature === null)).to.equal(true);
    expect(tx.instructions).to.have.length(2);
    const ix = (ctx.program.coder.instruction as BorshInstructionCoder).decode(
      tx.instructions[1].data,
    )!;
    expect(ix.name).to.equal("placeBet");
    expect((ix.data as any).amount.toString()).to.equal("12345678");
    expect((ix.data as any).team).to.equal(1);
    expect(tx.instructions[1].keys[0].pubkey.equals(user)).to.equal(true);
  });
  it("rejects closed markets and changing a receipt side", async () => {
    const ctx = reader(),
      user = Keypair.generate().publicKey,
      mint = Keypair.generate().publicKey;
    (ctx.program.account as any).marketState.fetchNullable = async () => ({
      status: { open: {} },
      startTime: new BN(1),
      usdcMint: mint,
    });
    try {
      await buildMatchBet("10", user.toBase58(), 0, "1", ctx);
      throw new Error("expected rejection");
    } catch (e) {
      expect((e as ApiError).code).to.equal("BETTING_CLOSED");
    }
    (ctx.program.account as any).marketState.fetchNullable = async () => ({
      status: { open: {} },
      startTime: new BN(2000000000),
      usdcMint: mint,
    });
    (ctx.program.account as any).userBetReceipt.fetchNullable = async () => ({
      claimed: false,
      teamSelected: 1,
    });
    try {
      await buildMatchBet("10", user.toBase58(), 0, "1", ctx);
      throw new Error("expected rejection");
    } catch (e) {
      expect((e as ApiError).code).to.equal("RECEIPT_CONFLICT");
    }
  });
});
describe("season jobs", () => {
  it("gates on completed team-games before translating provider ids", () => {
    const jobs = seasonJobs(manifest, 0);
    const j = OracleJob.toObject(jobs[0]);
    expect(j.tasks![1].comparisonTask!.rhsValue).to.equal("612");
    expect(j.tasks![1].comparisonTask!.onFalseValue).to.equal("-1");
    expect(JSON.stringify(j)).to.include("teamInfoId");
  });
  it("does not embed API credentials and rejects ambiguous maps", () => {
    process.env.FOOTBALL_DATA_KEY = "test-secret";
    const text = JSON.stringify(OracleJob.toObject(seasonJobs(manifest, 1)[0]));
    expect(text).to.include("${FOOTBALL_DATA_KEY}");
    expect(text).not.to.include("test-secret");
    expect(() =>
      validateManifest({
        ...manifest,
        sources: [manifest.sources[0], manifest.sources[0]],
      }),
    ).to.throw();
    expect(() =>
      validateManifest({
        ...manifest,
        participants: [manifest.participants[0], manifest.participants[0]],
      }),
    ).to.throw();
    expect(
      JSON.stringify(OracleJob.toObject(pandaScoreDiffJobs("1")[0])),
    ).to.include("${PANDASCORE_TOKEN}");
    delete process.env.FOOTBALL_DATA_KEY;
  });
});
describe("keeper decision", () => {
  const m = {
    status: { open: {} },
    startTime: 10,
    endTime: 20,
    resolveDeadline: 30,
  };
  it("prioritizes timeout, locks before resolve, and leaves final states alone", () => {
    expect(crankDecision(m, 9)).to.equal("wait");
    expect(crankDecision(m, 10)).to.equal("lock");
    expect(crankDecision(m, 30)).to.equal("cancel");
    expect(crankDecision({ ...m, status: { locked: {} } }, 20)).to.equal(
      "resolve",
    );
    expect(crankDecision({ ...m, status: { cancelled: {} } }, 40)).to.equal(
      "final",
    );
  });
});

describe("match oracle finality", () => {
  it("pins final status, opponent identity and credential placeholders", () => {
    const panda = JSON.stringify(
      OracleJob.toObject(pandaScoreDiffJobs("1")[0]),
    );
    expect(panda).to.include("finished");
    expect(panda).to.include("TEAM_A");
    expect(panda).to.include("team_id");
    const jobs = scoreDiffJobs("1");
    expect(JSON.stringify(OracleJob.toObject(jobs[0]))).to.include(
      "strStatus == 'FT'",
    );
    expect(
      feedHashOf(jobsForMatch("1", feedHashOf(jobs))).equals(feedHashOf(jobs)),
    ).to.equal(true);
    const esportId = (BigInt(UNMARKETABLE_ID_OFFSET) + 1n).toString();
    const legacyEsport = jobCandidatesForMatch(esportId)[1];
    expect(
      feedHashOf(
        jobsForMatch(esportId, feedHashOf(legacyEsport)),
      ).equals(feedHashOf(legacyEsport)),
    ).to.equal(true);
    expect(() => jobsForMatch("1", Buffer.alloc(32))).to.throw();
  });
});

describe("unsigned season bet builder", () => {
  const fixture = () => {
    const ctx = reader(),
      user = Keypair.generate().publicKey,
      mint = Keypair.generate().publicKey;
    (ctx.program.account as any).seasonMarket.fetchNullable = async () => ({
      status: { open: {} },
      cutoff: new BN(2000000000),
      usdcMint: mint,
      participants: [{}, {}],
    });
    (ctx.program.account as any).seasonReceipt.fetchNullable = async () => null;
    ctx.connection.getLatestBlockhash = async () => ({
      blockhash: PublicKey.default.toBase58(),
      lastValidBlockHeight: 100,
    });
    return { ctx, user };
  };
  it("builds a wallet-signed season deposit with exact units", async () => {
    const { ctx, user } = fixture();
    const out = await buildSeasonBet("3", user.toBase58(), 1, "7.000001", ctx);
    const tx = Transaction.from(Buffer.from(out.transaction, "base64"));
    expect(tx.signatures.every((s) => s.signature === null)).to.equal(true);
    const decoded = (
      ctx.program.coder.instruction as BorshInstructionCoder
    ).decode(tx.instructions[1].data)!;
    expect(decoded.name).to.equal("placeSeasonBet");
    expect((decoded.data as any).amount.toString()).to.equal("7000001");
    expect((decoded.data as any).selected).to.equal(1);
    expect(tx.feePayer!.equals(user)).to.equal(true);
  });
  it("rejects cutoff, out-of-range participant and receipt changes", async () => {
    const { ctx, user } = fixture();
    try {
      await buildSeasonBet("3", user.toBase58(), 2, "1", ctx);
      throw new Error("expected rejection");
    } catch (e) {
      expect((e as ApiError).code).to.equal("INVALID_SIDE");
    }
    (ctx.program.account as any).seasonReceipt.fetchNullable = async () => ({
      claimed: false,
      selected: 0,
    });
    try {
      await buildSeasonBet("3", user.toBase58(), 1, "1", ctx);
      throw new Error("expected rejection");
    } catch (e) {
      expect((e as ApiError).code).to.equal("RECEIPT_CONFLICT");
    }
    (ctx.program.account as any).seasonMarket.fetchNullable = async () => ({
      status: { open: {} },
      cutoff: new BN(1),
      participants: [{}, {}],
    });
    try {
      await buildSeasonBet("3", user.toBase58(), 0, "1", ctx);
      throw new Error("expected rejection");
    } catch (e) {
      expect((e as ApiError).code).to.equal("BETTING_CLOSED");
    }
  });
});

describe("Action transaction", () => {
  it("preserves the requested stake and sole wallet signer when adding the public memo", async () => {
    const ctx = reader(),
      user = Keypair.generate().publicKey,
      mint = Keypair.generate().publicKey;
    (ctx.program.account as any).marketState.fetchNullable = async () => ({
      status: { open: {} },
      startTime: new BN(2000000000),
      usdcMint: mint,
    });
    (ctx.program.account as any).userBetReceipt.fetchNullable = async () =>
      null;
    ctx.connection.getLatestBlockhash = async () => ({
      blockhash: PublicKey.default.toBase58(),
      lastValidBlockHeight: 100,
    });
    const out = await buildMatchActionBet(
      "10",
      user.toBase58(),
      1,
      "12.345678",
      ctx,
    );
    const tx = Transaction.from(Buffer.from(out.transaction, "base64"));
    expect(tx.instructions).to.have.length(3);
    expect(tx.signatures).to.have.length(1);
    expect(tx.signatures[0].publicKey.equals(user)).to.equal(true);
    expect(tx.signatures[0].signature).to.equal(null);
    const bet = (ctx.program.coder.instruction as BorshInstructionCoder).decode(
      tx.instructions[1].data,
    )!;
    expect(bet.name).to.equal("placeBet");
    expect((bet.data as any).amount.toString()).to.equal("12345678");
    expect((bet.data as any).team).to.equal(1);
    expect(tx.instructions[2].programId.toBase58()).to.equal(
      "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
    );
    expect(tx.instructions[2].data.toString()).to.equal(
      "FairOdds devnet action: match 10",
    );
  });
});
