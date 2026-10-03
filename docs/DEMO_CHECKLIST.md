# Aichain — Demo checklist

## Before stage

- [ ] Devnet SOL on admin + 2 demo wallets  
- [ ] `deploy-config.json` present; app `.env.local` loaded  
- [ ] `yarn dev` running; Phantom set to Devnet  
- [ ] One Open market (NaVi vs FaZe) with time buffer for live bets  
- [ ] Solscan tabs ready (program id, last tx)  
- [ ] Backup MP4 ≤ 3 min recorded  

## Live path

1. Connect wallet → show market pools  
2. Wallet A bets Team A; Wallet B bets Team B → show 2 signatures  
3. Wait / skip to lock time → **Lock** → show inner CPI to yield_park  
4. Set oracle `0` or `1` → **Resolve**  
5. Winner **Claim** → explorer balance change  
6. 30s: DESIGN slide — intermediary removed at claim  

## Failure modes to narrate

- Oracle API pending → cannot resolve (good)  
- Wrong oracle account → tx fails (good)  
- Cancel (`2`) → refund 100%
