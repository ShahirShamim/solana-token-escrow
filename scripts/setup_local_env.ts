/**
 * setup_local_env.ts
 *
 * Bootstraps the local Solana Test Validator ledger so the frontend has
 * something to talk to. Run AFTER the validator is up and the program is
 * deployed:
 *
 *   COPYFILE_DISABLE=1 solana-test-validator --reset      # terminal 1
 *   anchor deploy                                         # terminal 2
 *   npx tsx scripts/setup_local_env.ts                    # terminal 2
 *
 * It performs, in order:
 *   1. Airdrops SOL to the local provider (payer) wallet.
 *   2. Creates a dedicated browser/app wallet and airdrops SOL to it
 *      (used by the React UI to sign stake / claim / unstake).
 *   3. Creates Staking_Mint   (6 decimals, authority = payer).
 *   4. Creates Reward_Mint     (6 decimals, authority = Pool PDA so the
 *      program itself can mint rewards during `claim`).
 *   5. Mints 1,000,000 Staking tokens to the app wallet.
 *   6. Creates the app wallet's reward token account (claim destination).
 *   7. Writes app/src/localnet.json (consumed by the frontend) and copies
 *      the freshly-built IDL into app/src/idl/.
 *   8. Prints every generated public key.
 *
 * The pool itself is intentionally NOT initialized here — that is done from
 * the UI ("Initialize Staking Pool" button) so the full instruction set is
 * exercised end-to-end through the dashboard.
 */
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import fs from "fs";
import os from "os";
import path from "path";

const RPC_URL = process.env.ANCHOR_PROVIDER_URL || "http://127.0.0.1:8899";
const WALLET_PATH =
  process.env.ANCHOR_WALLET || path.join(os.homedir(), ".config/solana/id.json");
const PROGRAM_ID = new PublicKey("CrCv1oVV3Ft2S2G1WjtjAyyXwG41YGMvFbYxeLmQ8yx6");

const DECIMALS = 6;
const STAKING_SUPPLY = 1_000_000; // whole tokens minted to the app wallet
const PAYER_AIRDROP_SOL = 1000; // provider/payer wallet
const APP_AIRDROP_SOL = 100; // browser wallet (tx fees + PDA rent)

const REPO_ROOT = process.cwd();
const APP_SRC = path.join(REPO_ROOT, "app", "src");

function loadKeypair(p: string): Keypair {
  const secret = JSON.parse(fs.readFileSync(p, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

async function airdrop(connection: Connection, pubkey: PublicKey, sol: number) {
  // Airdrop in 100-SOL chunks to stay under the faucet's per-request cap.
  let remaining = sol;
  while (remaining > 0) {
    const chunk = Math.min(remaining, 100);
    const sig = await connection.requestAirdrop(pubkey, chunk * LAMPORTS_PER_SOL);
    const latest = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");
    remaining -= chunk;
  }
}

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const payer = loadKeypair(WALLET_PATH);
  console.log("RPC:            ", RPC_URL);
  console.log("Provider wallet:", payer.publicKey.toBase58());

  // 1. Fund the provider/payer wallet.
  if ((await connection.getBalance(payer.publicKey)) < PAYER_AIRDROP_SOL * LAMPORTS_PER_SOL) {
    console.log(`Airdropping ${PAYER_AIRDROP_SOL} SOL to provider wallet...`);
    await airdrop(connection, payer.publicKey, PAYER_AIRDROP_SOL);
  }

  // 2. Dedicated wallet used by the browser UI to sign transactions.
  const appWallet = Keypair.generate();
  console.log("App wallet:     ", appWallet.publicKey.toBase58());
  console.log(`Airdropping ${APP_AIRDROP_SOL} SOL to app wallet...`);
  await airdrop(connection, appWallet.publicKey, APP_AIRDROP_SOL);

  // Pool PDA (seeds = ["pool"]) — deterministic, independent of who initializes.
  const [poolState] = PublicKey.findProgramAddressSync([Buffer.from("pool")], PROGRAM_ID);

  // 3. Staking mint (authority = payer).
  const stakingMint = await createMint(connection, payer, payer.publicKey, null, DECIMALS);
  console.log("Staking mint:   ", stakingMint.toBase58());

  // 4. Reward mint (authority = Pool PDA so `claim` can mint rewards via CPI).
  const rewardMint = await createMint(connection, payer, poolState, null, DECIMALS);
  console.log("Reward mint:    ", rewardMint.toBase58());

  // 5. App wallet staking account + 1,000,000 tokens.
  const appStakingAta = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    stakingMint,
    appWallet.publicKey
  );
  await mintTo(
    connection,
    payer,
    stakingMint,
    appStakingAta.address,
    payer,
    BigInt(STAKING_SUPPLY) * BigInt(10 ** DECIMALS)
  );
  console.log(`Minted ${STAKING_SUPPLY.toLocaleString()} STAKE -> app wallet`);

  // 6. App wallet reward account (claim destination).
  const appRewardAta = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    rewardMint,
    appWallet.publicKey
  );

  const stakingVault = getAssociatedTokenAddressSync(stakingMint, poolState, true);

  // 7. Emit frontend config + copy the IDL.
  const config = {
    rpcUrl: RPC_URL,
    programId: PROGRAM_ID.toBase58(),
    stakingMint: stakingMint.toBase58(),
    rewardMint: rewardMint.toBase58(),
    poolState: poolState.toBase58(),
    stakingVault: stakingVault.toBase58(),
    userStakingAccount: appStakingAta.address.toBase58(),
    userRewardAccount: appRewardAta.address.toBase58(),
    walletSecretKey: Array.from(appWallet.secretKey),
  };

  fs.mkdirSync(APP_SRC, { recursive: true });
  fs.writeFileSync(path.join(APP_SRC, "localnet.json"), JSON.stringify(config, null, 2));

  // Copy the IDL into the frontend. Prefer a fresh build (target/idl) and fall
  // back to the committed canonical copy in idl/.
  const idlCandidates = [
    path.join(REPO_ROOT, "target", "idl", "solana_yield_vibe.json"),
    path.join(REPO_ROOT, "idl", "solana_yield_vibe.json"),
  ];
  const idlSrc = idlCandidates.find((p) => fs.existsSync(p));
  const idlDir = path.join(APP_SRC, "idl");
  fs.mkdirSync(idlDir, { recursive: true });
  if (idlSrc) {
    fs.copyFileSync(idlSrc, path.join(idlDir, "solana_yield_vibe.json"));
  }

  console.log("\n========== LOCAL ENV READY ==========");
  console.log("Program ID:     ", config.programId);
  console.log("Staking Mint:   ", config.stakingMint);
  console.log("Reward Mint:    ", config.rewardMint);
  console.log("Pool State PDA: ", config.poolState);
  console.log("Staking Vault:  ", config.stakingVault);
  console.log("App Wallet:     ", appWallet.publicKey.toBase58());
  console.log("Wrote:           app/src/localnet.json");
  console.log("Copied IDL ->    app/src/idl/solana_yield_vibe.json");
  console.log("=====================================");
  console.log("\nNext: cd app && npm install && npm run dev");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
