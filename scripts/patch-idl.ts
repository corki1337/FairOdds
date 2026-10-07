/**
 * Keeps app/src/lib/idl/aichain.json in sync with the program.
 *
 * `anchor build` needs an elevated agave-install on this machine, so the IDL entries for
 * instructions added after the last successful anchor build are written here instead.
 * Discriminators are derived the same way Anchor derives them.
 */
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";

const IDL = path.join(__dirname, "..", "app", "src", "lib", "idl", "aichain.json");

const disc = (namespace: string, name: string) =>
  Array.from(createHash("sha256").update(`${namespace}:${name}`).digest().subarray(0, 8));

type Idl = {
  instructions: { name: string; discriminator: number[]; accounts: unknown[]; args: unknown[] }[];
  accounts: { name: string; discriminator: number[] }[];
  errors: { code: number; name: string; msg: string }[];
  types: { name: string; type: unknown }[];
};

const idl = JSON.parse(fs.readFileSync(IDL, "utf8")) as Idl;

const instructions = [
  {
    name: "withdraw_treasury",
    accounts: [
      { name: "authority", signer: true },
      { name: "global" },
      { name: "treasury", writable: true },
      { name: "destination", writable: true },
      { name: "token_program" },
    ],
    args: [{ name: "amount", type: "u64" }],
  },
  {
    name: "faucet_mint",
    accounts: [
      { name: "user", writable: true, signer: true },
      { name: "global" },
      { name: "usdc_mint", writable: true },
      { name: "mint_authority" },
      { name: "receipt", writable: true },
      { name: "user_ata", writable: true },
      { name: "system_program" },
      { name: "token_program" },
      { name: "associated_token_program" },
    ],
    args: [],
  },
  {
    name: "attach_secondary_feed",
    accounts: [
      { name: "authority", writable: true, signer: true },
      { name: "global" },
      { name: "market" },
      { name: "secondary", writable: true },
      { name: "secondary_feed" },
      { name: "feed_lock" },
      { name: "system_program" },
    ],
    args: [
      { name: "source", type: "u8" },
      { name: "source_ref", type: "u64" },
    ],
  },
];

for (const ix of instructions) {
  idl.instructions = idl.instructions.filter((x) => x.name !== ix.name);
  idl.instructions.push({ ...ix, discriminator: disc("global", ix.name) });
}

type IdlAccountMeta = { name: string; writable?: boolean; signer?: boolean; optional?: boolean };
const resolve = idl.instructions.find((x) => x.name === "resolve_market")!;
const resolveAccounts = (resolve.accounts as IdlAccountMeta[]).filter(
  (a) => a.name !== "secondary" && a.name !== "secondary_feed"
);
resolveAccounts.splice(
  resolveAccounts.findIndex((a) => a.name === "feed_lock") + 1,
  0,
  { name: "secondary" },
  { name: "secondary_feed", optional: true }
);
resolve.accounts = resolveAccounts;

const structs: { name: string; fields: { name: string; type: unknown }[] }[] = [
  {
    name: "FaucetReceipt",
    fields: [
      { name: "user", type: "pubkey" },
      { name: "last_claim", type: "i64" },
      { name: "bump", type: "u8" },
    ],
  },
  {
    name: "SecondaryOracle",
    fields: [
      { name: "market", type: "pubkey" },
      { name: "feed", type: "pubkey" },
      { name: "feed_hash", type: { array: ["u8", 32] } },
      { name: "source", type: "u8" },
      { name: "source_ref", type: "u64" },
      { name: "bump", type: "u8" },
    ],
  },
];
for (const s of structs) {
  idl.accounts = idl.accounts.filter((a) => a.name !== s.name);
  idl.accounts.push({ name: s.name, discriminator: disc("account", s.name) });
  idl.types = idl.types.filter((t) => t.name !== s.name);
  idl.types.push({ name: s.name, type: { kind: "struct", fields: s.fields } });
}

const errors = [
  { code: 6034, name: "FaucetCooldown", msg: "Faucet already used within the last 24h" },
  { code: 6035, name: "InvalidMint", msg: "Token account has the wrong mint" },
  { code: 6036, name: "InsufficientTreasury", msg: "Amount exceeds treasury balance" },
  { code: 6037, name: "UnknownSource", msg: "Unknown secondary result source" },
  {
    code: 6038,
    name: "MarketHasBets",
    msg: "Secondary feed can only be attached before any bet and before kickoff",
  },
  {
    code: 6039,
    name: "SecondaryFeedDuplicate",
    msg: "Secondary feed must differ from the primary feed and job",
  },
  {
    code: 6040,
    name: "SecondaryFeedMismatch",
    msg: "Secondary feed missing or not the one pinned for this market",
  },
  {
    code: 6041,
    name: "SourcesDisagree",
    msg: "Primary and secondary sources report different results",
  },
];
for (const e of errors) {
  idl.errors = idl.errors.filter((x) => x.code !== e.code);
  idl.errors.push(e);
}
idl.errors.sort((a, b) => a.code - b.code);

fs.writeFileSync(IDL, `${JSON.stringify(idl, null, 2)}\n`);
console.log(
  `idl: ${idl.instructions.length} instructions, ${idl.accounts.length} accounts, ${idl.errors.length} errors`
);
