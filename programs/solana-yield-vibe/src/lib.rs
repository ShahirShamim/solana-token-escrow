use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer, MintTo, mint_to, transfer};

declare_id!("CrCv1oVV3Ft2S2G1WjtjAyyXwG41YGMvFbYxeLmQ8yx6");

#[program]
pub mod solana_yield_vibe {
    use super::*;

    pub fn initialize_pool(ctx: Context<InitializePool>, reward_rate: u64) -> Result<()> {
        let pool_state = &mut ctx.accounts.pool_state;
        pool_state.admin = ctx.accounts.admin.key();
        pool_state.staking_mint = ctx.accounts.staking_mint.key();
        pool_state.reward_mint = ctx.accounts.reward_mint.key();
        pool_state.staking_vault = ctx.accounts.staking_vault.key();
        pool_state.reward_rate = reward_rate;
        pool_state.bump = ctx.bumps.pool_state;

        msg!("Pool initialized. Reward rate: {}", reward_rate);
        Ok(())
    }

    pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::ZeroAmount);

        let user_state = &mut ctx.accounts.user_state;
        let pool_state = &ctx.accounts.pool_state;
        let current_time = Clock::get()?.unix_timestamp;

        // Calculate and accrue yield first
        let pending_yield = calculate_pending_yield(
            user_state.staked_balance,
            pool_state.reward_rate,
            user_state.last_stake_timestamp,
            current_time,
        )?;

        user_state.accrued_rewards = user_state.accrued_rewards
            .checked_add(pending_yield)
            .ok_or(ErrorCode::MathOverflow)?;

        // Transfer staking tokens from user to staking_vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.user_staking_account.to_account_info(),
            to: ctx.accounts.staking_vault.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        transfer(cpi_ctx, amount)?;

        // Update user state
        user_state.staked_balance = user_state.staked_balance
            .checked_add(amount)
            .ok_or(ErrorCode::MathOverflow)?;
        user_state.last_stake_timestamp = current_time;
        user_state.bump = ctx.bumps.user_state;

        msg!("Staked {} tokens. New balance: {}", amount, user_state.staked_balance);
        Ok(())
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let user_state = &mut ctx.accounts.user_state;
        let pool_state = &ctx.accounts.pool_state;
        let current_time = Clock::get()?.unix_timestamp;

        // Calculate and accrue yield first
        let pending_yield = calculate_pending_yield(
            user_state.staked_balance,
            pool_state.reward_rate,
            user_state.last_stake_timestamp,
            current_time,
        )?;

        let total_rewards = user_state.accrued_rewards
            .checked_add(pending_yield)
            .ok_or(ErrorCode::MathOverflow)?;

        require!(total_rewards > 0, ErrorCode::NoRewardsToClaim);

        // Reset user rewards and update last stake timestamp
        user_state.accrued_rewards = 0;
        user_state.last_stake_timestamp = current_time;

        // Mint rewards to the user
        // Seeds for the PoolState PDA signing the MintTo CPI
        let seeds = &[
            b"pool".as_ref(),
            &[pool_state.bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let cpi_accounts = MintTo {
            mint: ctx.accounts.reward_mint.to_account_info(),
            to: ctx.accounts.user_reward_account.to_account_info(),
            authority: pool_state.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        mint_to(cpi_ctx, total_rewards)?;

        msg!("Claimed {} reward tokens", total_rewards);
        Ok(())
    }

    pub fn unstake(ctx: Context<Unstake>, amount: u64) -> Result<()> {
        let user_state = &mut ctx.accounts.user_state;
        let pool_state = &ctx.accounts.pool_state;
        
        require!(amount > 0, ErrorCode::ZeroAmount);
        require!(user_state.staked_balance >= amount, ErrorCode::InsufficientStakeBalance);

        let current_time = Clock::get()?.unix_timestamp;

        // Calculate and accrue yield first
        let pending_yield = calculate_pending_yield(
            user_state.staked_balance,
            pool_state.reward_rate,
            user_state.last_stake_timestamp,
            current_time,
        )?;

        user_state.accrued_rewards = user_state.accrued_rewards
            .checked_add(pending_yield)
            .ok_or(ErrorCode::MathOverflow)?;

        // Transfer staking tokens back to user from staking_vault
        // Seeds for the PoolState PDA signing the Transfer CPI
        let seeds = &[
            b"pool".as_ref(),
            &[pool_state.bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.staking_vault.to_account_info(),
            to: ctx.accounts.user_staking_account.to_account_info(),
            authority: pool_state.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        transfer(cpi_ctx, amount)?;

        // Update user state
        user_state.staked_balance = user_state.staked_balance
            .checked_sub(amount)
            .ok_or(ErrorCode::MathOverflow)?;
        user_state.last_stake_timestamp = current_time;

        msg!("Unstaked {} tokens. Remaining balance: {}", amount, user_state.staked_balance);
        Ok(())
    }
}

// Math Yield Logic Helper
// Yield = Balance * RewardRate * (T_current - T_last_stake) / 1,000,000
fn calculate_pending_yield(
    balance: u64,
    reward_rate: u64,
    last_stake_timestamp: i64,
    current_timestamp: i64,
) -> Result<u64> {
    if balance == 0 || last_stake_timestamp == 0 || current_timestamp <= last_stake_timestamp {
        return Ok(0);
    }
    
    let time_delta = (current_timestamp - last_stake_timestamp) as u64;

    let total_yield = balance
        .checked_mul(reward_rate)
        .ok_or(ErrorCode::MathOverflow)?
        .checked_mul(time_delta)
        .ok_or(ErrorCode::MathOverflow)?
        .checked_div(1_000_000)
        .ok_or(ErrorCode::MathOverflow)?;

    Ok(total_yield)
}

#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    pub staking_mint: Account<'info, Mint>,
    pub reward_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = admin,
        seeds = [b"pool"],
        bump,
        space = 8 + 32 + 32 + 32 + 32 + 8 + 1
    )]
    pub pool_state: Account<'info, PoolState>,

    #[account(
        init,
        payer = admin,
        associated_token::mint = staking_mint,
        associated_token::authority = pool_state,
    )]
    pub staking_vault: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"pool"],
        bump = pool_state.bump,
    )]
    pub pool_state: Account<'info, PoolState>,

    #[account(
        init_if_needed,
        payer = user,
        seeds = [b"user_state", pool_state.key().as_ref(), user.key().as_ref()],
        bump,
        space = 8 + 8 + 8 + 8 + 1
    )]
    pub user_state: Account<'info, UserState>,

    #[account(
        mut,
        constraint = staking_vault.mint == pool_state.staking_mint,
        constraint = staking_vault.owner == pool_state.key(),
    )]
    pub staking_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = user_staking_account.mint == pool_state.staking_mint,
        constraint = user_staking_account.owner == user.key(),
    )]
    pub user_staking_account: Account<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [b"pool"],
        bump = pool_state.bump,
    )]
    pub pool_state: Account<'info, PoolState>,

    #[account(
        mut,
        seeds = [b"user_state", pool_state.key().as_ref(), user.key().as_ref()],
        bump = user_state.bump,
    )]
    pub user_state: Account<'info, UserState>,

    #[account(
        mut,
        constraint = reward_mint.key() == pool_state.reward_mint,
        constraint = reward_mint.mint_authority.map_or(false, |a| a == pool_state.key()),
    )]
    pub reward_mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = user_reward_account.mint == pool_state.reward_mint,
        constraint = user_reward_account.owner == user.key(),
    )]
    pub user_reward_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Unstake<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [b"pool"],
        bump = pool_state.bump,
    )]
    pub pool_state: Account<'info, PoolState>,

    #[account(
        mut,
        seeds = [b"user_state", pool_state.key().as_ref(), user.key().as_ref()],
        bump = user_state.bump,
    )]
    pub user_state: Account<'info, UserState>,

    #[account(
        mut,
        constraint = staking_vault.mint == pool_state.staking_mint,
        constraint = staking_vault.owner == pool_state.key(),
    )]
    pub staking_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = user_staking_account.mint == pool_state.staking_mint,
        constraint = user_staking_account.owner == user.key(),
    )]
    pub user_staking_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[account]
pub struct PoolState {
    pub admin: Pubkey,
    pub staking_mint: Pubkey,
    pub reward_mint: Pubkey,
    pub staking_vault: Pubkey,
    pub reward_rate: u64,
    pub bump: u8,
}

#[account]
pub struct UserState {
    pub staked_balance: u64,
    pub last_stake_timestamp: i64,
    pub accrued_rewards: u64,
    pub bump: u8,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Amount must be greater than zero.")]
    ZeroAmount,
    #[msg("Math overflow error occurred.")]
    MathOverflow,
    #[msg("No rewards available to claim.")]
    NoRewardsToClaim,
    #[msg("Insufficient staked balance.")]
    InsufficientStakeBalance,
}
