# Solana Yield Vibe — On-Chain Staking Simulator

A fully on-chain token staking simulator running against a local Solana Test
Validator. An [Anchor](https://www.anchor-lang.com/) program implements the
staking pool; a React + Vite + TypeScript dashboard talks to it directly through
`@coral-xyz/anchor` and `@solana/web3.js`. No mocks — every stake, claim, and
unstake is a real transaction signed and confirmed on the local ledger.

```
┌──────────────┐   web3.js / Anchor   ┌──────────────────────┐
│  React app   │ ───────────────────▶ │ solana-test-validator │
│  (app/:5173) │                       │      (:8899)         │
└──────────────┘                       │  solana_yield_vibe    │
                                       │  (Anchor program)     │
                                       └──────────────────────┘
```

---

## What it does

| Instruction        | Effect                                                                 |
| ------------------ | ---------------------------------------------------------------------- |
| `initialize_pool`  | Creates the `PoolState` PDA + staking vault (ATA owned by the pool).    |
| `stake`            | Transfers STAKE tokens user → vault; accrues pending yield first.       |
| `claim`            | Mints accrued REWARD tokens to the user; resets the accumulator.        |
| `unstake`          | Accrues yield, then transfers STAKE tokens vault → user.                |

**Yield formula** (computed from the on-chain Clock, overflow-checked):

```
yield = staked_balance × reward_rate × (now − last_stake_ts) / 1_000_000
```

State is held in two PDAs: `PoolState` (seeds `["pool"]`) and `UserState`
(seeds `["user_state", pool, user]`). The reward mint's authority is the
`PoolState` PDA, so the program itself signs the reward `mint_to` CPI.

---

## Prerequisites

Verified working with:

| Tool        | Version           |
| ----------- | ----------------- |
| Solana CLI  | 1.18.17 (Agave)   |
| Anchor CLI  | 0.30.1            |
| Rust        | 1.96.0 (host)     |
| Node        | 26.x              |

> **macOS note.** Always prefix validator/test commands with
> `COPYFILE_DISABLE=1`. macOS injects AppleDouble (`._*`) metadata into the
> genesis archive, and the validator's ledger unpacker rejects it with
> `Archive error: extra entry found: "._genesis.bin"`. Setting
> `COPYFILE_DISABLE=1` stops `tar` from creating those entries and the validator
> starts cleanly — no Linux VM required.

Install JS deps once:

```bash
npm install            # repo root (tests + scripts)
cd app && npm install  # frontend
```

---

## Quick start

Open two terminals from the repo root.

**Terminal 1 — local validator with the program loaded:**

```bash
COPYFILE_DISABLE=1 solana-test-validator --reset \
  --bpf-program CrCv1oVV3Ft2S2G1WjtjAyyXwG41YGMvFbYxeLmQ8yx6 \
  target/deploy/solana_yield_vibe.so
```

**Terminal 2 — seed the ledger, then run the dashboard:**

```bash
npm run setup          # airdrop SOL, create mints, mint 1,000,000 STAKE, write app config
cd app && npm run dev  # http://localhost:5173
```

In the browser:

1. **Initialize Staking Pool** (sets the reward rate).
2. **Stake** STAKE tokens and watch unclaimed yield tick up in real time.
3. **Claim** reward tokens, or **Unstake** your principal at any time.

`npm run setup` (→ `scripts/setup_local_env.ts`) writes `app/src/localnet.json`
(RPC URL, program ID, mint addresses, and a throwaway browser wallet keypair)
and copies the IDL into `app/src/idl/`. Both are gitignored and regenerated each
run. Restart the validator with `--reset` before re-running setup.

---

## Running the on-chain tests

The Mocha suite exercises the full lifecycle (Initialize → Stake → wait → Claim
→ Unstake) against a validator that Anchor spins up automatically:

```bash
COPYFILE_DISABLE=1 anchor test --skip-build
```

From a clean checkout (empty `target/`), build the program and seed the IDL
first:

```bash
COPYFILE_DISABLE=1 anchor build --no-idl   # compiles target/deploy/*.so
npm run idl:sync                            # idl/ → target/idl + target/types
COPYFILE_DISABLE=1 anchor test --skip-build
```

---

## Building the program

```bash
COPYFILE_DISABLE=1 anchor build --no-idl
```

The `--no-idl` flag is required: Anchor 0.30.1's IDL generator calls
`proc_macro2::Span::source_file()`, a nightly API that was removed from modern
`rustc`, so the IDL build step fails on this toolchain. The program binary itself
compiles fine. A correct, hand-verified IDL (and its TypeScript types) is checked
in under [`idl/`](./idl) and is the single source of truth used by both the tests
and the frontend; `npm run idl:sync` copies it into `target/`. Upgrading to
Anchor ≥ 0.31 would restore native IDL generation.

---

## Project structure

```
programs/solana-yield-vibe/src/lib.rs   Anchor program (state, instructions, yield math)
tests/solana-yield-vibe.ts              Mocha integration test (full user flow)
scripts/setup_local_env.ts              Local ledger bootstrap (airdrop, mints, config)
idl/                                    Canonical IDL + TS types (checked in)
app/                                    React + Vite + Tailwind dashboard
  src/anchorClient.ts                   Connection + provider + program + local wallet
  src/config.ts                         Loads generated localnet.json / IDL
  src/App.tsx                           PoolMetrics, UserDashboard, ActionPanel
Anchor.toml                             Localnet config + test runner
```

---

## Toolchain fixes applied

This project targets a current macOS + Node 26 environment, which required three
fixes beyond the original scaffold:

1. **Validator on macOS** — `COPYFILE_DISABLE=1` avoids the AppleDouble
   `._genesis.bin` ledger-unpack failure (see note above).
2. **Test runner on Node 26** — the original `ts-mocha` + `mocha@9` + `yargs@16`
   stack throws `require is not defined in ES module scope` on Node 26. Replaced
   with `mocha@11` + [`tsx`](https://tsx.is) (`Anchor.toml` `[scripts] test`).
3. **IDL generation** — incompatible with `rustc` 1.96 (see "Building the
   program"); the IDL is maintained in `idl/` and synced into `target/`.

The frontend uses a local in-memory wallet keypair (generated by the setup
script) to sign transactions. To target Phantom/Solflare on devnet instead, swap
`src/anchorClient.ts`'s `LocalWallet` for `@solana/wallet-adapter-react` and point
the RPC URL at your cluster.
