//! End-to-end tests of the deployed SBF binaries (target/deploy/*.so) in solana-program-test.
//! Switchboard feeds are injected as raw accounts derived from a real devnet PullFeed dump, and
//! the clock is warped instead of sleeping.
//!
//!   cargo-build-sbf --arch v0   (repo root, produces target/deploy/*.so)
//!   cargo test                  (this directory)

use aichain::errors::AichainError;
use aichain::state::{
    MarketState, MarketStatus, CANCEL_DRAW, CANCEL_EXPIRED, CANCEL_NO_WINNERS, FAUCET_AMOUNT,
    FAUCET_COOLDOWN, SEED_FAUCET, SEED_FEED_LOCK, SEED_GLOBAL, SEED_MARKET, SEED_MINT_AUTH,
    SEED_ORACLE2, SEED_RECEIPT, SEED_TREASURY, SEED_VAULT, SEED_VERSION, SOURCE_OPENLIGADB,
};
use aichain::switchboard::SWITCHBOARD_PROGRAM_ID;
use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
use anchor_spl::associated_token::{get_associated_token_address, spl_associated_token_account};
use anchor_spl::token::spl_token;
use solana_program_test::{BanksClientError, ProgramTest, ProgramTestContext};
use solana_sdk::{
    account::Account,
    clock::Clock,
    compute_budget::ComputeBudgetInstruction,
    instruction::{Instruction, InstructionError},
    program_pack::Pack,
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    system_instruction, system_program, sysvar,
    transaction::{Transaction, TransactionError},
};

const FEED_TEMPLATE: &[u8] = include_bytes!("../../programs/aichain/tests/fixtures/pull_feed.bin");
const SCALE: i128 = 1_000_000_000_000_000_000;
const SUBMISSION_SIZE: usize = 64;
const MAX_SUBMISSIONS: usize = 32;
const OFF_AUTHORITY: usize = 8 + 2048;
const OFF_FEED_HASH: usize = 8 + 2112;
const OFF_PERMIT_WRITE: usize = 8 + 2205;
const OFF_TIMESTAMPS: usize = 8 + 2944;
const USDC: u64 = 1_000_000;
const HOUR: i64 = 3600;
const APR_BPS: u16 = 2000;

type TxResult = Result<(), BanksClientError>;

fn custom(e: AichainError) -> u32 {
    e.into()
}

#[track_caller]
fn assert_custom(r: TxResult, want: u32) {
    match r {
        Ok(()) => panic!("expected error {want}, tx succeeded"),
        Err(e) => match e.unwrap() {
            TransactionError::InstructionError(_, InstructionError::Custom(c)) => {
                assert_eq!(c, want, "expected error {want}, got {c}")
            }
            other => panic!("expected error {want}, got {other:?}"),
        },
    }
}

#[track_caller]
fn assert_err(r: TxResult, expected: AichainError) {
    let want = custom(expected);
    match r {
        Ok(()) => panic!("expected error {want}, tx succeeded"),
        Err(e) => match e.unwrap() {
            TransactionError::InstructionError(_, InstructionError::Custom(c)) => {
                assert_eq!(c, want, "expected error {want}, got {c}")
            }
            other => panic!("expected error {want}, got {other:?}"),
        },
    }
}

#[derive(Clone, Copy)]
struct Feed {
    value: i128,
    timestamp: i64,
    authority_is_lock: bool,
    permit_write: bool,
    second: Option<i128>,
    /// A different job definition (e.g. the OpenLigaDB job instead of TheSportsDB).
    other_job: bool,
}

impl Feed {
    fn result(value: i128, timestamp: i64) -> Self {
        Self { value, timestamp, authority_is_lock: true, permit_write: false, second: None, other_job: false }
    }

    fn other_source(goals: i64, timestamp: i64) -> Self {
        Self { other_job: true, ..Self::diff(goals, timestamp) }
    }

    /// `home_score - away_score`, the only thing the feed ever reports.
    fn diff(goals: i64, timestamp: i64) -> Self {
        Self::result(goals as i128 * SCALE, timestamp)
    }

    fn data(&self, feed_lock: &Pubkey) -> Vec<u8> {
        let mut d = FEED_TEMPLATE.to_vec();
        for i in 0..MAX_SUBMISSIONS {
            let o = 8 + i * SUBMISSION_SIZE;
            if i > 0 {
                d[o..o + SUBMISSION_SIZE].fill(0);
                d[OFF_TIMESTAMPS + i * 8..OFF_TIMESTAMPS + i * 8 + 8].fill(0);
            }
        }
        let authority = if self.authority_is_lock { *feed_lock } else { Pubkey::new_unique() };
        d[OFF_AUTHORITY..OFF_AUTHORITY + 32].copy_from_slice(authority.as_ref());
        d[OFF_PERMIT_WRITE] = self.permit_write as u8;
        if self.other_job {
            d[OFF_FEED_HASH] ^= 0x5a;
        }
        d[8 + 48..8 + 64].copy_from_slice(&self.value.to_le_bytes());
        d[OFF_TIMESTAMPS..OFF_TIMESTAMPS + 8].copy_from_slice(&self.timestamp.to_le_bytes());
        if let Some(v) = self.second {
            let o = 8 + SUBMISSION_SIZE;
            d[o..o + 32].copy_from_slice(Pubkey::new_unique().as_ref());
            d[o + 48..o + 64].copy_from_slice(&v.to_le_bytes());
            d[OFF_TIMESTAMPS + 8..OFF_TIMESTAMPS + 16].copy_from_slice(&self.timestamp.to_le_bytes());
        }
        d
    }
}

#[derive(Clone, Copy)]
struct Times {
    start: i64,
    end: i64,
    deadline: i64,
}

struct Env {
    ctx: ProgramTestContext,
    mint: Pubkey,
    park: Pubkey,
    park_vault: Pubkey,
    global: Pubkey,
    treasury: Pubkey,
    feed_lock: Pubkey,
    nonce: u32,
    next_id: u64,
}

fn pda(seeds: &[&[u8]], program: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(seeds, program).0
}

fn market_pda(id: u64) -> Pubkey {
    pda(&[SEED_VERSION, SEED_MARKET, &id.to_le_bytes()], &aichain::ID)
}

fn mint_authority_pda() -> Pubkey {
    pda(&[SEED_VERSION, SEED_MINT_AUTH], &aichain::ID)
}

fn vault_pda(market: &Pubkey) -> Pubkey {
    pda(&[SEED_VERSION, SEED_VAULT, market.as_ref()], &aichain::ID)
}

fn secondary_pda(market: &Pubkey) -> Pubkey {
    pda(&[SEED_VERSION, SEED_ORACLE2, market.as_ref()], &aichain::ID)
}

fn receipt_pda(market: &Pubkey, user: &Pubkey) -> Pubkey {
    pda(&[SEED_VERSION, SEED_RECEIPT, market.as_ref(), user.as_ref()], &aichain::ID)
}

fn name(s: &str) -> [u8; 32] {
    let mut b = [0u8; 32];
    b[..s.len()].copy_from_slice(s.as_bytes());
    b
}

struct User {
    kp: Keypair,
    ata: Pubkey,
}

impl Env {
    async fn new() -> Self {
        std::env::set_var(
            "SBF_OUT_DIR",
            concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy"),
        );
        let mut pt = ProgramTest::default();
        pt.prefer_bpf(true);
        pt.add_program("aichain", aichain::ID, None);
        pt.add_program("yield_park", yield_park::ID, None);
        let ctx = pt.start_with_context().await;

        let feed_lock = pda(&[SEED_VERSION, SEED_FEED_LOCK], &aichain::ID);
        let global = pda(&[SEED_VERSION, SEED_GLOBAL], &aichain::ID);
        let treasury = pda(&[SEED_VERSION, SEED_TREASURY, global.as_ref()], &aichain::ID);
        let mut env = Self {
            ctx,
            mint: Pubkey::default(),
            park: Pubkey::default(),
            park_vault: Pubkey::default(),
            global,
            treasury,
            feed_lock,
            nonce: 0,
            next_id: 1,
        };

        let mint = Keypair::new();
        let admin = env.admin();
        let rent = env.ctx.banks_client.get_rent().await.unwrap();
        env.send(
            vec![
                system_instruction::create_account(
                    &admin,
                    &mint.pubkey(),
                    rent.minimum_balance(spl_token::state::Mint::LEN),
                    spl_token::state::Mint::LEN as u64,
                    &spl_token::ID,
                ),
                spl_token::instruction::initialize_mint2(&spl_token::ID, &mint.pubkey(), &admin, None, 6)
                    .unwrap(),
            ],
            &[&mint],
        )
        .await
        .unwrap();
        env.mint = mint.pubkey();
        env.park = pda(&[b"park", env.mint.as_ref()], &yield_park::ID);
        env.park_vault = pda(&[b"park-vault", env.park.as_ref()], &yield_park::ID);

        let ix = Instruction {
            program_id: yield_park::ID,
            accounts: yield_park::accounts::InitializePark {
                authority: admin,
                mint: env.mint,
                park: env.park,
                park_vault: env.park_vault,
                system_program: system_program::ID,
                token_program: spl_token::ID,
                rent: sysvar::rent::ID,
            }
            .to_account_metas(None),
            data: yield_park::instruction::InitializePark { apr_bps: APR_BPS }.data(),
        };
        env.send(vec![ix], &[]).await.unwrap();

        let admin_ata = env.token_account(&admin, 0).await;
        env.mint_to(&admin_ata, 1_000_000 * USDC).await;
        let ix = Instruction {
            program_id: yield_park::ID,
            accounts: yield_park::accounts::SeedReserve {
                authority: admin,
                park: env.park,
                mint: env.mint,
                authority_ata: admin_ata,
                park_vault: env.park_vault,
                token_program: spl_token::ID,
            }
            .to_account_metas(None),
            data: yield_park::instruction::SeedReserve { amount: 100_000 * USDC }.data(),
        };
        env.send(vec![ix], &[]).await.unwrap();

        let ix = Instruction {
            program_id: aichain::ID,
            accounts: aichain::accounts::InitializeGlobal {
                authority: admin,
                usdc_mint: env.mint,
                global: env.global,
                treasury: env.treasury,
                yield_park_program: yield_park::ID,
                system_program: system_program::ID,
                token_program: spl_token::ID,
                rent: sysvar::rent::ID,
            }
            .to_account_metas(None),
            data: aichain::instruction::InitializeGlobal { yield_park: yield_park::ID }.data(),
        };
        env.send(vec![ix], &[]).await.unwrap();
        env
    }

    fn admin(&self) -> Pubkey {
        self.ctx.payer.pubkey()
    }

    async fn send(&mut self, mut ixs: Vec<Instruction>, signers: &[&Keypair]) -> TxResult {
        // Unique compute limit per tx so retried identical instructions get distinct signatures.
        self.nonce += 1;
        ixs.insert(0, ComputeBudgetInstruction::set_compute_unit_limit(1_400_000 - self.nonce));
        let payer = self.ctx.payer.insecure_clone();
        let mut all: Vec<&Keypair> = vec![&payer];
        all.extend_from_slice(signers);
        let tx = Transaction::new_signed_with_payer(
            &ixs,
            Some(&payer.pubkey()),
            &all,
            self.ctx.last_blockhash,
        );
        self.ctx.banks_client.process_transaction(tx).await
    }

    async fn now(&mut self) -> i64 {
        self.ctx.banks_client.get_sysvar::<Clock>().await.unwrap().unix_timestamp
    }

    async fn warp(&mut self, ts: i64) {
        let mut clock = self.ctx.banks_client.get_sysvar::<Clock>().await.unwrap();
        assert!(ts >= clock.unix_timestamp, "clock only moves forward");
        clock.unix_timestamp = ts;
        self.ctx.set_sysvar(&clock);
    }

    async fn times(&mut self, open: i64, duration: i64, window: i64) -> Times {
        let start = self.now().await + open;
        let end = start + duration;
        Times { start, end, deadline: end + window }
    }

    fn put_feed(&mut self, feed: Pubkey, spec: Feed) {
        self.put_feed_raw(feed, spec.data(&self.feed_lock), SWITCHBOARD_PROGRAM_ID);
    }

    fn put_feed_raw(&mut self, feed: Pubkey, data: Vec<u8>, owner: Pubkey) {
        self.ctx.set_account(
            &feed,
            &Account { lamports: 1_000_000_000, data, owner, executable: false, rent_epoch: 0 }.into(),
        );
    }

    fn new_feed(&mut self, spec: Feed) -> Pubkey {
        let feed = Pubkey::new_unique();
        self.put_feed(feed, spec);
        feed
    }

    async fn token_account(&mut self, owner: &Pubkey, lamports_to_owner: u64) -> Pubkey {
        let acct = Keypair::new();
        let admin = self.admin();
        let rent = self.ctx.banks_client.get_rent().await.unwrap();
        let mut ixs = vec![
            system_instruction::create_account(
                &admin,
                &acct.pubkey(),
                rent.minimum_balance(spl_token::state::Account::LEN),
                spl_token::state::Account::LEN as u64,
                &spl_token::ID,
            ),
            spl_token::instruction::initialize_account3(&spl_token::ID, &acct.pubkey(), &self.mint, owner)
                .unwrap(),
        ];
        if lamports_to_owner > 0 {
            ixs.push(system_instruction::transfer(&admin, owner, lamports_to_owner));
        }
        self.send(ixs, &[&acct]).await.unwrap();
        acct.pubkey()
    }

    async fn mint_to(&mut self, dest: &Pubkey, amount: u64) {
        let admin = self.admin();
        let ix = spl_token::instruction::mint_to(&spl_token::ID, &self.mint, dest, &admin, &[], amount)
            .unwrap();
        self.send(vec![ix], &[]).await.unwrap();
    }

    async fn user(&mut self, usdc: u64) -> User {
        let kp = Keypair::new();
        let ata = self.token_account(&kp.pubkey(), 1_000_000_000).await;
        self.mint_to(&ata, usdc).await;
        User { kp, ata }
    }

    async fn balance(&mut self, ata: &Pubkey) -> u64 {
        let acct = self.ctx.banks_client.get_account(*ata).await.unwrap().unwrap();
        spl_token::state::Account::unpack(&acct.data).unwrap().amount
    }

    async fn market(&mut self, market: &Pubkey) -> MarketState {
        let acct = self.ctx.banks_client.get_account(*market).await.unwrap().unwrap();
        MarketState::try_deserialize(&mut acct.data.as_slice()).unwrap()
    }

    async fn create_market(&mut self, feed: Pubkey, t: Times) -> (Pubkey, TxResult) {
        let id = self.next_id;
        self.next_id += 1;
        let market = market_pda(id);
        let ix = Instruction {
            program_id: aichain::ID,
            accounts: aichain::accounts::InitializeMarket {
                authority: self.admin(),
                global: self.global,
                usdc_mint: self.mint,
                market,
                vault: vault_pda(&market),
                oracle_feed: feed,
                feed_lock: self.feed_lock,
                system_program: system_program::ID,
                token_program: spl_token::ID,
                rent: sysvar::rent::ID,
            }
            .to_account_metas(None),
            data: aichain::instruction::InitializeMarket {
                match_id: id,
                start_time: t.start,
                end_time: t.end,
                resolve_deadline: t.deadline,
                team_a: name("Team A"),
                team_b: name("Team B"),
            }
            .data(),
        };
        let r = self.send(vec![ix], &[]).await;
        (market, r)
    }

    async fn bet(&mut self, u: &User, market: Pubkey, amount: u64, team: u8) -> TxResult {
        let ix = Instruction {
            program_id: aichain::ID,
            accounts: aichain::accounts::PlaceBet {
                user: u.kp.pubkey(),
                market,
                vault: vault_pda(&market),
                user_ata: u.ata,
                receipt: receipt_pda(&market, &u.kp.pubkey()),
                system_program: system_program::ID,
                token_program: spl_token::ID,
            }
            .to_account_metas(None),
            data: aichain::instruction::PlaceBet { amount, team }.data(),
        };
        self.send(vec![ix], &[&u.kp]).await
    }

    fn position(&self, market: &Pubkey) -> Pubkey {
        pda(&[b"position", self.park.as_ref(), market.as_ref()], &yield_park::ID)
    }

    async fn lock(&mut self, market: Pubkey) -> TxResult {
        let ix = Instruction {
            program_id: aichain::ID,
            accounts: aichain::accounts::LockMarket {
                policy: pda(&[SEED_VERSION, b"policy", market.as_ref()], &aichain::ID),
                crank: self.admin(),
                global: self.global,
                market,
                vault: vault_pda(&market),
                park: self.park,
                park_vault: self.park_vault,
                position: self.position(&market),
                yield_park_program: yield_park::ID,
                system_program: system_program::ID,
                token_program: spl_token::ID,
            }
            .to_account_metas(None),
            data: aichain::instruction::LockMarket {}.data(),
        };
        self.send(vec![ix], &[]).await
    }

    async fn attach(&mut self, market: Pubkey, feed: Pubkey, source_ref: u64) -> TxResult {
        let ix = Instruction {
            program_id: aichain::ID,
            accounts: aichain::accounts::AttachSecondaryFeed {
                authority: self.admin(),
                global: self.global,
                market,
                secondary: secondary_pda(&market),
                secondary_feed: feed,
                feed_lock: self.feed_lock,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
            data: aichain::instruction::AttachSecondaryFeed { source: SOURCE_OPENLIGADB, source_ref }
                .data(),
        };
        self.send(vec![ix], &[]).await
    }

    async fn resolve(&mut self, market: Pubkey, feed: Pubkey, crank: Option<&Keypair>) -> TxResult {
        self.resolve_with(market, feed, None, crank).await
    }

    async fn resolve_with(
        &mut self,
        market: Pubkey,
        feed: Pubkey,
        secondary_feed: Option<Pubkey>,
        crank: Option<&Keypair>,
    ) -> TxResult {
        let crank_key = crank.map(|k| k.pubkey()).unwrap_or(self.admin());
        let ix = Instruction {
            program_id: aichain::ID,
            accounts: aichain::accounts::ResolveMarket {
                crank: crank_key,
                global: self.global,
                market,
                oracle_feed: feed,
                feed_lock: self.feed_lock,
                secondary: secondary_pda(&market),
                secondary_feed,
                vault: vault_pda(&market),
                treasury: self.treasury,
                park: self.park,
                park_vault: self.park_vault,
                position: self.position(&market),
                yield_park_program: yield_park::ID,
                token_program: spl_token::ID,
            }
            .to_account_metas(None),
            data: aichain::instruction::ResolveMarket {}.data(),
        };
        let signers: Vec<&Keypair> = crank.into_iter().collect();
        self.send(vec![ix], &signers).await
    }

    async fn cancel_expired(&mut self, market: Pubkey, crank: &Keypair) -> TxResult {
        let ix = Instruction {
            program_id: aichain::ID,
            accounts: aichain::accounts::CancelExpired {
                crank: crank.pubkey(),
                global: self.global,
                market,
                vault: vault_pda(&market),
                treasury: self.treasury,
                park: self.park,
                park_vault: self.park_vault,
                position: self.position(&market),
                yield_park_program: yield_park::ID,
                token_program: spl_token::ID,
            }
            .to_account_metas(None),
            data: aichain::instruction::CancelExpired {}.data(),
        };
        self.send(vec![ix], &[crank]).await
    }

    async fn claim(&mut self, u: &User, market: Pubkey) -> TxResult {
        let ix = Instruction {
            program_id: aichain::ID,
            accounts: aichain::accounts::ClaimWinnings {
                policy: pda(&[SEED_VERSION, b"policy", market.as_ref()], &aichain::ID),
                global: self.global,
                treasury: self.treasury,
                user: u.kp.pubkey(),
                market,
                vault: vault_pda(&market),
                user_ata: u.ata,
                receipt: receipt_pda(&market, &u.kp.pubkey()),
                token_program: spl_token::ID,
            }
            .to_account_metas(None),
            data: aichain::instruction::ClaimWinnings {}.data(),
        };
        self.send(vec![ix], &[&u.kp]).await
    }

    async fn refund(&mut self, u: &User, market: Pubkey) -> TxResult {
        let ix = Instruction {
            program_id: aichain::ID,
            accounts: aichain::accounts::Refund {
                user: u.kp.pubkey(),
                market,
                vault: vault_pda(&market),
                user_ata: u.ata,
                receipt: receipt_pda(&market, &u.kp.pubkey()),
                token_program: spl_token::ID,
            }
            .to_account_metas(None),
            data: aichain::instruction::Refund {}.data(),
        };
        self.send(vec![ix], &[&u.kp]).await
    }

    async fn harvest(&mut self, market: Pubkey, crank: &Keypair) -> TxResult {
        let ix = Instruction {
            program_id: aichain::ID,
            accounts: aichain::accounts::HarvestToTreasury {
                crank: crank.pubkey(),
                global: self.global,
                market,
                vault: vault_pda(&market),
                treasury: self.treasury,
                token_program: spl_token::ID,
            }
            .to_account_metas(None),
            data: aichain::instruction::HarvestToTreasury {}.data(),
        };
        self.send(vec![ix], &[crank]).await
    }

    async fn far_future(&mut self) -> i64 {
        self.now().await + 30 * 24 * HOUR
    }

    /// Mirrors setup-devnet: once the mint belongs to the PDA, only the faucet can create supply.
    async fn hand_mint_to_faucet(&mut self) {
        let admin = self.admin();
        let ix = spl_token::instruction::set_authority(
            &spl_token::ID,
            &self.mint,
            Some(&mint_authority_pda()),
            spl_token::instruction::AuthorityType::MintTokens,
            &admin,
            &[],
        )
        .unwrap();
        self.send(vec![ix], &[]).await.unwrap();
    }

    /// A wallet with lamports and nothing else, like a juror arriving with an empty Phantom.
    async fn empty_wallet(&mut self) -> Keypair {
        let kp = Keypair::new();
        let admin = self.admin();
        self.send(
            vec![system_instruction::transfer(&admin, &kp.pubkey(), 1_000_000_000)],
            &[],
        )
        .await
        .unwrap();
        kp
    }

    async fn faucet(&mut self, user: &Keypair) -> TxResult {
        let ix = Instruction {
            program_id: aichain::ID,
            accounts: aichain::accounts::FaucetMint {
                user: user.pubkey(),
                global: self.global,
                usdc_mint: self.mint,
                mint_authority: mint_authority_pda(),
                receipt: pda(
                    &[SEED_VERSION, SEED_FAUCET, user.pubkey().as_ref()],
                    &aichain::ID,
                ),
                user_ata: get_associated_token_address(&user.pubkey(), &self.mint),
                system_program: system_program::ID,
                token_program: spl_token::ID,
                associated_token_program: spl_associated_token_account::ID,
            }
            .to_account_metas(None),
            data: aichain::instruction::FaucetMint {}.data(),
        };
        self.send(vec![ix], &[user]).await
    }

    async fn withdraw_treasury(
        &mut self,
        authority: Option<&Keypair>,
        destination: Pubkey,
        amount: u64,
    ) -> TxResult {
        let key = authority.map(|k| k.pubkey()).unwrap_or(self.admin());
        let ix = Instruction {
            program_id: aichain::ID,
            accounts: aichain::accounts::WithdrawTreasury {
                authority: key,
                global: self.global,
                treasury: self.treasury,
                destination,
                token_program: spl_token::ID,
            }
            .to_account_metas(None),
            data: aichain::instruction::WithdrawTreasury { amount }.data(),
        };
        let signers: Vec<&Keypair> = authority.into_iter().collect();
        self.send(vec![ix], &signers).await
    }
    async fn policy(&mut self, market: Pubkey) -> TxResult {
        let ix = Instruction { program_id: aichain::ID, accounts: aichain::accounts::AttachMarketPolicy {
            authority: self.admin(), global:self.global, market,
            policy:pda(&[SEED_VERSION,b"policy",market.as_ref()],&aichain::ID), system_program:system_program::ID,
        }.to_account_metas(None), data:aichain::instruction::AttachMarketPolicy {}.data() };
        self.send(vec![ix], &[]).await
    }
    async fn create_season(&mut self, feeds:[Pubkey;2], t:Times) -> Pubkey {
        use aichain::instructions::seasons::*;
        let id=self.next_id;self.next_id+=1;
        let season=pda(&[SEED_VERSION,SEED_SEASON,&id.to_le_bytes()],&aichain::ID);
        let ix=Instruction {program_id:aichain::ID,accounts:aichain::accounts::InitializeSeason {
            authority:self.admin(),global:self.global,usdc_mint:self.mint,season,vault:vault_pda(&season),primary_feed:feeds[0],secondary_feed:feeds[1],feed_lock:self.feed_lock,token_program:spl_token::ID,system_program:system_program::ID,rent:sysvar::rent::ID,
        }.to_account_metas(None),data:aichain::instruction::InitializeSeason {params:SeasonParams {id,title:name("League champion"),kind:0,historical_demo:true,cutoff:t.start,end_time:t.end,resolve_deadline:t.deadline,names:vec![name("Alpha"),name("Beta"),name("Gamma")]}}.data()};
        self.send(vec![ix],&[]).await.unwrap();season
    }
    async fn season_bet(&mut self,user:&User,season:Pubkey,amount:u64,selected:u8)->TxResult {
        use aichain::instructions::seasons::*;
        let ix=Instruction {program_id:aichain::ID,accounts:aichain::accounts::PlaceSeasonBet {
            user:user.kp.pubkey(),global:self.global,season,vault:vault_pda(&season),user_ata:user.ata,
            receipt:pda(&[SEED_VERSION,SEED_SEASON_RECEIPT,season.as_ref(),user.kp.pubkey().as_ref()],&aichain::ID),park:self.park,park_vault:self.park_vault,position:self.position(&season),yield_park_program:yield_park::ID,token_program:spl_token::ID,system_program:system_program::ID,
        }.to_account_metas(None),data:aichain::instruction::PlaceSeasonBet {amount,selected}.data()};
        self.send(vec![ix],&[&user.kp]).await
    }
    async fn season_settle(&mut self,season:Pubkey,feeds:[Pubkey;2],expired:bool)->TxResult {
        let accounts=aichain::accounts::SettleSeason {crank:self.admin(),global:self.global,season,vault:vault_pda(&season),treasury:self.treasury,primary_feed:feeds[0],secondary_feed:feeds[1],feed_lock:self.feed_lock,park:self.park,park_vault:self.park_vault,position:self.position(&season),yield_park_program:yield_park::ID,token_program:spl_token::ID}.to_account_metas(None);
        let data=if expired {aichain::instruction::CancelSeason {}.data()}else{aichain::instruction::ResolveSeason {}.data()};
        self.send(vec![Instruction {program_id:aichain::ID,accounts,data}],&[]).await
    }
    async fn season_claim(&mut self,user:&User,season:Pubkey)->TxResult {
        use aichain::instructions::seasons::*;
        let ix=Instruction {program_id:aichain::ID,accounts:aichain::accounts::ClaimSeason {
            user:user.kp.pubkey(),global:self.global,season,vault:vault_pda(&season),user_ata:user.ata,
            receipt:pda(&[SEED_VERSION,SEED_SEASON_RECEIPT,season.as_ref(),user.kp.pubkey().as_ref()],&aichain::ID),treasury:self.treasury,token_program:spl_token::ID,
        }.to_account_metas(None),data:aichain::instruction::ClaimSeason {}.data()};
        self.send(vec![ix],&[&user.kp]).await
    }
    async fn season_state(&mut self,season:Pubkey)->aichain::instructions::seasons::SeasonMarket {
        let a=self.ctx.banks_client.get_account(season).await.unwrap().unwrap();
        aichain::instructions::seasons::SeasonMarket::try_deserialize(&mut a.data.as_slice()).unwrap()
    }

}

#[tokio::test]
async fn market_creation_rejects_untrusted_feeds() {
    let mut env = Env::new().await;
    let ts = env.far_future().await;
    let t = env.times(HOUR, 2 * HOUR, 24 * HOUR).await;

    let admin_owned = env.new_feed(Feed { authority_is_lock: false, ..Feed::diff(1, ts) });
    assert_err(env.create_market(admin_owned, t).await.1, AichainError::FeedAuthorityNotLocked);

    let writable = env.new_feed(Feed { permit_write: true, ..Feed::diff(1, ts) });
    assert_err(env.create_market(writable, t).await.1, AichainError::FeedWritableByAuthority);

    let foreign = Pubkey::new_unique();
    let data = Feed::diff(1, ts).data(&env.feed_lock);
    env.put_feed_raw(foreign, data, system_program::ID);
    assert_err(env.create_market(foreign, t).await.1, AichainError::FeedOwnerMismatch);

    let mut bad_queue = Feed::diff(1, ts).data(&env.feed_lock);
    bad_queue[8 + 2080..8 + 2112].copy_from_slice(Pubkey::new_unique().as_ref());
    let feed = Pubkey::new_unique();
    env.put_feed_raw(feed, bad_queue, SWITCHBOARD_PROGRAM_ID);
    assert_err(env.create_market(feed, t).await.1, AichainError::FeedQueueMismatch);

    let good = env.new_feed(Feed::diff(1, ts));
    let short = Times { deadline: t.end + 60, ..t };
    assert_err(env.create_market(good, short).await.1, AichainError::InvalidResolveDeadline);
    let long = Times { deadline: t.end + 31 * 24 * HOUR, ..t };
    assert_err(env.create_market(good, long).await.1, AichainError::InvalidResolveDeadline);
    let started = Times { start: env.now().await - 1, ..t };
    assert_err(env.create_market(good, started).await.1, AichainError::InvalidTimeWindow);

    let (market, r) = env.create_market(good, t).await;
    r.unwrap();
    let m = env.market(&market).await;
    assert_eq!(m.oracle_feed, good);
    assert_eq!(m.feed_hash[..], FEED_TEMPLATE[OFF_FEED_HASH..OFF_FEED_HASH + 32]);
    assert_eq!(m.resolve_deadline, t.deadline);
}

#[tokio::test]
async fn happy_path_resolves_from_pinned_feed_only() {
    let mut env = Env::new().await;
    let ts = env.far_future().await;
    let feed = env.new_feed(Feed::diff(1, ts));
    let other = env.new_feed(Feed::diff(-1, ts));
    let alice = env.user(10_000 * USDC).await;
    let bob = env.user(10_000 * USDC).await;
    let t = env.times(HOUR, 2 * HOUR, 24 * HOUR).await;
    let (market, r) = env.create_market(feed, t).await;
    r.unwrap();

    assert_err(env.bet(&alice, market, USDC - 1, 0).await, AichainError::BetTooSmall);
    assert_err(env.bet(&alice, market, USDC, 2).await, AichainError::InvalidTeam);
    env.bet(&alice, market, 100 * USDC, 0).await.unwrap();
    env.bet(&bob, market, 300 * USDC, 1).await.unwrap();
    assert_err(env.bet(&alice, market, USDC, 1).await, AichainError::TeamMismatch);
    assert_err(env.harvest(market, &bob.kp).await, AichainError::MarketNotResolved);
    assert_err(env.lock(market).await, AichainError::CannotLock);

    env.warp(t.start).await;
    assert_err(env.bet(&bob, market, 5 * USDC, 1).await, AichainError::BettingClosed);
    env.lock(market).await.unwrap();
    assert_eq!(env.balance(&vault_pda(&market)).await, 0, "principal moved to yield park");
    assert_err(env.resolve(market, feed, None).await, AichainError::ResolveTooEarly);

    env.warp(t.end).await;
    assert_err(env.resolve(market, other, None).await, AichainError::OracleMismatch);

    let treasury_before = env.balance(&env.treasury.clone()).await;
    let stranger = Keypair::new();
    let fund = system_instruction::transfer(&env.admin(), &stranger.pubkey(), 1_000_000_000);
    env.send(vec![fund], &[]).await.unwrap();
    env.resolve(market, feed, Some(&stranger)).await.unwrap();

    let m = env.market(&market).await;
    assert!(m.status == MarketStatus::Resolved);
    assert_eq!(m.winning_team, Some(0));
    assert_eq!(m.payout_pool, 400 * USDC);
    let yield_earned = env.balance(&env.treasury.clone()).await - treasury_before;
    assert!(yield_earned > 0, "2h at 20% APR on 400 USDC must yield something");
    assert_eq!(m.total_yield_harvested, yield_earned);

    assert_err(env.claim(&bob, market).await, AichainError::NotWinner);
    assert_err(env.refund(&alice, market).await, AichainError::MarketNotCancelled);
    assert_err(env.harvest(market, &bob.kp).await, AichainError::ObligationsOutstanding);
    let before = env.balance(&alice.ata).await;
    env.claim(&alice, market).await.unwrap();
    assert_eq!(env.balance(&alice.ata).await - before, 400 * USDC);
    assert_err(env.claim(&alice, market).await, AichainError::AlreadyClaimed);
    assert_err(env.resolve(market, feed, None).await, AichainError::MarketFinal);
    assert_eq!(env.market(&market).await.claimed_stake, 100 * USDC);
    assert_err(env.harvest(market, &bob.kp).await, AichainError::NothingToHarvest);
}

#[tokio::test]
async fn pro_rata_rounding_never_overpays_and_dust_is_released_last() {
    let mut env = Env::new().await;
    let ts = env.far_future().await;
    let feed = env.new_feed(Feed::diff(1, ts));
    let a1 = env.user(100 * USDC).await;
    let a2 = env.user(100 * USDC).await;
    let a3 = env.user(100 * USDC).await;
    let b1 = env.user(100 * USDC).await;
    let t = env.times(HOUR, HOUR, HOUR).await;
    let (market, r) = env.create_market(feed, t).await;
    r.unwrap();
    env.bet(&a1, market, 1_000_001, 0).await.unwrap();
    env.bet(&a2, market, 2_000_003, 0).await.unwrap();
    env.bet(&a3, market, 1_000_007, 0).await.unwrap();
    env.bet(&b1, market, 3_333_337, 1).await.unwrap();

    env.warp(t.end).await;
    env.resolve(market, feed, None).await.unwrap();
    let m = env.market(&market).await;
    let winners = 1_000_001u128 + 2_000_003 + 1_000_007;
    let mut paid = 0u64;
    for (u, stake) in [(&a1, 1_000_001u128), (&a2, 2_000_003), (&a3, 1_000_007)] {
        let before = env.balance(&u.ata).await;
        if paid == 0 {
            assert_err(env.harvest(market, &b1.kp).await, AichainError::ObligationsOutstanding);
        }
        env.claim(u, market).await.unwrap();
        let got = env.balance(&u.ata).await - before;
        assert_eq!(got as u128, stake * m.payout_pool as u128 / winners);
        paid += got;
    }
    assert!(paid <= m.payout_pool);
    let dust = m.payout_pool - paid;
    let vault = env.balance(&vault_pda(&market)).await;
    assert_eq!(vault, dust);
    if dust > 0 {
        let treasury_before = env.balance(&env.treasury.clone()).await;
        env.harvest(market, &b1.kp).await.unwrap();
        assert_eq!(env.balance(&env.treasury.clone()).await - treasury_before, dust);
    }
    assert_eq!(env.balance(&vault_pda(&market)).await, 0);
}

#[tokio::test]
async fn draw_cancels_and_refunds_exactly() {
    let mut env = Env::new().await;
    let ts = env.far_future().await;
    let feed = env.new_feed(Feed::diff(0, ts));
    let alice = env.user(100 * USDC).await;
    let bob = env.user(100 * USDC).await;
    let t = env.times(HOUR, HOUR, HOUR).await;
    let (market, r) = env.create_market(feed, t).await;
    r.unwrap();
    env.bet(&alice, market, 20 * USDC, 0).await.unwrap();
    env.bet(&bob, market, 30 * USDC, 1).await.unwrap();
    env.warp(t.end).await;
    env.resolve(market, feed, None).await.unwrap();

    let m = env.market(&market).await;
    assert!(m.status == MarketStatus::Cancelled);
    assert_eq!(m.cancel_reason, CANCEL_DRAW);
    assert_err(env.claim(&alice, market).await, AichainError::MarketNotResolved);
    let (a0, b0) = (env.balance(&alice.ata).await, env.balance(&bob.ata).await);
    env.refund(&alice, market).await.unwrap();
    env.refund(&bob, market).await.unwrap();
    assert_eq!(env.balance(&alice.ata).await - a0, 20 * USDC);
    assert_eq!(env.balance(&bob.ata).await - b0, 30 * USDC);
    assert_err(env.refund(&bob, market).await, AichainError::AlreadyClaimed);
}

#[tokio::test]
async fn empty_winning_side_cancels_instead_of_stranding_pool() {
    let mut env = Env::new().await;
    let ts = env.far_future().await;
    let feed = env.new_feed(Feed::diff(1, ts));
    let bob = env.user(100 * USDC).await;
    let t = env.times(HOUR, HOUR, HOUR).await;
    let (market, r) = env.create_market(feed, t).await;
    r.unwrap();
    env.bet(&bob, market, 40 * USDC, 1).await.unwrap();
    env.warp(t.end).await;
    env.resolve(market, feed, None).await.unwrap();
    let m = env.market(&market).await;
    assert!(m.status == MarketStatus::Cancelled);
    assert_eq!(m.cancel_reason, CANCEL_NO_WINNERS);
    let b0 = env.balance(&bob.ata).await;
    env.refund(&bob, market).await.unwrap();
    assert_eq!(env.balance(&bob.ata).await - b0, 40 * USDC);
}

#[tokio::test]
async fn bad_oracle_data_is_rejected() {
    let mut env = Env::new().await;
    let ts = env.far_future().await;
    let t = env.times(HOUR, HOUR, 24 * HOUR).await;

    // A value that is not a whole number of goals: nothing the real job can ever produce.
    let garbage = env.new_feed(Feed::result(SCALE / 2, ts));
    let disagree = env.new_feed(Feed { second: Some(-SCALE), ..Feed::diff(1, ts) });
    let stale = env.new_feed(Feed::diff(1, ts));
    let swapped = env.new_feed(Feed::diff(1, ts));
    let unlocked_later = env.new_feed(Feed::diff(1, ts));
    let mut markets = Vec::new();
    for feed in [garbage, disagree, stale, swapped, unlocked_later] {
        let (m, r) = env.create_market(feed, t).await;
        r.unwrap();
        markets.push(m);
    }

    // Result that landed before the match ended must not count.
    env.put_feed(stale, Feed::diff(1, t.end - 1));
    // Job definition changed after the market pinned it.
    let mut data = Feed::diff(1, ts).data(&env.feed_lock);
    data[OFF_FEED_HASH] ^= 0xff;
    env.put_feed_raw(swapped, data, SWITCHBOARD_PROGRAM_ID);
    // Authority regained control of the feed.
    env.put_feed(unlocked_later, Feed { authority_is_lock: false, ..Feed::diff(1, ts) });

    env.warp(t.end).await;
    assert_err(env.resolve(markets[0], garbage, None).await, AichainError::InvalidOracleResult);
    assert_err(env.resolve(markets[1], disagree, None).await, AichainError::OracleDisagreement);
    assert_err(env.resolve(markets[2], stale, None).await, AichainError::FeedStale);
    assert_err(env.resolve(markets[3], swapped, None).await, AichainError::FeedHashMismatch);
    assert_err(env.resolve(markets[4], unlocked_later, None).await, AichainError::FeedAuthorityNotLocked);
}

#[tokio::test]
async fn anyone_can_cancel_after_deadline_and_everyone_is_refunded() {
    let mut env = Env::new().await;
    let ts = env.far_future().await;
    let feed = env.new_feed(Feed::diff(1, ts));
    let alice = env.user(100 * USDC).await;
    let bob = env.user(100 * USDC).await;
    let t = env.times(HOUR, HOUR, 6 * HOUR).await;
    let (market, r) = env.create_market(feed, t).await;
    r.unwrap();
    env.bet(&alice, market, 50 * USDC, 0).await.unwrap();
    env.bet(&bob, market, 70 * USDC, 1).await.unwrap();
    env.warp(t.start).await;
    env.lock(market).await.unwrap();

    env.warp(t.end).await;
    assert_err(env.cancel_expired(market, &bob.kp).await, AichainError::DeadlineNotReached);
    env.warp(t.deadline).await;
    assert_err(env.resolve(market, feed, None).await, AichainError::ResolveWindowClosed);

    env.cancel_expired(market, &bob.kp).await.unwrap();
    let m = env.market(&market).await;
    assert!(m.status == MarketStatus::Cancelled);
    assert_eq!(m.cancel_reason, CANCEL_EXPIRED);
    assert_eq!(m.payout_pool, 120 * USDC);
    assert_err(env.cancel_expired(market, &bob.kp).await, AichainError::MarketFinal);

    let (a0, b0) = (env.balance(&alice.ata).await, env.balance(&bob.ata).await);
    env.refund(&alice, market).await.unwrap();
    env.refund(&bob, market).await.unwrap();
    assert_eq!(env.balance(&alice.ata).await - a0, 50 * USDC);
    assert_eq!(env.balance(&bob.ata).await - b0, 70 * USDC);
    assert_eq!(env.market(&market).await.claimed_stake, 120 * USDC);
    assert_err(env.harvest(market, &alice.kp).await, AichainError::NothingToHarvest);
}

#[tokio::test]
async fn two_agreeing_sources_resolve_and_secondary_is_mandatory_once_attached() {
    let mut env = Env::new().await;
    let ts = env.far_future().await;
    let feed = env.new_feed(Feed::diff(2, ts));
    let second = env.new_feed(Feed::other_source(2, ts));
    let impostor = env.new_feed(Feed::other_source(2, ts));
    let alice = env.user(100 * USDC).await;
    let bob = env.user(100 * USDC).await;
    let t = env.times(HOUR, HOUR, 6 * HOUR).await;
    let (market, r) = env.create_market(feed, t).await;
    r.unwrap();
    env.attach(market, second, 83191).await.unwrap();
    assert!(env.attach(market, impostor, 1).await.is_err(), "secondary is pinned once");

    env.bet(&alice, market, 30 * USDC, 0).await.unwrap();
    env.bet(&bob, market, 10 * USDC, 1).await.unwrap();
    env.warp(t.end).await;

    assert_err(env.resolve(market, feed, None).await, AichainError::SecondaryFeedMismatch);
    assert_err(
        env.resolve_with(market, feed, Some(impostor), None).await,
        AichainError::SecondaryFeedMismatch,
    );
    env.resolve_with(market, feed, Some(second), None).await.unwrap();
    let m = env.market(&market).await;
    assert!(m.status == MarketStatus::Resolved);
    assert_eq!(m.winning_team, Some(0));
}

#[tokio::test]
async fn sources_with_different_scores_never_settle_and_bettors_get_refunds() {
    let mut env = Env::new().await;
    let ts = env.far_future().await;
    // Same winner, different margin: still a disagreement about what happened.
    let feed = env.new_feed(Feed::diff(1, ts));
    let second = env.new_feed(Feed::other_source(2, ts));
    let alice = env.user(100 * USDC).await;
    let bob = env.user(100 * USDC).await;
    let t = env.times(HOUR, HOUR, 6 * HOUR).await;
    let (market, r) = env.create_market(feed, t).await;
    r.unwrap();
    env.attach(market, second, 7).await.unwrap();
    env.bet(&alice, market, 25 * USDC, 0).await.unwrap();
    env.bet(&bob, market, 15 * USDC, 1).await.unwrap();
    env.warp(t.start).await;
    env.lock(market).await.unwrap();

    env.warp(t.end).await;
    assert_err(env.resolve_with(market, feed, Some(second), None).await, AichainError::SourcesDisagree);
    // A secondary that has not reported since the final whistle blocks resolution too.
    env.put_feed(second, Feed::other_source(1, t.end - 1));
    assert_err(env.resolve_with(market, feed, Some(second), None).await, AichainError::FeedStale);

    env.warp(t.deadline).await;
    env.cancel_expired(market, &bob.kp).await.unwrap();
    let m = env.market(&market).await;
    assert!(m.status == MarketStatus::Cancelled);
    assert_eq!(m.cancel_reason, CANCEL_EXPIRED);
    let (a0, b0) = (env.balance(&alice.ata).await, env.balance(&bob.ata).await);
    env.refund(&alice, market).await.unwrap();
    env.refund(&bob, market).await.unwrap();
    assert_eq!(env.balance(&alice.ata).await - a0, 25 * USDC);
    assert_eq!(env.balance(&bob.ata).await - b0, 15 * USDC);
}

#[tokio::test]
async fn secondary_feed_cannot_change_the_rules_under_existing_bets() {
    let mut env = Env::new().await;
    let ts = env.far_future().await;
    let alice = env.user(100 * USDC).await;
    let t = env.times(HOUR, HOUR, 6 * HOUR).await;

    let feed = env.new_feed(Feed::diff(1, ts));
    let (with_bet, r) = env.create_market(feed, t).await;
    r.unwrap();
    env.bet(&alice, with_bet, 5 * USDC, 0).await.unwrap();
    let late = env.new_feed(Feed::other_source(-1, ts));
    assert_err(env.attach(with_bet, late, 1).await, AichainError::MarketHasBets);

    let feed2 = env.new_feed(Feed::diff(1, ts));
    let (started, r) = env.create_market(feed2, t).await;
    r.unwrap();
    let fresh_feed = env.new_feed(Feed::diff(1, ts));
    let (fresh, r) = env.create_market(fresh_feed, t).await;
    r.unwrap();

    assert_err(env.attach(fresh, fresh_feed, 1).await, AichainError::SecondaryFeedDuplicate);
    let same_job = env.new_feed(Feed::diff(1, ts));
    assert_err(env.attach(fresh, same_job, 1).await, AichainError::SecondaryFeedDuplicate);
    let unlocked = env.new_feed(Feed { authority_is_lock: false, ..Feed::other_source(1, ts) });
    assert_err(env.attach(fresh, unlocked, 1).await, AichainError::FeedAuthorityNotLocked);

    env.warp(t.start).await;
    let after_start = env.new_feed(Feed::other_source(1, ts));
    assert_err(env.attach(started, after_start, 1).await, AichainError::MarketHasBets);

    // Markets without a secondary keep settling from their single feed.
    env.warp(t.end).await;
    env.resolve(with_bet, feed, None).await.unwrap();
    assert!(env.market(&with_bet).await.status == MarketStatus::Resolved);
}

#[tokio::test]
async fn faucet_serves_empty_wallets_once_a_day_and_nobody_else_can_mint() {
    let mut env = Env::new().await;
    env.hand_mint_to_faucet().await;

    // Whoever held the mint before cannot create supply any more.
    let admin_ata = env.token_account(&env.admin(), 0).await;
    assert!(
        env.send(
            vec![spl_token::instruction::mint_to(
                &spl_token::ID,
                &env.mint,
                &admin_ata,
                &env.admin(),
                &[],
                1,
            )
            .unwrap()],
            &[],
        )
        .await
        .is_err(),
        "old mint authority must be powerless"
    );

    let juror = env.empty_wallet().await;
    let ata = get_associated_token_address(&juror.pubkey(), &env.mint);
    env.faucet(&juror).await.unwrap();
    assert_eq!(env.balance(&ata).await, FAUCET_AMOUNT);

    assert_err(env.faucet(&juror).await, AichainError::FaucetCooldown);

    let now = env.now().await;
    env.warp(now + FAUCET_COOLDOWN - 1).await;
    assert_err(env.faucet(&juror).await, AichainError::FaucetCooldown);
    env.warp(now + FAUCET_COOLDOWN).await;
    env.faucet(&juror).await.unwrap();
    assert_eq!(env.balance(&ata).await, 2 * FAUCET_AMOUNT);

    // The limit is per wallet, so a second juror is served immediately.
    let other = env.empty_wallet().await;
    env.faucet(&other).await.unwrap();
    assert_eq!(
        env.balance(&get_associated_token_address(&other.pubkey(), &env.mint)).await,
        FAUCET_AMOUNT
    );
}

#[tokio::test]
async fn only_the_protocol_authority_may_drain_the_treasury() {
    let mut env = Env::new().await;
    let ts = env.far_future().await;
    let feed = env.new_feed(Feed::diff(1, ts));
    let alice = env.user(1_000 * USDC).await;
    let bob = env.user(1_000 * USDC).await;
    let t = env.times(HOUR, 2 * HOUR, 24 * HOUR).await;
    let (market, r) = env.create_market(feed, t).await;
    r.unwrap();
    env.bet(&alice, market, 400 * USDC, 0).await.unwrap();
    env.bet(&bob, market, 400 * USDC, 1).await.unwrap();
    env.warp(t.start).await;
    env.lock(market).await.unwrap();
    env.warp(t.end).await;
    env.resolve(market, feed, None).await.unwrap();

    let yield_earned = env.balance(&env.treasury.clone()).await;
    assert!(yield_earned > 0, "treasury should hold the harvested yield");

    let stranger = env.user(0).await;
    // `has_one = authority` fails before the handler runs: Anchor's ConstraintHasOne.
    assert_custom(
        env.withdraw_treasury(Some(&stranger.kp), stranger.ata, 1).await,
        2001,
    );
    assert_eq!(env.balance(&env.treasury.clone()).await, yield_earned);

    let payout = env.token_account(&env.admin(), 0).await;
    assert_err(
        env.withdraw_treasury(None, payout, yield_earned + 1).await,
        AichainError::InsufficientTreasury,
    );
    assert_err(env.withdraw_treasury(None, payout, 0).await, AichainError::ZeroAmount);

    env.withdraw_treasury(None, payout, yield_earned).await.unwrap();
    assert_eq!(env.balance(&payout).await, yield_earned);
    assert_eq!(env.balance(&env.treasury.clone()).await, 0);

    // Bettor money was never in reach: the winning side can still be paid in full.
    let before = env.balance(&alice.ata).await;
    env.claim(&alice, market).await.unwrap();
    assert_eq!(env.balance(&alice.ata).await - before, 800 * USDC);
}

#[tokio::test]
async fn lock_cannot_happen_after_deadline() {
    let mut env = Env::new().await;
    let ts = env.far_future().await;
    let feed = env.new_feed(Feed::diff(1, ts));
    let alice = env.user(100 * USDC).await;
    let t = env.times(HOUR, HOUR, HOUR).await;
    let (market, r) = env.create_market(feed, t).await;
    r.unwrap();
    env.bet(&alice, market, 10 * USDC, 0).await.unwrap();
    env.warp(t.deadline).await;
    assert!(env.lock(market).await.is_err());
    env.cancel_expired(market, &alice.kp).await.unwrap();
    let a0 = env.balance(&alice.ata).await;
    env.refund(&alice, market).await.unwrap();
    assert_eq!(env.balance(&alice.ata).await - a0, 10 * USDC);
}


#[tokio::test]
async fn new_match_fee_only_taxes_profit_and_policy_cannot_change_after_bets() {
    let mut env=Env::new().await;let ts=env.far_future().await;
    let feed=env.new_feed(Feed::diff(1,ts));let t=env.times(HOUR,HOUR,HOUR).await;
    let (market,r)=env.create_market(feed,t).await;r.unwrap();env.policy(market).await.unwrap();
    let alice=env.user(1000*USDC).await;let bob=env.user(1000*USDC).await;
    env.bet(&alice,market,100*USDC,0).await.unwrap();env.bet(&bob,market,300*USDC,1).await.unwrap();
    env.warp(t.end).await;env.lock(market).await.unwrap();env.resolve(market,feed,None).await.unwrap();
    let before=env.balance(&alice.ata).await;let treasury=env.balance(&env.treasury.clone()).await;
    env.claim(&alice,market).await.unwrap();assert_eq!(env.balance(&alice.ata).await-before,398_500_000);
    assert_eq!(env.balance(&env.treasury.clone()).await-treasury,1_500_000);
    assert_err(env.claim(&alice,market).await,AichainError::AlreadyClaimed);
    let later=env.times(HOUR,HOUR,HOUR).await;let (legacy,r)=env.create_market(feed,later).await;r.unwrap();
    env.bet(&alice,legacy,USDC,0).await.unwrap();assert_err(env.policy(legacy).await,AichainError::MarketHasBets);
}
#[tokio::test]
async fn opted_in_one_sided_pool_refunds_at_kickoff_without_oracle() {
    let mut env=Env::new().await;let ts=env.far_future().await;let feed=env.new_feed(Feed::diff(1,ts));let t=env.times(HOUR,HOUR,HOUR).await;
    let (market,r)=env.create_market(feed,t).await;r.unwrap();env.policy(market).await.unwrap();let u=env.user(100*USDC).await;
    env.bet(&u,market,37*USDC,0).await.unwrap();env.warp(t.start).await;env.lock(market).await.unwrap();
    let state=env.market(&market).await;assert!(state.status==MarketStatus::Cancelled);assert_eq!(state.cancel_reason,aichain::state::CANCEL_ONE_SIDED);
    let before=env.balance(&u.ata).await;env.refund(&u,market).await.unwrap();assert_eq!(env.balance(&u.ata).await-before,37*USDC);
}
#[tokio::test]
async fn season_three_sides_deposit_immediately_and_winner_pays_no_fee() {
    let mut env=Env::new().await;let ts=env.far_future().await;let feeds=[env.new_feed(Feed::diff(2,ts)),env.new_feed(Feed::other_source(2,ts))];let t=env.times(HOUR,24*HOUR,HOUR).await;
    let s=env.create_season(feeds,t).await;let a=env.user(1000*USDC).await;let b=env.user(1000*USDC).await;let c=env.user(1000*USDC).await;
    env.season_bet(&a,s,100*USDC,0).await.unwrap();assert_eq!(env.balance(&vault_pda(&s)).await,0);
    env.season_bet(&b,s,200*USDC,1).await.unwrap();env.season_bet(&c,s,300*USDC,2).await.unwrap();
    assert_err(env.season_bet(&a,s,USDC,1).await,AichainError::TeamMismatch);
    assert_err(env.season_settle(s,feeds,false).await,AichainError::ResolveTooEarly);
    env.warp(t.end).await;env.season_settle(s,feeds,false).await.unwrap();let state=env.season_state(s).await;assert_eq!(state.winner,Some(1));assert!(state.yield_harvested>0);
    assert_err(env.season_claim(&a,s).await,AichainError::NotWinner);
    let before=env.balance(&b.ata).await;env.season_claim(&b,s).await.unwrap();assert_eq!(env.balance(&b.ata).await-before,600*USDC);
    assert_err(env.season_claim(&b,s).await,AichainError::AlreadyClaimed);
}
#[tokio::test]
async fn season_disagreement_and_pending_result_wait_then_refund_on_deadline() {
    let mut env=Env::new().await;let ts=env.far_future().await;let feeds=[env.new_feed(Feed::diff(1,ts)),env.new_feed(Feed::other_source(2,ts))];let t=env.times(HOUR,HOUR,HOUR).await;
    let s=env.create_season(feeds,t).await;let u=env.user(100*USDC).await;env.season_bet(&u,s,17*USDC,0).await.unwrap();env.warp(t.end).await;
    assert_err(env.season_settle(s,feeds,false).await,AichainError::SourcesDisagree);
    env.put_feed(feeds[0],Feed::diff(-1,ts));assert_err(env.season_settle(s,feeds,false).await,AichainError::InvalidOracleResult);
    env.warp(t.deadline).await;env.season_settle(s,feeds,true).await.unwrap();let before=env.balance(&u.ata).await;env.season_claim(&u,s).await.unwrap();assert_eq!(env.balance(&u.ata).await-before,17*USDC);
}
#[tokio::test]
async fn season_tie_or_empty_winner_returns_stakes_without_fee() {
    for result in [0,3] {
        let mut env=Env::new().await;let ts=env.far_future().await;let feeds=[env.new_feed(Feed::diff(result,ts)),env.new_feed(Feed::other_source(result,ts))];let t=env.times(HOUR,HOUR,HOUR).await;
        let s=env.create_season(feeds,t).await;let u=env.user(100*USDC).await;env.season_bet(&u,s,11*USDC,0).await.unwrap();env.warp(t.end).await;
        env.season_settle(s,feeds,false).await.unwrap();assert!(env.season_state(s).await.status==MarketStatus::Cancelled);
        let before=env.balance(&u.ata).await;env.season_claim(&u,s).await.unwrap();assert_eq!(env.balance(&u.ata).await-before,11*USDC);
    }
}

#[tokio::test]
async fn reserve_dust_cannot_be_drained_by_a_keypair_owned_by_settlement_program() {
    let mut env=Env::new().await;let attacker=Keypair::new();let ata=env.token_account(&attacker.pubkey(),1_000_000_000).await;
    let mut data=anchor_lang::solana_program::hash::hash(b"account:MarketState").to_bytes()[..8].to_vec();data.extend_from_slice(&1u64.to_le_bytes());
    env.ctx.set_account(&attacker.pubkey(),&Account {lamports:1_000_000_000,data,owner:aichain::ID,executable:false,rent_epoch:0}.into());
    let ix=Instruction {program_id:yield_park::ID,accounts:yield_park::accounts::CoverPrincipalDust {owner:attacker.pubkey(),park:env.park,owner_ata:ata,park_vault:env.park_vault,token_program:spl_token::ID}.to_account_metas(None),data:yield_park::instruction::CoverPrincipalDust {amount:1000}.data()};
    assert_custom(env.send(vec![ix],&[&attacker]).await,yield_park::errors::YieldError::InvalidSettlementOwner.into());
}

#[tokio::test]
async fn season_cutoff_and_pinned_fresh_feeds_cannot_be_bypassed() {
    let mut env=Env::new().await;let ts=env.far_future().await;
    let feeds=[env.new_feed(Feed::diff(1,ts)),env.new_feed(Feed::other_source(1,ts))];
    let t=env.times(HOUR,HOUR,HOUR).await;let s=env.create_season(feeds,t).await;
    let user=env.user(100*USDC).await;env.season_bet(&user,s,10*USDC,0).await.unwrap();
    env.warp(t.start).await;
    assert_err(env.season_bet(&user,s,USDC,0).await,AichainError::BettingClosed);
    env.warp(t.end).await;
    assert_err(env.season_settle(s,[feeds[1],feeds[0]],false).await,AichainError::OracleMismatch);
    env.put_feed(feeds[0],Feed::diff(1,t.end-1));
    assert_err(env.season_settle(s,feeds,false).await,AichainError::FeedStale);
    env.put_feed(feeds[0],Feed::other_source(1,ts));
    assert_err(env.season_settle(s,feeds,false).await,AichainError::FeedHashMismatch);
    env.put_feed(feeds[0],Feed::diff(1,ts));
    env.season_settle(s,feeds,false).await.unwrap();
    let before=env.balance(&user.ata).await;env.season_claim(&user,s).await.unwrap();
    assert_eq!(env.balance(&user.ata).await-before,10*USDC);
}
