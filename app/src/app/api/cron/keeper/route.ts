import { NextRequest, NextResponse } from "next/server";
import { AnchorProvider, Idl, Program } from "@coral-xyz/anchor";
import { makeConnection } from "@/lib/rpc";
import aichainIdl from "@/lib/idl/aichain.json";
import { statusKey } from "@/lib/anchor";
import { cancelExpired, lockIx, resolveWithOracle, sendV0 } from "@/lib/cranks";
import { createServerWallet, loadServerKeypair } from "@/lib/serverWallet";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Allows up to 60s execution on Vercel Pro / fluid compute

export async function GET(req: NextRequest) {
  return handleCron(req);
}

export async function POST(req: NextRequest) {
  return handleCron(req);
}

function cleanSecret(val?: string | null): string {
  if (!val) return "";
  let s = val.trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

async function handleCron(req: NextRequest) {
  const actions: {
    matchId: string;
    action: string;
    signature?: string;
    error?: string;
  }[] = [];

  try {
    // 1. Authorization check: Vercel Cron header or secret query parameter
    const configuredSecret = cleanSecret(process.env.CRON_SECRET);
    if (configuredSecret) {
      const authHeader = req.headers.get("authorization");
      const bearerToken = authHeader?.startsWith("Bearer ")
        ? authHeader.slice(7).trim()
        : null;
      const querySecret = cleanSecret(req.nextUrl.searchParams.get("secret"));
      const isAuthorized =
        bearerToken === configuredSecret || querySecret === configuredSecret;
      if (!isAuthorized) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "Unauthorized: Invalid or missing CRON_SECRET. Pass ?secret=<YOUR_SECRET> or Authorization: Bearer <YOUR_SECRET>",
          },
          { status: 401 }
        );
      }
    }

    // 2. Load server keypair
    const keypair = loadServerKeypair();
    if (!keypair) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "KEEPER_PRIVATE_KEY is not configured in environment variables. Provide a base58 string or byte array in Vercel settings.",
        },
        { status: 500 }
      );
    }

    const connection = makeConnection();
    const serverWalletState = createServerWallet(keypair);
    // AnchorProvider requires an object implementing Anchor's Wallet interface
    const anchorWallet = {
      publicKey: keypair.publicKey,
      payer: keypair,
      signTransaction: serverWalletState.signTransaction,
      signAllTransactions: serverWalletState.signAllTransactions,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const provider = new AnchorProvider(connection, anchorWallet as any, {
      commitment: "confirmed",
    });
    const program = new Program(aichainIdl as Idl, provider);

    const now = Math.floor(Date.now() / 1000);
    // 3. Fetch all on-chain markets
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all = await (program.account as any).marketState.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { dataSize: (program.account as any).marketState.size },
    ]);

    for (const { publicKey, account } of all) {
      const matchId = account.matchId.toString();
      const status = statusKey(account.status);
      const startTime = Number(account.startTime);
      const endTime = Number(account.endTime);
      const deadline = Number(account.resolveDeadline);

      if (status === "resolved" || status === "cancelled") {
        continue;
      }

      // Action A: Kickoff passed -> Lock market into yield_park
      if (status === "open" && now >= startTime && now < endTime) {
        try {
          const ix = await lockIx(program, keypair.publicKey, publicKey);
          const sig = await sendV0(connection, serverWalletState, [ix]);
          actions.push({ matchId, action: "locked", signature: sig });
        } catch (err) {
          actions.push({
            matchId,
            action: "lock_failed",
            error: err instanceof Error ? err.message : String(err),
          });
        }
        continue;
      }

      // Action B: Deadline passed without resolution -> Cancel and refund
      if (now >= deadline) {
        try {
          const sig = await cancelExpired(program, connection, serverWalletState, publicKey);
          actions.push({ matchId, action: "cancelled_expired", signature: sig });
        } catch (err) {
          actions.push({
            matchId,
            action: "cancel_expired_failed",
            error: err instanceof Error ? err.message : String(err),
          });
        }
        continue;
      }

      // Action C: Match finished -> Pull Switchboard oracle update & resolve
      if (now >= endTime && now < deadline) {
        try {
          const sig = await resolveWithOracle(
            program,
            connection,
            serverWalletState,
            { publicKey, account }
          );
          actions.push({ matchId, action: "resolved", signature: sig });
        } catch (err) {
          actions.push({
            matchId,
            action: "resolve_failed",
            error: err instanceof Error ? err.message : String(err),
          });
        }
        continue;
      }
    }

    return NextResponse.json({
      ok: true,
      timestamp: now,
      totalMarkets: all.length,
      actionsPerformed: actions.length,
      actions,
    });
  } catch (err) {
    console.error("Cron keeper run failed:", err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        actions,
      },
      { status: 500 }
    );
  }
}
