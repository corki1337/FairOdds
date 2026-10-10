use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use yield_park::program::YieldPark;
use yield_park::state::{Park, Position};
use crate::{errors::AichainError, math::pari_mutuel_payout, state::*, switchboard::PullFeedView};

pub const SEED_SEASON: &[u8] = b"season";
pub const SEED_SEASON_RECEIPT: &[u8] = b"season-receipt";
pub const MAX_PARTICIPANTS: usize = 32;
#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct SeasonParticipant { pub name: [u8; 32], pub pool: u64 }
#[account]
#[derive(InitSpace)]
pub struct SeasonMarket {
    pub id: u64, pub authority: Pubkey, pub usdc_mint: Pubkey,
    pub title: [u8; 32], pub kind: u8, pub historical_demo: bool,
    pub cutoff: i64, pub end_time: i64, pub resolve_deadline: i64,
    pub feeds: [Pubkey; 2], pub hashes: [[u8; 32]; 2],
    #[max_len(32)] pub participants: Vec<SeasonParticipant>,
    pub status: MarketStatus, pub winner: Option<u8>, pub cancel_reason: u8,
    pub total_pool: u64, pub payout_pool: u64, pub claimed_stake: u64,
    pub yield_shares: u64, pub yield_harvested: u64, pub bump: u8, pub vault_bump: u8,
}
impl SeasonMarket { pub const LEN: usize = 8 + Self::INIT_SPACE; }
#[account]
#[derive(InitSpace)]
pub struct SeasonReceipt { pub user: Pubkey, pub market: Pubkey, pub selected: u8, pub amount: u64, pub claimed: bool, pub bump: u8 }
impl SeasonReceipt { pub const LEN: usize = 8 + Self::INIT_SPACE; }
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SeasonParams { pub id: u64, pub title: [u8; 32], pub kind: u8, pub historical_demo: bool, pub cutoff: i64, pub end_time: i64, pub resolve_deadline: i64, pub names: Vec<[u8; 32]> }
macro_rules! season_signer {
    ($s:expr, $id:ident, $b:ident, $seeds:ident) => {
        let $id = $s.id.to_le_bytes(); let $b = [$s.bump];
        let $seeds: &[&[u8]] = &[SEED_VERSION, SEED_SEASON, $id.as_ref(), $b.as_ref()];
    };
}
#[derive(Accounts)]
#[instruction(params: SeasonParams)]
pub struct InitializeSeason<'info> {
    #[account(mut)] pub authority: Signer<'info>,
    #[account(seeds = [SEED_VERSION, SEED_GLOBAL], bump = global.bump, has_one = authority, has_one = usdc_mint)] pub global: Account<'info, GlobalConfig>,
    pub usdc_mint: Account<'info, Mint>,
    #[account(init, payer = authority, space = SeasonMarket::LEN, seeds = [SEED_VERSION, SEED_SEASON, params.id.to_le_bytes().as_ref()], bump)] pub season: Box<Account<'info, SeasonMarket>>,
    #[account(init, payer = authority, seeds = [SEED_VERSION, SEED_VAULT, season.key().as_ref()], bump, token::mint = usdc_mint, token::authority = season)] pub vault: Account<'info, TokenAccount>,
    /// CHECK: immutable Switchboard feeds verified in handler
    pub primary_feed: UncheckedAccount<'info>,
    /// CHECK: independent immutable Switchboard feed verified in handler
    pub secondary_feed: UncheckedAccount<'info>,
    /// CHECK: locked authority, no instruction signs for it
    #[account(seeds = [SEED_VERSION, SEED_FEED_LOCK], bump)] pub feed_lock: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>, pub system_program: Program<'info, System>, pub rent: Sysvar<'info, Rent>,
}
pub fn initialize(ctx: Context<InitializeSeason>, p: SeasonParams) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(p.names.len() >= 2 && p.names.len() <= MAX_PARTICIPANTS && p.kind <= 1, AichainError::InvalidTeam);
    require!(p.cutoff > now && p.end_time >= p.cutoff, AichainError::InvalidTimeWindow);
    let window = p.resolve_deadline.checked_sub(p.end_time).ok_or(error!(AichainError::InvalidResolveDeadline))?;
    require!((MIN_RESOLVE_WINDOW..=MAX_RESOLVE_WINDOW).contains(&window), AichainError::InvalidResolveDeadline);
    for (i, name) in p.names.iter().enumerate() {
        require!(*name != [0; 32] && !p.names[..i].contains(name), AichainError::InvalidTeam);
    }
    let first = PullFeedView::load(&ctx.accounts.primary_feed.to_account_info())?;
    let second = PullFeedView::load(&ctx.accounts.secondary_feed.to_account_info())?;
    first.verify_immutable(&ctx.accounts.feed_lock.key())?; second.verify_immutable(&ctx.accounts.feed_lock.key())?;
    require!(ctx.accounts.primary_feed.key() != ctx.accounts.secondary_feed.key() && first.feed_hash != second.feed_hash, AichainError::SecondaryFeedDuplicate);
    let s = &mut ctx.accounts.season;
    s.id = p.id; s.title = p.title; s.kind = p.kind; s.historical_demo = p.historical_demo;
    s.authority = ctx.accounts.authority.key(); s.usdc_mint = ctx.accounts.usdc_mint.key();
    s.cutoff = p.cutoff; s.end_time = p.end_time; s.resolve_deadline = p.resolve_deadline;
    s.feeds = [ctx.accounts.primary_feed.key(), ctx.accounts.secondary_feed.key()]; s.hashes = [first.feed_hash, second.feed_hash];
    s.participants = p.names.into_iter().map(|name| SeasonParticipant { name, pool: 0 }).collect();
    s.status = MarketStatus::Open; s.bump = ctx.bumps.season; s.vault_bump = ctx.bumps.vault;
    Ok(())
}
#[derive(Accounts)]
pub struct PlaceSeasonBet<'info> {
    #[account(mut)] pub user: Signer<'info>,
    #[account(seeds = [SEED_VERSION, SEED_GLOBAL], bump = global.bump, constraint = global.usdc_mint == season.usdc_mint)] pub global: Account<'info, GlobalConfig>,
    #[account(mut, seeds = [SEED_VERSION, SEED_SEASON, season.id.to_le_bytes().as_ref()], bump = season.bump)] pub season: Box<Account<'info, SeasonMarket>>,
    #[account(mut, seeds = [SEED_VERSION, SEED_VAULT, season.key().as_ref()], bump = season.vault_bump)] pub vault: Account<'info, TokenAccount>,
    #[account(mut, constraint = user_ata.owner == user.key(), constraint = user_ata.mint == season.usdc_mint)] pub user_ata: Account<'info, TokenAccount>,
    #[account(init_if_needed, payer = user, space = SeasonReceipt::LEN, seeds = [SEED_VERSION, SEED_SEASON_RECEIPT, season.key().as_ref(), user.key().as_ref()], bump)] pub receipt: Account<'info, SeasonReceipt>,
    #[account(mut, seeds = [b"park", season.usdc_mint.as_ref()], bump = park.bump, seeds::program = yield_park_program.key(), constraint = global.yield_park == yield_park_program.key())] pub park: Account<'info, Park>,
    #[account(mut, seeds = [b"park-vault", park.key().as_ref()], bump = park.vault_bump, seeds::program = yield_park_program.key())] pub park_vault: Account<'info, TokenAccount>,
    /// CHECK: yield_park validates and initializes the position PDA
    #[account(mut)] pub position: UncheckedAccount<'info>,
    pub yield_park_program: Program<'info, YieldPark>, pub token_program: Program<'info, Token>, pub system_program: Program<'info, System>,
}
pub fn bet(ctx: Context<PlaceSeasonBet>, amount: u64, selected: u8) -> Result<()> {
    require!(amount >= MIN_BET, AichainError::BetTooSmall);
    require!(ctx.accounts.season.status == MarketStatus::Open, AichainError::MarketNotOpen);
    require!(Clock::get()?.unix_timestamp < ctx.accounts.season.cutoff, AichainError::BettingClosed);
    require!((selected as usize) < ctx.accounts.season.participants.len(), AichainError::InvalidTeam);
    let r = &mut ctx.accounts.receipt;
    if r.user == Pubkey::default() { r.user = ctx.accounts.user.key(); r.market = ctx.accounts.season.key(); r.selected = selected; r.bump = ctx.bumps.receipt; }
    require!(r.selected == selected && !r.claimed, AichainError::TeamMismatch);
    token::transfer(CpiContext::new(ctx.accounts.token_program.to_account_info(), Transfer { from: ctx.accounts.user_ata.to_account_info(), to: ctx.accounts.vault.to_account_info(), authority: ctx.accounts.user.to_account_info() }), amount)?;
    season_signer!(ctx.accounts.season, id, bump, seeds);
    yield_park::cpi::deposit(CpiContext::new_with_signer(ctx.accounts.yield_park_program.to_account_info(), yield_park::cpi::accounts::Deposit {
        owner: ctx.accounts.season.to_account_info(), payer: ctx.accounts.user.to_account_info(), park: ctx.accounts.park.to_account_info(), owner_ata: ctx.accounts.vault.to_account_info(), park_vault: ctx.accounts.park_vault.to_account_info(), position: ctx.accounts.position.to_account_info(), system_program: ctx.accounts.system_program.to_account_info(), token_program: ctx.accounts.token_program.to_account_info(),
    }, &[seeds]), amount)?;
    let data = ctx.accounts.position.try_borrow_data()?;
    let position = Position::try_deserialize(&mut &data[..])?;
    let s = &mut ctx.accounts.season;
    s.yield_shares = position.shares;
    s.total_pool = s.total_pool.checked_add(amount).ok_or(error!(AichainError::MathOverflow))?;
    s.participants[selected as usize].pool = s.participants[selected as usize].pool.checked_add(amount).ok_or(error!(AichainError::MathOverflow))?;
    r.amount = r.amount.checked_add(amount).ok_or(error!(AichainError::MathOverflow))?;
    Ok(())
}
#[derive(Accounts)]
pub struct SettleSeason<'info> {
    #[account(mut)] pub crank: Signer<'info>,
    #[account(seeds = [SEED_VERSION, SEED_GLOBAL], bump = global.bump, has_one = treasury, constraint = global.usdc_mint == season.usdc_mint)] pub global: Account<'info, GlobalConfig>,
    #[account(mut, seeds = [SEED_VERSION, SEED_SEASON, season.id.to_le_bytes().as_ref()], bump = season.bump)] pub season: Box<Account<'info, SeasonMarket>>,
    #[account(mut, seeds = [SEED_VERSION, SEED_VAULT, season.key().as_ref()], bump = season.vault_bump)] pub vault: Account<'info, TokenAccount>,
    #[account(mut, seeds = [SEED_VERSION, SEED_TREASURY, global.key().as_ref()], bump)] pub treasury: Account<'info, TokenAccount>,
    /// CHECK: feed address/hash/owner/authority verified on resolution
    pub primary_feed: UncheckedAccount<'info>,
    /// CHECK: feed address/hash/owner/authority verified on resolution
    pub secondary_feed: UncheckedAccount<'info>,
    /// CHECK: immutable feed authority
    #[account(seeds = [SEED_VERSION, SEED_FEED_LOCK], bump)] pub feed_lock: UncheckedAccount<'info>,
    #[account(mut, seeds = [b"park", season.usdc_mint.as_ref()], bump = park.bump, seeds::program = yield_park_program.key(), constraint = global.yield_park == yield_park_program.key())] pub park: Account<'info, Park>,
    #[account(mut, seeds = [b"park-vault", park.key().as_ref()], bump = park.vault_bump, seeds::program = yield_park_program.key())] pub park_vault: Account<'info, TokenAccount>,
    /// CHECK: position checked by yield_park
    #[account(mut)] pub position: UncheckedAccount<'info>,
    pub yield_park_program: Program<'info, YieldPark>, pub token_program: Program<'info, Token>,
}
pub fn settle(ctx: Context<SettleSeason>, expired: bool) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let s = &ctx.accounts.season;
    require!(s.status == MarketStatus::Open, AichainError::MarketFinal);
    let result = if expired {
        require!(now >= s.resolve_deadline, AichainError::DeadlineNotReached); None
    } else {
        require!(now >= s.end_time, AichainError::ResolveTooEarly);
        require!(now < s.resolve_deadline, AichainError::ResolveWindowClosed);
        let mut values = Vec::new();
        for (i, account) in [ctx.accounts.primary_feed.to_account_info(), ctx.accounts.secondary_feed.to_account_info()].iter().enumerate() {
            require_keys_eq!(account.key(), s.feeds[i], AichainError::OracleMismatch);
            let view = PullFeedView::load(account)?; view.verify_immutable(&ctx.accounts.feed_lock.key())?;
            require!(view.feed_hash == s.hashes[i], AichainError::FeedHashMismatch);
            let v = view.score_diff(s.end_time, MIN_ORACLE_SAMPLES)?;
            require!(v >= 0 && v <= s.participants.len() as i128, AichainError::InvalidOracleResult);
            values.push(v);
        }
        require!(values[0] == values[1], AichainError::SourcesDisagree);
        if values[0] == 0 { None } else { Some((values[0] - 1) as u8) }
    };
    season_signer!(ctx.accounts.season, id, bump, seeds);
    if ctx.accounts.season.yield_shares > 0 {
        yield_park::cpi::withdraw(CpiContext::new_with_signer(ctx.accounts.yield_park_program.to_account_info(), yield_park::cpi::accounts::Withdraw {
            owner: ctx.accounts.season.to_account_info(), park: ctx.accounts.park.to_account_info(), owner_ata: ctx.accounts.vault.to_account_info(), park_vault: ctx.accounts.park_vault.to_account_info(), position: ctx.accounts.position.to_account_info(), token_program: ctx.accounts.token_program.to_account_info(),
        }, &[seeds]), ctx.accounts.season.yield_shares)?;
        ctx.accounts.vault.reload()?;
    }
    if ctx.accounts.vault.amount < ctx.accounts.season.total_pool {
        let shortfall = ctx.accounts.season.total_pool - ctx.accounts.vault.amount;
        require!(shortfall <= PRINCIPAL_DUST_TOLERANCE, AichainError::PrincipalShortfall);
        yield_park::cpi::cover_principal_dust(CpiContext::new_with_signer(ctx.accounts.yield_park_program.to_account_info(), yield_park::cpi::accounts::CoverPrincipalDust {
            owner: ctx.accounts.season.to_account_info(), park: ctx.accounts.park.to_account_info(), owner_ata: ctx.accounts.vault.to_account_info(), park_vault: ctx.accounts.park_vault.to_account_info(), token_program: ctx.accounts.token_program.to_account_info(),
        }, &[seeds]), shortfall)?;
        ctx.accounts.vault.reload()?;
    }
    require!(ctx.accounts.vault.amount >= ctx.accounts.season.total_pool, AichainError::PrincipalShortfall);
    let surplus = ctx.accounts.vault.amount - ctx.accounts.season.total_pool;
    if surplus > 0 { token::transfer(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), Transfer { from: ctx.accounts.vault.to_account_info(), to: ctx.accounts.treasury.to_account_info(), authority: ctx.accounts.season.to_account_info() }, &[seeds]), surplus)?; }
    let s = &mut ctx.accounts.season;
    s.yield_shares = 0; s.yield_harvested = surplus; s.payout_pool = s.total_pool;
    if let Some(winner) = result.filter(|w| s.participants[*w as usize].pool > 0) { s.status = MarketStatus::Resolved; s.winner = Some(winner); }
    else { s.status = MarketStatus::Cancelled; s.cancel_reason = if expired { CANCEL_EXPIRED } else if result.is_none() { CANCEL_DRAW } else { CANCEL_NO_WINNERS }; }
    Ok(())
}
#[derive(Accounts)]
pub struct ClaimSeason<'info> {
    #[account(mut)] pub user: Signer<'info>,
    #[account(seeds = [SEED_VERSION, SEED_GLOBAL], bump = global.bump, has_one = treasury)] pub global: Account<'info, GlobalConfig>,
    #[account(mut, seeds = [SEED_VERSION, SEED_SEASON, season.id.to_le_bytes().as_ref()], bump = season.bump)] pub season: Box<Account<'info, SeasonMarket>>,
    #[account(mut, seeds = [SEED_VERSION, SEED_VAULT, season.key().as_ref()], bump = season.vault_bump)] pub vault: Account<'info, TokenAccount>,
    #[account(mut, constraint = user_ata.owner == user.key(), constraint = user_ata.mint == season.usdc_mint)] pub user_ata: Account<'info, TokenAccount>,
    #[account(mut, seeds = [SEED_VERSION, SEED_SEASON_RECEIPT, season.key().as_ref(), user.key().as_ref()], bump = receipt.bump, has_one = user, constraint = receipt.market == season.key())] pub receipt: Account<'info, SeasonReceipt>,
    #[account(mut, seeds = [SEED_VERSION, SEED_TREASURY, global.key().as_ref()], bump)] pub treasury: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}
pub fn claim(ctx: Context<ClaimSeason>) -> Result<()> {
    let s = &ctx.accounts.season; let r = &ctx.accounts.receipt;
    require!(!r.claimed, AichainError::AlreadyClaimed);
    let eligible = if s.status == MarketStatus::Cancelled { s.total_pool } else {
        require!(s.status == MarketStatus::Resolved, AichainError::MarketNotResolved);
        require!(s.winner == Some(r.selected), AichainError::NotWinner);
        s.participants[r.selected as usize].pool
    };
    let payout = pari_mutuel_payout(r.amount, eligible, s.payout_pool)?;
    season_signer!(ctx.accounts.season, id, bump, seeds);
    if payout > 0 { token::transfer(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), Transfer { from: ctx.accounts.vault.to_account_info(), to: ctx.accounts.user_ata.to_account_info(), authority: ctx.accounts.season.to_account_info() }, &[seeds]), payout)?; }
    ctx.accounts.receipt.claimed = true;
    ctx.accounts.season.claimed_stake = ctx.accounts.season.claimed_stake.checked_add(ctx.accounts.receipt.amount).ok_or(error!(AichainError::MathOverflow))?;
    if ctx.accounts.season.claimed_stake == eligible {
        ctx.accounts.vault.reload()?;
        if ctx.accounts.vault.amount > 0 { token::transfer(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), Transfer { from: ctx.accounts.vault.to_account_info(), to: ctx.accounts.treasury.to_account_info(), authority: ctx.accounts.season.to_account_info() }, &[seeds]), ctx.accounts.vault.amount)?; }
    }
    Ok(())
}
