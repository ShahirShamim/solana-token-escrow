import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import * as anchor from '@coral-xyz/anchor'
import { LAMPORTS_PER_SOL, SystemProgram } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { createStakingClient } from './anchorClient'

interface PoolView {
  initialized: boolean
  rewardRate: number
}

interface UserView {
  staked: number
  accrued: number
  lastStake: number
}

function App() {
  // Anchor client (validator connection + program + funded local wallet).
  const client = useMemo(() => createStakingClient(), [])

  const [pool, setPool] = useState<PoolView | null>(null)
  const [tvl, setTvl] = useState<number>(0)
  const [solBalance, setSolBalance] = useState<number>(0)
  const [stakingBalance, setStakingBalance] = useState<number>(0)
  const [rewardBalance, setRewardBalance] = useState<number>(0)
  const [user, setUser] = useState<UserView | null>(null)

  const [loading, setLoading] = useState<boolean>(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Inputs
  const [stakeAmount, setStakeAmount] = useState<string>('')
  const [unstakeAmount, setUnstakeAmount] = useState<string>('')
  const [adminRewardRate, setAdminRewardRate] = useState<string>('100000')

  // Real-time ticking rewards
  const [tickingRewards, setTickingRewards] = useState<number>(0)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 6000)
  }

  // Pull all on-chain state for the dashboard.
  const fetchState = useCallback(async () => {
    if (!client) return
    const program = client.program as anchor.Program

    try {
      const ps = await (program.account as any).poolState.fetchNullable(client.poolState)
      setPool(ps ? { initialized: true, rewardRate: Number(ps.rewardRate) } : { initialized: false, rewardRate: 0 })
    } catch {
      setPool({ initialized: false, rewardRate: 0 })
    }

    try {
      const bal = await client.connection.getTokenAccountBalance(client.stakingVault)
      setTvl(Number(bal.value.amount))
    } catch {
      setTvl(0)
    }

    try {
      setSolBalance((await client.connection.getBalance(client.walletPubkey)) / LAMPORTS_PER_SOL)
    } catch {
      /* ignore */
    }

    try {
      const bal = await client.connection.getTokenAccountBalance(client.userStakingAccount)
      setStakingBalance(Number(bal.value.amount))
    } catch {
      setStakingBalance(0)
    }

    try {
      const bal = await client.connection.getTokenAccountBalance(client.userRewardAccount)
      setRewardBalance(Number(bal.value.amount))
    } catch {
      setRewardBalance(0)
    }

    try {
      const us = await (program.account as any).userState.fetchNullable(client.userState)
      setUser(
        us
          ? { staked: Number(us.stakedBalance), accrued: Number(us.accruedRewards), lastStake: Number(us.lastStakeTimestamp) }
          : { staked: 0, accrued: 0, lastStake: 0 }
      )
    } catch {
      setUser({ staked: 0, accrued: 0, lastStake: 0 })
    }
  }, [client])

  useEffect(() => {
    if (!client) return
    fetchState()
    const interval = setInterval(fetchState, 3000)
    return () => clearInterval(interval)
  }, [client, fetchState])

  // Tick unclaimed rewards between polls, mirroring the on-chain yield formula:
  //   Yield = Balance * RewardRate * (now - lastStake) / 1e6
  useEffect(() => {
    if (tickRef.current) clearInterval(tickRef.current)
    if (user && pool && user.staked > 0 && user.lastStake > 0) {
      tickRef.current = setInterval(() => {
        const now = Math.floor(Date.now() / 1000)
        const delta = Math.max(0, now - user.lastStake)
        const pending = (user.staked * pool.rewardRate) / 1_000_000 * delta
        setTickingRewards(user.accrued + pending)
      }, 100)
    } else if (user) {
      setTickingRewards(user.accrued)
    }
    return () => {
      if (tickRef.current) clearInterval(tickRef.current)
    }
  }, [user, pool])

  const program = () => client!.program as any

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setLoading(true)
    try {
      await fn()
      await fetchState()
      return true
    } catch (err: any) {
      console.error(`${label} failed:`, err)
      showMsg('error', `${label} failed: ${err?.message ?? 'see console'}`)
      return false
    } finally {
      setLoading(false)
    }
  }

  const handleAirdrop = async () => {
    if (!client) return
    await run('Airdrop', async () => {
      const sig = await client.connection.requestAirdrop(client.walletPubkey, 100 * LAMPORTS_PER_SOL)
      const latest = await client.connection.getLatestBlockhash()
      await client.connection.confirmTransaction({ signature: sig, ...latest }, 'confirmed')
      showMsg('success', 'Airdropped 100 SOL to the app wallet for transaction fees.')
    })
  }

  const handleInitialize = async () => {
    if (!client) return
    const rate = parseInt(adminRewardRate, 10)
    if (!Number.isFinite(rate) || rate <= 0) return showMsg('error', 'Enter a valid reward rate.')
    const ok = await run('Initialize pool', () =>
      program()
        .methods.initializePool(new anchor.BN(rate))
        .accounts({
          admin: client.walletPubkey,
          stakingMint: client.stakingMint,
          rewardMint: client.rewardMint,
          poolState: client.poolState,
          stakingVault: client.stakingVault,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .rpc()
    )
    if (ok) showMsg('success', 'Yield staking pool initialized on-chain!')
  }

  const handleStake = async () => {
    if (!client) return
    const amt = parseFloat(stakeAmount)
    if (!Number.isFinite(amt) || amt <= 0) return
    const raw = Math.floor(amt * 1_000_000)
    const ok = await run('Stake', () =>
      program()
        .methods.stake(new anchor.BN(raw))
        .accounts({
          user: client.walletPubkey,
          poolState: client.poolState,
          userState: client.userState,
          stakingVault: client.stakingVault,
          userStakingAccount: client.userStakingAccount,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .rpc()
    )
    if (ok) {
      setStakeAmount('')
      showMsg('success', `Staked ${amt} STAKE into the pool.`)
    }
  }

  const handleUnstake = async () => {
    if (!client) return
    const amt = parseFloat(unstakeAmount)
    if (!Number.isFinite(amt) || amt <= 0) return
    const raw = Math.floor(amt * 1_000_000)
    const ok = await run('Unstake', () =>
      program()
        .methods.unstake(new anchor.BN(raw))
        .accounts({
          user: client.walletPubkey,
          poolState: client.poolState,
          userState: client.userState,
          stakingVault: client.stakingVault,
          userStakingAccount: client.userStakingAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc()
    )
    if (ok) {
      setUnstakeAmount('')
      showMsg('success', `Unstaked ${amt} STAKE back to your wallet.`)
    }
  }

  const handleClaim = async () => {
    if (!client) return
    const ok = await run('Claim', () =>
      program()
        .methods.claim()
        .accounts({
          user: client.walletPubkey,
          poolState: client.poolState,
          userState: client.userState,
          rewardMint: client.rewardMint,
          userRewardAccount: client.userRewardAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc()
    )
    if (ok) showMsg('success', 'Reward tokens minted to your wallet!')
  }

  const formatTokens = (raw: number | undefined) => {
    if (!raw) return '0.00'
    return (raw / 1_000_000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })
  }

  // No localnet config yet — guide the user to run the setup script.
  if (!client) {
    return (
      <div className="min-h-screen bg-[#0b0f19] text-gray-200 flex items-center justify-center p-6">
        <div className="glassmorphism max-w-xl p-8 rounded-2xl">
          <h1 className="text-2xl font-extrabold text-gradient mb-3">Solana Yield Vibe</h1>
          <p className="text-gray-300 mb-4">Local environment not configured yet. Run these from the repo root:</p>
          <pre className="bg-[#111827] border border-gray-800 rounded-lg p-4 text-xs text-indigo-300 overflow-x-auto">
{`COPYFILE_DISABLE=1 solana-test-validator --reset   # terminal 1
anchor deploy                                       # terminal 2
npx tsx scripts/setup_local_env.ts                  # terminal 2
# then restart this dev server`}
          </pre>
          <p className="text-gray-500 text-xs mt-4">
            The setup script writes <code className="text-gray-300">app/src/localnet.json</code> and copies the program IDL.
          </p>
        </div>
      </div>
    )
  }

  const walletStr = client.walletPubkey.toBase58()

  return (
    <div className="min-h-screen bg-[#0b0f19] text-gray-200 py-10 px-4 md:px-8">
      {/* Header */}
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between border-b border-gray-800 pb-6 mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-gradient">Solana Yield Vibe</h1>
          <p className="text-gray-400 text-sm mt-1">On-chain Token Staking · Local Test Validator</p>
        </div>
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3 mt-4 md:mt-0">
          <div className="flex items-center bg-[#151d30] border border-gray-800 px-4 py-2 rounded-lg text-xs md:text-sm font-mono text-indigo-300">
            <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full mr-2"></span>
            Wallet: {`${walletStr.slice(0, 6)}...${walletStr.slice(-6)}`}
          </div>
          <button
            onClick={handleAirdrop}
            disabled={loading}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm transition font-semibold disabled:opacity-50"
          >
            Airdrop 100 SOL
          </button>
        </div>
      </div>

      {message && (
        <div
          className={`max-w-6xl mx-auto mb-6 p-4 rounded-lg text-sm border font-medium transition-all ${
            message.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-300'
              : 'bg-rose-950/40 border-rose-800/80 text-rose-300'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left column: Pool metrics & init */}
        <div className="lg:col-span-1 space-y-6">
          <div className="glassmorphism p-6 rounded-2xl glow-purple">
            <h2 className="text-xl font-bold border-b border-gray-800 pb-3 text-indigo-300">Pool Metrics</h2>
            <div className="mt-4 space-y-4 text-sm">
              <div>
                <span className="text-gray-400 block text-xs">Total Value Locked (TVL)</span>
                <span className="text-2xl font-bold text-white mt-1 block">
                  {formatTokens(tvl)} <span className="text-xs text-indigo-400 font-semibold">STAKE</span>
                </span>
              </div>
              <div>
                <span className="text-gray-400 block text-xs">Reward Rate</span>
                <span className="text-white font-medium block mt-0.5">
                  {pool?.initialized ? `${pool.rewardRate / 1_000_000} reward/staked/sec` : 'Pool not initialized'}
                </span>
              </div>
              <div className="pt-2 border-t border-gray-800">
                <span className="text-gray-400 block text-xs">Staking Mint</span>
                <span className="text-gray-300 font-mono text-xs break-all block mt-0.5 select-all">
                  {client.stakingMint.toBase58()}
                </span>
              </div>
              <div>
                <span className="text-gray-400 block text-xs">Reward Mint</span>
                <span className="text-gray-300 font-mono text-xs break-all block mt-0.5 select-all">
                  {client.rewardMint.toBase58()}
                </span>
              </div>
            </div>
          </div>

          <div className="glassmorphism p-6 rounded-2xl">
            <h2 className="text-xl font-bold border-b border-gray-800 pb-3 text-pink-400">Pool Initialization</h2>
            <p className="text-gray-400 text-xs mt-2">
              {pool?.initialized
                ? 'Pool is live on-chain. The reward rate is fixed at initialization.'
                : 'Initialize the PoolState PDA and staking vault to activate the pool.'}
            </p>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Reward Rate (Scaled by 1e6)</label>
                <input
                  type="number"
                  value={adminRewardRate}
                  onChange={(e) => setAdminRewardRate(e.target.value)}
                  disabled={pool?.initialized}
                  className="w-full bg-[#111827] border border-gray-800 px-3 py-2 rounded-lg text-sm text-white focus:outline-none focus:border-pink-500 font-mono disabled:opacity-50"
                  placeholder="e.g. 100000 for 0.1 tokens/sec"
                />
                <span className="text-[10px] text-gray-500 mt-1 block">100,000 = 0.1 reward tokens per staked token per second</span>
              </div>
              <button
                onClick={handleInitialize}
                disabled={loading || pool?.initialized}
                className="w-full bg-pink-600 hover:bg-pink-500 text-white font-bold py-2 px-4 rounded-lg transition text-sm disabled:opacity-50"
              >
                {pool?.initialized ? 'Pool Active ✓' : 'Initialize Staking Pool'}
              </button>
            </div>
          </div>
        </div>

        {/* Right column: dashboard + actions */}
        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="glassmorphism p-6 rounded-2xl border-l-4 border-l-indigo-500">
              <h3 className="text-gray-400 text-xs font-semibold uppercase tracking-wider">My Staked Principal</h3>
              <div className="text-3xl font-extrabold text-white mt-2">
                {formatTokens(user?.staked)}
                <span className="text-sm text-indigo-400 font-bold ml-2">STAKE</span>
              </div>
              <div className="text-xs text-gray-400 mt-2">Wallet Balance: {formatTokens(stakingBalance)} STAKE</div>
            </div>

            <div className="glassmorphism p-6 rounded-2xl border-l-4 border-l-pink-500 glow-pink">
              <h3 className="text-gray-400 text-xs font-semibold uppercase tracking-wider">Accruing Yield (Unclaimed)</h3>
              <div className="text-3xl font-extrabold text-pink-400 mt-2 font-mono">
                {formatTokens(tickingRewards)}
                <span className="text-sm text-gray-400 font-semibold ml-2">REWARD</span>
              </div>
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-gray-400">Claimed Balance: {formatTokens(rewardBalance)}</span>
                {tickingRewards > 0 && (
                  <span className="text-[10px] text-emerald-400 bg-emerald-950/50 px-2 py-0.5 rounded-full font-bold animate-pulse">
                    Accruing Yield +
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="glassmorphism p-6 rounded-2xl grid grid-cols-3 gap-4 text-center">
            <div>
              <span className="text-gray-400 block text-xs">SOL Balance</span>
              <span className="text-lg font-bold text-white mt-1 block">
                {solBalance.toLocaleString(undefined, { maximumFractionDigits: 3 })} SOL
              </span>
            </div>
            <div>
              <span className="text-gray-400 block text-xs">Staking Token</span>
              <span className="text-lg font-bold text-indigo-400 mt-1 block">STAKE</span>
            </div>
            <div>
              <span className="text-gray-400 block text-xs">Reward Token</span>
              <span className="text-lg font-bold text-pink-400 mt-1 block">RWD</span>
            </div>
          </div>

          {/* Action Panel */}
          <div className="glassmorphism p-8 rounded-3xl">
            <h2 className="text-2xl font-bold text-white mb-6 border-b border-gray-800 pb-3">Staking Control Panel</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Stake */}
              <div className="space-y-4">
                <h3 className="text-lg font-bold text-indigo-400">Stake STAKE Tokens</h3>
                <p className="text-gray-400 text-xs">Lock STAKE tokens into the on-chain vault to start yielding rewards.</p>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Amount to Stake</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={stakeAmount}
                      onChange={(e) => setStakeAmount(e.target.value)}
                      className="w-full bg-[#111827] border border-gray-800 px-3 py-2 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500 font-mono"
                      placeholder="Amount to stake"
                    />
                    <button
                      onClick={() => setStakeAmount((stakingBalance / 1_000_000).toString())}
                      className="px-3 py-1 bg-[#151d30] border border-gray-800 hover:border-indigo-500 rounded-lg text-xs font-semibold text-gray-300"
                    >
                      MAX
                    </button>
                  </div>
                </div>
                <button
                  onClick={handleStake}
                  disabled={loading || !stakeAmount || !pool?.initialized}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 px-4 rounded-xl transition text-sm disabled:opacity-50"
                >
                  Stake Principal
                </button>
              </div>

              {/* Unstake */}
              <div className="space-y-4">
                <h3 className="text-lg font-bold text-pink-400">Withdraw Principal & Yield</h3>
                <p className="text-gray-400 text-xs">Unstake tokens back to your wallet. Yield is accrued automatically first.</p>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Amount to Unstake</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={unstakeAmount}
                      onChange={(e) => setUnstakeAmount(e.target.value)}
                      className="w-full bg-[#111827] border border-gray-800 px-3 py-2 rounded-lg text-sm text-white focus:outline-none focus:border-pink-500 font-mono"
                      placeholder="Amount to unstake"
                    />
                    <button
                      onClick={() => setUnstakeAmount(((user?.staked ?? 0) / 1_000_000).toString())}
                      className="px-3 py-1 bg-[#151d30] border border-gray-800 hover:border-pink-500 rounded-lg text-xs font-semibold text-gray-300"
                    >
                      MAX
                    </button>
                  </div>
                </div>
                <button
                  onClick={handleUnstake}
                  disabled={loading || !unstakeAmount}
                  className="w-full bg-[#1e172a] hover:bg-[#2e1d44] border border-purple-900 text-purple-200 font-bold py-2.5 px-4 rounded-xl transition text-sm disabled:opacity-50"
                >
                  Unstake Principal
                </button>
              </div>
            </div>

            <div className="mt-8 pt-6 border-t border-gray-800 flex flex-col md:flex-row items-center justify-between gap-4">
              <div>
                <h4 className="text-white font-bold">Claim Rewards</h4>
                <p className="text-gray-400 text-xs mt-0.5">Mint accumulated reward tokens to your wallet without unstaking.</p>
              </div>
              <button
                onClick={handleClaim}
                disabled={loading || tickingRewards <= 0}
                className="w-full md:w-auto px-8 py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-bold rounded-xl transition text-sm glow-pink disabled:opacity-50"
              >
                Claim Yield ({formatTokens(tickingRewards)} RWD)
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
