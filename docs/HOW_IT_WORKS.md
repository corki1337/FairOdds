# How a bet settles

1. Authority creates a future match with immutable sports feed(s), or a season with two independent feeds and reviewed participant mapping.
2. A wallet signs a demo-USDC stake before cutoff. Its receipt fixes one side/participant; top-ups are allowed. Indicative odds change with the shared pool.
3. Matches park at kickoff; new one-sided matches instead enable full refunds. Seasons park every stake immediately.
4. After the expected end, anyone can request signed Switchboard updates and settle. Seasons require final league data and identical participant ordinals from both providers. Disagreement waits; the deadline enables cancellation.
5. Eligible winners claim pro rata principal. New matches deduct 0.5% only from positive profit; legacy matches/seasons deduct zero. Losing receipts cannot claim winnings. Refunds have no protocol fee. Already claimed receipts cannot withdraw twice.
6. Reserve surplus goes to treasury. Demo yield comes from a funded park reserve, not a live external lending integration. SOL network fees still apply.

A canceled market still requires each bettor to claim their refund. The keeper changes on-chain status but does not hold user signing keys. Known-result historical seasons are labeled demonstrations, not live competitions.
