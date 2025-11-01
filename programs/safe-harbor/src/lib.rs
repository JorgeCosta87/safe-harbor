use anchor_lang::prelude::*;

declare_id!("FLbXSNGkAaZtiJjutwKWsGCsUYNLvchPXBXkeTj31RaF");

pub mod context;
pub mod state;

pub use context::*;

#[program]
pub mod safe_harbor {
    use super::*;

    pub fn make(ctx: Context<Make>, seed: u64, receive: u64, deposit: u64) -> Result<()> {
        ctx.accounts.init_escrow(seed, receive, &ctx.bumps)?;

        ctx.accounts.deposit_tokens(deposit)
    }

    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        ctx.accounts.refund_and_close()
    }

    pub fn take(ctx: Context<Take>) -> Result<()> {
        ctx.accounts.deposit()?;

        ctx.accounts.withraw_and_close_vault()
    }
}
