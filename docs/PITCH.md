# FairOdds — pitch video script

The pitch video is not the demo video. It sells the team, the problem and the business; the demo video shows the product working. Deck: [`presentation/pitch.html`](../presentation/pitch.html), PDF: `presentation/FairOdds-pitch.pdf`.

- **Length:** about 2:50, hard cap 3:00.
- **Format:** founder on camera (or voice over the deck), English. Show a face for at least the opening and the team slide.
- **Before recording:** replace the `[Name] — [role]` placeholders on slide 13 and re-export the PDF.

## Script

| Slide | Time | Say |
|---|---|---|
| 1 Cover | 0:00–0:12 | Hi, I'm [name]. This is FairOdds: the sportsbook that can't ban you. You bet on real matches with your friends, straight from a link, and there is no bookmaker on the other side. |
| 2 Problem | 0:12–0:32 | Every bookmaker market has a margin built into the odds, so the house wins on average. And when a player wins too often, the bookmaker limits or closes the account, because the bookmaker is the one paying. Meanwhile most of us already bet with friends in group chats, and that runs on screenshots and IOUs. |
| 3 Insight | 0:32–0:50 | Our insight: when fans bet against each other in a shared pool, there is no house to protect. Winners are paid by the other side of the pool, so nobody loses money because you are good. The bet already lives in the group chat. On Solana, a link can carry the transaction, for a fraction of a cent. |
| 4 Product | 0:50–1:10 | So the flow is four steps. Pick a real match. Sign once: a new wallet even gets demo dollars in that same transaction. Send a challenge link to X, Telegram or WhatsApp; it opens the match with the other side selected. After the final whistle, the oracle reports the score and winners claim. |
| 5 Trust | 1:10–1:25 | Nobody holds the money and nobody picks the result. Stakes sit in a program vault. The score comes from a pinned Switchboard feed. Anyone can trigger settlement. Draws, empty pools and missing results refund everyone. |
| 6 Live | 1:25–1:40 | This is live on devnet today: twenty real-fixture markets, three settled by the oracle, eighty-six on-chain bets, and twenty out of twenty integration tests. Most bets so far are our own test wallets, and getting real fan groups in is our next milestone. |
| 7 Why now | 1:40–1:52 | Prediction markets went mainstream, but order books need market makers, so the long tail of matches stays empty. A pool only needs two people, and Actions make the bet slip a link. |
| 8 Market | 1:52–2:02 | Online sports betting is a market of tens of billions in yearly revenue, growing around ten percent a year. We start with something narrower: friend groups and fan communities that already bet with each other. |
| 9 Business | 2:02–2:20 | We only earn when someone wins: half a percent of the winners' profit, never the stake. That is about a quarter of a percent of volume, so ten million a month in volume is about twenty-five thousand in revenue. We can raise it to one or two percent and still be far below a bookmaker. Season pools are free and earn yield on locked principal. |
| 10 GTM | 2:20–2:32 | Growth is built in: every bet needs an opponent, so every bettor has a reason to send a challenge link. Next come creators hosting pools for their audience on match day. |
| 11 Competition | 2:32–2:40 | Bookmakers limit winners and order books need market makers. We are built for the bet between friends. |
| 12 Risks | 2:40–2:48 | We know regulation is the hard part: real-money pools only with licensed partners and geofencing, a free-to-play points mode elsewhere. Today it is devnet only. |
| 13 Team | 2:48–3:00 | We are [team], and we took second place at HackYeah with the first version. In the next three months: pools that users create for their own groups, a hundred real fan groups, and a mainnet pilot with a licensed partner. Thanks. |

## Interview preparation

Colosseum invites shortlisted teams to a 15-minute call. Questions they are likely to ask, with honest answers:

- **Is this gambling, and how do you launch legally?** Yes, real-money sports pools are gambling in most jurisdictions. Mainnet launch only with a licensed partner per market and geofencing; a points-based free-to-play mode where wagering is not allowed. Today it is devnet with demo tokens.
- **Pari-mutuel betting is over 100 years old. What is new?** The mechanism is old; the distribution is new. A pool that settles itself on-chain can be shared as a link in a group chat, with no operator holding the money and no reason to limit winners.
- **Who are your users and how many do you have?** Football fans who already bet with friends. On devnet we have 86 bets from 21 wallets, mostly our own test wallets. The next milestone is 100 real fan groups.
- **How do you make money?** 0.5% of winners' profit on match pools (about 0.25% of volume), yield on season pools, and later host fees for creator pools and a paid API. The fee is the main lever; even at 2% it stays far below a bookmaker margin.
- **What if one side of the pool is empty?** New markets cancel at kickoff and refund everyone. Challenge links exist to bring that counterparty.
- **What if the oracle is wrong or silent?** The feed's job hash is pinned at market creation. Seasons need two independent feeds to agree. With no result by the deadline, anyone can unlock full refunds; there is no admin override.
- **Who can create markets?** Today the market authority creates them from the fixture catalog. User-created pools for groups are the next feature; the oracle jobs are already generated from the catalog.
- **Why Solana?** Sub-cent fees for small bets between friends, Actions for link-based bet slips, and stablecoins for settlement.
- **What would you do with the accelerator?** Run the fan-group pilot, design the licensed mainnet path, and ship user-created pools on mobile.

## Facts to keep consistent

- Live demo: https://fairodds1338.vercel.app (devnet).
- Match fee: 0.5% of positive profit, paid at claim. Stakes and refunds are free. Legacy markets created before the fee policy stay at 0%.
- Season markets: 0% fee; `yield_park` is a funded demo reserve, not a deployed lending protocol.
- Both season markets are historical demos with a known result.
- On-chain numbers on 11 Oct 2026: 20 match markets, 3 oracle-settled, 86 bets from 21 wallets.
- Market size: $42–63B online sports betting revenue in 2025, depending on the source (Emergen Research, Market Research Future, Mordor Intelligence, Dataintelo).
