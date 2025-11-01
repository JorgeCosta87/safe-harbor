use anchor_lang::prelude::*;

declare_id!("FLbXSNGkAaZtiJjutwKWsGCsUYNLvchPXBXkeTj31RaF");

#[program]
pub mod safe_harbor {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
