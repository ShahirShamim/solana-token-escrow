import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SolanaYieldVibe } from "../target/types/solana_yield_vibe";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID, 
  createMint, 
  mintTo, 
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync
} from "@solana/spl-token";
import { expect } from "chai";

describe("solana-yield-vibe", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SolanaYieldVibe as Program<SolanaYieldVibe>;

  const payer = (provider.wallet as anchor.Wallet).payer;

  let stakingMint: PublicKey;
  let rewardMint: PublicKey;
  let poolState: PublicKey;
  let stakingVault: PublicKey;
  let userState: PublicKey;
  let userStakingAccount: PublicKey;
  let userRewardAccount: PublicKey;

  const user = Keypair.generate();
  const rewardRate = new anchor.BN(100_000); // 0.1 tokens per staked token per second (scaled by 1e6)
  const stakeAmount = new anchor.BN(1000_000_000); // 1000 tokens (decimals = 6)

  before(async () => {
    // Airdrop SOL to the user
    const signature = await provider.connection.requestAirdrop(user.publicKey, 2_000_000_000);
    await provider.connection.confirmTransaction(signature);

    // Derive PoolState PDA
    const [poolStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool")],
      program.programId
    );
    poolState = poolStatePda;

    // Create Staking Mint
    stakingMint = await createMint(
      provider.connection,
      payer,
      payer.publicKey,
      null,
      6
    );

    // Create Reward Mint with PoolState PDA as the mint authority
    rewardMint = await createMint(
      provider.connection,
      payer,
      poolState, // authority
      null,
      6
    );

    // Derive staking vault ATA of poolState PDA
    stakingVault = getAssociatedTokenAddressSync(
      stakingMint,
      poolState,
      true
    );

    // Derive UserState PDA
    const [userStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_state"), poolState.toBuffer(), user.publicKey.toBuffer()],
      program.programId
    );
    userState = userStatePda;

    // Create User Staking ATA & Mint tokens to user
    const userStakingAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      stakingMint,
      user.publicKey
    );
    userStakingAccount = userStakingAta.address;

    await mintTo(
      provider.connection,
      payer,
      stakingMint,
      userStakingAccount,
      payer,
      10000_000_000 // 10,000 tokens
    );

    // Create User Reward ATA
    const userRewardAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      rewardMint,
      user.publicKey
    );
    userRewardAccount = userRewardAta.address;
  });

  it("Initializes the pool state and staking vault", async () => {
    await program.methods
      .initializePool(rewardRate)
      .accounts({
        admin: payer.publicKey,
        stakingMint: stakingMint,
        rewardMint: rewardMint,
        poolState: poolState,
        stakingVault: stakingVault,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();

    // Fetch and assert PoolState account fields
    const state = await program.account.poolState.fetch(poolState);
    expect(state.admin.toString()).to.equal(payer.publicKey.toString());
    expect(state.stakingMint.toString()).to.equal(stakingMint.toString());
    expect(state.rewardMint.toString()).to.equal(rewardMint.toString());
    expect(state.stakingVault.toString()).to.equal(stakingVault.toString());
    expect(state.rewardRate.toString()).to.equal(rewardRate.toString());
  });

  it("Stakes tokens into the pool", async () => {
    await program.methods
      .stake(stakeAmount)
      .accounts({
        user: user.publicKey,
        poolState: poolState,
        userState: userState,
        stakingVault: stakingVault,
        userStakingAccount: userStakingAccount,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    // Verify UserState
    const state = await program.account.userState.fetch(userState);
    expect(state.stakedBalance.toString()).to.equal(stakeAmount.toString());
    expect(state.accruedRewards.toNumber()).to.equal(0);
    expect(state.lastStakeTimestamp.toNumber()).to.be.greaterThan(0);

    // Verify vault balance
    const vaultBalance = await provider.connection.getTokenAccountBalance(stakingVault);
    expect(vaultBalance.value.amount).to.equal(stakeAmount.toString());
  });

  it("Claims accrued rewards", async () => {
    // Wait 3 seconds for yield to accumulate
    console.log("Waiting 3 seconds to accumulate yield...");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    await program.methods
      .claim()
      .accounts({
        user: user.publicKey,
        poolState: poolState,
        userState: userState,
        rewardMint: rewardMint,
        userRewardAccount: userRewardAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    // Verify UserState has reset accrued rewards
    const state = await program.account.userState.fetch(userState);
    expect(state.accruedRewards.toNumber()).to.equal(0);

    // Verify user received reward tokens
    const rewardBalance = await provider.connection.getTokenAccountBalance(userRewardAccount);
    const rewardAmount = parseFloat(rewardBalance.value.amount);
    console.log(`Earned reward amount: ${rewardAmount} units`);
    expect(rewardAmount).to.be.greaterThan(0);
  });

  it("Unstakes staked tokens", async () => {
    await program.methods
      .unstake(stakeAmount)
      .accounts({
        user: user.publicKey,
        poolState: poolState,
        userState: userState,
        stakingVault: stakingVault,
        userStakingAccount: userStakingAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    // Verify UserState staked balance is 0
    const state = await program.account.userState.fetch(userState);
    expect(state.stakedBalance.toNumber()).to.equal(0);

    // Verify staking vault is empty
    const vaultBalance = await provider.connection.getTokenAccountBalance(stakingVault);
    expect(vaultBalance.value.amount).to.equal("0");
  });
});
