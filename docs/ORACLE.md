# Oracle contract

Feeds use Switchboard On-Demand on devnet; queue/program identifiers are in `app/src/lib/switchboard.ts`. Jobs are content-addressed on Crossbar. Feed creation transfers authority to the aichain `feed-lock` PDA, disables authority writes and pins hashes/addresses. Program checks ownership, discriminator, authority, queue/hash and sample time/quorum. Immutable oracle configuration does not remove upgrade-authority trust.

For matches: TheSportsDB home minus away; new jobs gate on FT. OpenLigaDB secondary requires finished + resultTypeID 2. PandaScore new jobs cache opponent IDs and read matching team_id scores only after finished/non-forfeit. Provider token is a runtime placeholder, not a stored secret. Historical football hashes retain original job semantics; unknown pinned hashes are held rather than overwritten.

For seasons: each provider maps its own team/player ID to a fixed one-based ordinal. Full double round-robin finality is required before a result is accepted; pending/unmapped=-1, final scorer tie=0. Both pinned feeds must agree. The full principal is refunded after oracle deadline even if a provider never becomes available.

Keeper additionally polls every configured result provider and records disputes in durable anomalies. This protects its own resolve path, not every permissionless caller of single-feed matches. It cannot veto a matching valid on-chain oracle sample. HTTP/API availability, provider coverage and Switchboard gateway execution must be verified with the configured production demo environment; local program-test fixtures validate the on-chain contract, not live oracle-provider SLA.
