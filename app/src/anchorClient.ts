import * as anchor from '@coral-xyz/anchor'
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js'
import { localnet, idl } from './config'

/**
 * Minimal browser wallet that signs with an in-memory keypair.
 * `anchor.Wallet` (NodeWallet) is not part of Anchor's browser bundle because
 * it reads keypair files, so we implement the wallet interface ourselves.
 */
class LocalWallet {
  readonly payer: Keypair

  constructor(payer: Keypair) {
    this.payer = payer
  }

  get publicKey(): PublicKey {
    return this.payer.publicKey
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    if (tx instanceof VersionedTransaction) tx.sign([this.payer])
    else tx.partialSign(this.payer)
    return tx
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
    txs.forEach((tx) => {
      if (tx instanceof VersionedTransaction) tx.sign([this.payer])
      else tx.partialSign(this.payer)
    })
    return txs
  }
}

export interface StakingClient {
  connection: Connection
  provider: anchor.AnchorProvider
  // Loosely typed (generic Idl) — methods/accounts are resolved at runtime.
  program: anchor.Program
  walletPubkey: PublicKey
  programId: PublicKey
  stakingMint: PublicKey
  rewardMint: PublicKey
  poolState: PublicKey
  stakingVault: PublicKey
  userState: PublicKey
  userStakingAccount: PublicKey
  userRewardAccount: PublicKey
}

/**
 * Builds an Anchor client bound to the local validator using the keypair and
 * addresses produced by `scripts/setup_local_env.ts`. Returns null when that
 * config hasn't been generated yet.
 */
export function createStakingClient(): StakingClient | null {
  if (!localnet || !idl) return null

  const connection = new Connection(localnet.rpcUrl, 'confirmed')
  const keypair = Keypair.fromSecretKey(Uint8Array.from(localnet.walletSecretKey))
  const wallet = new LocalWallet(keypair)
  const provider = new anchor.AnchorProvider(connection, wallet as anchor.Wallet, {
    commitment: 'confirmed',
  })
  const program = new anchor.Program(idl, provider)

  const programId = new PublicKey(localnet.programId)
  const poolState = new PublicKey(localnet.poolState)

  const [userState] = PublicKey.findProgramAddressSync(
    [Buffer.from('user_state'), poolState.toBuffer(), keypair.publicKey.toBuffer()],
    programId
  )

  return {
    connection,
    provider,
    program,
    walletPubkey: keypair.publicKey,
    programId,
    stakingMint: new PublicKey(localnet.stakingMint),
    rewardMint: new PublicKey(localnet.rewardMint),
    poolState,
    stakingVault: new PublicKey(localnet.stakingVault),
    userState,
    userStakingAccount: new PublicKey(localnet.userStakingAccount),
    userRewardAccount: new PublicKey(localnet.userRewardAccount),
  }
}
