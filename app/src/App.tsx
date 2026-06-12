import { useState, useEffect, useRef } from 'react';

const API_BASE = "http://127.0.0.1:8899/api";

interface PoolState {
  admin: string;
  staking_mint: string;
  reward_mint: string;
  staking_vault: number;
  reward_rate: number;
  initialized: boolean;
}

interface UserState {
  wallet: string;
  sol_balance: number;
  staking_balance: number;
  reward_balance: number;
  staked_balance: number;
  last_stake_timestamp: number;
  accrued_rewards: number;
  unclaimed_rewards: number;
}

function App() {
  const [wallet, setWallet] = useState<string>("");
  const [pool, setPool] = useState<PoolState | null>(null);
  const [user, setUser] = useState<UserState | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  // Inputs
  const [stakeAmount, setStakeAmount] = useState<string>("");
  const [unstakeAmount, setUnstakeAmount] = useState<string>("");
  const [adminRewardRate, setAdminRewardRate] = useState<string>("100000"); // Default 0.1 tokens/sec

  // Ticking rewards state
  const [tickingRewards, setTickingRewards] = useState<number>(0);
  const tickRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize wallet
  useEffect(() => {
    let savedWallet = localStorage.getItem("simulated_wallet");
    if (!savedWallet) {
      // Generate a mock Solana address
      const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
      let mockAddr = "";
      for (let i = 0; i < 44; i++) {
        mockAddr += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      savedWallet = mockAddr;
      localStorage.setItem("simulated_wallet", savedWallet);
    }
    setWallet(savedWallet);
  }, []);

  // Fetch state periodically
  const fetchState = async (walletAddress: string) => {
    if (!walletAddress) return;
    try {
      const res = await fetch(`${API_BASE}/state?wallet=${walletAddress}`);
      if (res.ok) {
        const data = await res.json();
        setPool(data.pool);
        setUser(data.user);
        setTickingRewards(data.user.unclaimed_rewards);
      }
    } catch (err) {
      console.error("Failed to fetch simulator state:", err);
    }
  };

  useEffect(() => {
    if (wallet) {
      fetchState(wallet);
      const interval = setInterval(() => fetchState(wallet), 3000);
      return () => clearInterval(interval);
    }
  }, [wallet]);

  // Real-time ticking effect for rewards dashboard
  useEffect(() => {
    if (tickRef.current) clearInterval(tickRef.current);

    if (user && user.staked_balance > 0 && pool) {
      tickRef.current = setInterval(() => {
        const now = Math.floor(Date.now() / 1000);
        const timeDelta = Math.max(0, now - user.last_stake_timestamp);
        
        // Yield = (Balance * RewardRate * Delta) / 1,000,000
        const pendingYield = (user.staked_balance * pool.reward_rate * timeDelta) / 1000000;
        setTickingRewards(user.accrued_rewards + pendingYield);
      }, 100);
    } else if (user) {
      setTickingRewards(user.unclaimed_rewards);
    }

    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [user, pool]);

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  const handleSetup = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet })
      });
      const data = await res.json();
      if (res.ok) {
        showMsg('success', "Airdropped 1,000 SOL and 1,000,000 Staking Tokens to mock wallet!");
        fetchState(wallet);
      } else {
        showMsg('error', data.error || "Setup failed");
      }
    } catch (err) {
      showMsg('error', "Could not connect to Python simulator backend");
    } finally {
      setLoading(false);
    }
  };

  const handleInitialize = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/initialize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin: wallet, reward_rate: parseFloat(adminRewardRate) })
      });
      const data = await res.json();
      if (res.ok) {
        showMsg('success', "Yield Staking Pool Initialized successfully!");
        fetchState(wallet);
      } else {
        showMsg('error', data.error || "Initialization failed");
      }
    } catch (err) {
      showMsg('error', "Network error connecting to backend");
    } finally {
      setLoading(false);
    }
  };

  const handleStake = async () => {
    if (!stakeAmount || parseFloat(stakeAmount) <= 0) return;
    setLoading(true);
    // Decimals 6 -> multiply by 1e6
    const amountRaw = Math.floor(parseFloat(stakeAmount) * 1000000);
    try {
      const res = await fetch(`${API_BASE}/stake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet, amount: amountRaw })
      });
      const data = await res.json();
      if (res.ok) {
        showMsg('success', `Staked ${stakeAmount} tokens successfully!`);
        setStakeAmount("");
        fetchState(wallet);
      } else {
        showMsg('error', data.error || "Stake failed");
      }
    } catch (err) {
      showMsg('error', "Network error connecting to backend");
    } finally {
      setLoading(false);
    }
  };

  const handleUnstake = async () => {
    if (!unstakeAmount || parseFloat(unstakeAmount) <= 0) return;
    setLoading(true);
    const amountRaw = Math.floor(parseFloat(unstakeAmount) * 1000000);
    try {
      const res = await fetch(`${API_BASE}/unstake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet, amount: amountRaw })
      });
      const data = await res.json();
      if (res.ok) {
        showMsg('success', `Unstaked ${unstakeAmount} tokens successfully!`);
        setUnstakeAmount("");
        fetchState(wallet);
      } else {
        showMsg('error', data.error || "Unstake failed");
      }
    } catch (err) {
      showMsg('error', "Network error connecting to backend");
    } finally {
      setLoading(false);
    }
  };

  const handleClaim = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet })
      });
      const data = await res.json();
      if (res.ok) {
        showMsg('success', "Rewards claimed successfully!");
        fetchState(wallet);
      } else {
        showMsg('error', data.error || "Claim failed");
      }
    } catch (err) {
      showMsg('error', "Network error connecting to backend");
    } finally {
      setLoading(false);
    }
  };

  const generateNewWallet = () => {
    const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let mockAddr = "";
    for (let i = 0; i < 44; i++) {
      mockAddr += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setWallet(mockAddr);
    localStorage.setItem("simulated_wallet", mockAddr);
    showMsg('success', "Generated new clean simulated wallet keypair!");
  };

  const formatTokens = (rawAmount: number | undefined) => {
    if (rawAmount === undefined) return "0.00";
    return (rawAmount / 1000000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  };

  return (
    <div className="min-h-screen bg-[#0b0f19] text-gray-200 py-10 px-4 md:px-8">
      {/* Header */}
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between border-b border-gray-800 pb-6 mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-gradient">Solana Yield Vibe</h1>
          <p className="text-gray-400 text-sm mt-1">Solana Token Staking Local Simulator</p>
        </div>
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3 mt-4 md:mt-0">
          <div className="flex items-center bg-[#151d30] border border-gray-800 px-4 py-2 rounded-lg text-xs md:text-sm font-mono text-indigo-300">
            <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full mr-2 glow-emerald"></span>
            Wallet: {wallet ? `${wallet.slice(0, 6)}...${wallet.slice(-6)}` : "Not Loaded"}
          </div>
          <button 
            onClick={generateNewWallet}
            className="px-4 py-2 border border-gray-700 hover:border-indigo-500 hover:text-white rounded-lg text-sm transition font-medium"
          >
            Switch Wallet
          </button>
          <button 
            onClick={handleSetup}
            disabled={loading}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm transition font-semibold disabled:opacity-50"
          >
            Airdrop Faucet
          </button>
        </div>
      </div>

      {/* Main Info Message */}
      {message && (
        <div className={`max-w-6xl mx-auto mb-6 p-4 rounded-lg text-sm border font-medium transition-all ${
          message.type === 'success' 
            ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-300' 
            : 'bg-rose-950/40 border-rose-800/80 text-rose-300'
        }`}>
          {message.text}
        </div>
      )}

      {/* Dashboard Layout */}
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left column: Pool state & Admin setup */}
        <div className="lg:col-span-1 space-y-6">
          <div className="glassmorphism p-6 rounded-2xl glow-purple">
            <h2 className="text-xl font-bold border-b border-gray-800 pb-3 text-indigo-300">Pool Metrics</h2>
            
            <div className="mt-4 space-y-4 text-sm">
              <div>
                <span className="text-gray-400 block text-xs">Total Value Locked (TVL)</span>
                <span className="text-2xl font-bold text-white mt-1 block">
                  {pool ? formatTokens(pool.staking_vault) : "0.00"} <span className="text-xs text-indigo-400 font-semibold">STAKE</span>
                </span>
              </div>
              
              <div>
                <span className="text-gray-400 block text-xs">Reward Rate</span>
                <span className="text-white font-medium block mt-0.5">
                  {pool ? `${pool.reward_rate / 1000000} reward/staked/sec` : "0.00"}
                </span>
              </div>

              <div className="pt-2 border-t border-gray-800">
                <span className="text-gray-400 block text-xs">Staking Mint</span>
                <span className="text-gray-300 font-mono text-xs break-all block mt-0.5 select-all">
                  {pool ? pool.staking_mint : "---"}
                </span>
              </div>

              <div>
                <span className="text-gray-400 block text-xs">Reward Mint</span>
                <span className="text-gray-300 font-mono text-xs break-all block mt-0.5 select-all">
                  {pool ? pool.reward_mint : "---"}
                </span>
              </div>
            </div>
          </div>

          <div className="glassmorphism p-6 rounded-2xl">
            <h2 className="text-xl font-bold border-b border-gray-800 pb-3 text-pink-400">Pool Initialization</h2>
            <p className="text-gray-400 text-xs mt-2">
              If the pool is not active or you wish to update the yield rewards parameters, define the RewardRate and initialize.
            </p>
            
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Reward Rate (Scaled by 1e6)</label>
                <input
                  type="number"
                  value={adminRewardRate}
                  onChange={(e) => setAdminRewardRate(e.target.value)}
                  className="w-full bg-[#111827] border border-gray-800 px-3 py-2 rounded-lg text-sm text-white focus:outline-none focus:border-pink-500 font-mono"
                  placeholder="e.g. 100000 for 0.1 tokens/sec"
                />
                <span className="text-[10px] text-gray-500 mt-1 block">100,000 = 0.1 reward tokens per staked token per second</span>
              </div>

              <button
                onClick={handleInitialize}
                disabled={loading}
                className="w-full bg-pink-600 hover:bg-pink-500 text-white font-bold py-2 px-4 rounded-lg transition text-sm disabled:opacity-50"
              >
                {pool?.initialized ? "Update Pool Parameters" : "Initialize Staking Pool"}
              </button>
            </div>
          </div>
        </div>

        {/* Right column: User Dashboard & Staking Panel */}
        <div className="lg:col-span-2 space-y-6">
          {/* User Dashboard */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            <div className="glassmorphism p-6 rounded-2xl border-l-4 border-l-indigo-500">
              <h3 className="text-gray-400 text-xs font-semibold uppercase tracking-wider">My Staked Principal</h3>
              <div className="text-3xl font-extrabold text-white mt-2">
                {user ? formatTokens(user.staked_balance) : "0.00"}
                <span className="text-sm text-indigo-400 font-bold ml-2">STAKE</span>
              </div>
              <div className="text-xs text-gray-400 mt-2">
                Wallet Staking Balance: {user ? formatTokens(user.staking_balance) : "0.00"} STAKE
              </div>
            </div>

            <div className="glassmorphism p-6 rounded-2xl border-l-4 border-l-pink-500 glow-pink">
              <h3 className="text-gray-400 text-xs font-semibold uppercase tracking-wider">Simulated Accruing Yield</h3>
              <div className="text-3xl font-extrabold text-pink-400 mt-2 font-mono">
                {formatTokens(tickingRewards)}
                <span className="text-sm text-gray-400 font-semibold ml-2">REWARD</span>
              </div>
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-gray-400">Claimed Balance: {user ? formatTokens(user.reward_balance) : "0.00"}</span>
                {tickingRewards > 0 && (
                  <span className="text-[10px] text-emerald-400 bg-emerald-950/50 px-2 py-0.5 rounded-full font-bold animate-pulse">
                    Accruing Yield +
                  </span>
                )}
              </div>
            </div>

          </div>

          {/* User Wallet Info & Solana Simulation Values */}
          <div className="glassmorphism p-6 rounded-2xl grid grid-cols-3 gap-4 text-center">
            <div>
              <span className="text-gray-400 block text-xs">SOL Balance</span>
              <span className="text-lg font-bold text-white mt-1 block">
                {user ? user.sol_balance.toLocaleString() : "0"} SOL
              </span>
            </div>
            <div>
              <span className="text-gray-400 block text-xs">Staking Token Mint</span>
              <span className="text-lg font-bold text-indigo-400 mt-1 block">
                STAKE
              </span>
            </div>
            <div>
              <span className="text-gray-400 block text-xs">Reward Token Mint</span>
              <span className="text-lg font-bold text-pink-400 mt-1 block">
                RWD
              </span>
            </div>
          </div>

          {/* Action Panel */}
          <div className="glassmorphism p-8 rounded-3xl">
            <h2 className="text-2xl font-bold text-white mb-6 border-b border-gray-800 pb-3">Staking Simulator Control Panel</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Stake Card */}
              <div className="space-y-4">
                <h3 className="text-lg font-bold text-indigo-400">Stake STAKE Tokens</h3>
                <p className="text-gray-400 text-xs">
                  Lock your STAKE tokens into the pool to start yielding simulated reward tokens.
                </p>
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
                      onClick={() => user && setStakeAmount((user.staking_balance / 1000000).toString())}
                      className="px-3 py-1 bg-[#151d30] border border-gray-800 hover:border-indigo-500 rounded-lg text-xs font-semibold text-gray-300"
                    >
                      MAX
                    </button>
                  </div>
                </div>
                <button
                  onClick={handleStake}
                  disabled={loading || !stakeAmount}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 px-4 rounded-xl transition text-sm disabled:opacity-50"
                >
                  Stake Principal
                </button>
              </div>

              {/* Unstake Card */}
              <div className="space-y-4">
                <h3 className="text-lg font-bold text-pink-400">Withdraw Principal & Yield</h3>
                <p className="text-gray-400 text-xs">
                  Unstake your tokens back to your wallet. This automatically triggers yield accrual.
                </p>
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
                      onClick={() => user && setUnstakeAmount((user.staked_balance / 1000000).toString())}
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

            {/* Claim Yield Row */}
            <div className="mt-8 pt-6 border-t border-gray-800 flex flex-col md:flex-row items-center justify-between gap-4">
              <div>
                <h4 className="text-white font-bold">Claim Rewards</h4>
                <p className="text-gray-400 text-xs mt-0.5">Mint accumulated reward tokens directly to your wallet without unstaking.</p>
              </div>
              <button
                onClick={handleClaim}
                disabled={loading || tickingRewards <= 0}
                className="w-full md:w-auto px-8 py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-bold rounded-xl transition text-sm glow-pink disabled:opacity-50"
              >
                Claim simulated yield ({formatTokens(tickingRewards)} RWD)
              </button>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}

export default App;
