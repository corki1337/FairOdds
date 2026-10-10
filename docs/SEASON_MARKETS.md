# Season markets

A separate `SeasonMarket` account supports 2–32 participants: league champion (`kind=0`) or top scorer (`kind=1`). Each wallet chooses one participant and may top up that position before cutoff. Every deposit immediately enters the demo `yield_park`, rather than waiting until the season ends. Winners share the full principal: `floor(stake × totalPool / winningPool)`. Protocol fee is zero; park surplus goes to treasury. A tie among top scorers, an empty winning pool or an expired oracle deadline returns full principal. Feed disagreement blocks resolution; deadline cancellation remains permissionless.

Two independent immutable feeds must return the same **one-based participant ordinal**. Zero means a final tie; -1 means pending/unsupported result and cannot settle or trigger a refund. Provider-specific IDs are mapped to that ordinal in the pinned jobs. Names and order are fixed at creation. Feed addresses, hashes, locked authority, sample timestamps and consensus are checked on-chain. The program cannot verify whether an HTTP provider is truthful; independent providers reduce that dependency.

## Prepare a reviewed manifest

Root `.env` needs `FOOTBALL_DATA_KEY` for the Bundesliga fixture/table/scorer data; OpenLigaDB needs no key. football-data access must cover the selected historical season and endpoint. Missing or restricted data causes preparation to stop, never a fabricated winner.

```bash
npm run seasons:prepare -- champion 2024 --demo
npm run seasons:prepare -- scorer 2024 --demo
```

Both providers must return the complete 18-team table and all 612 team-games for a finished double round-robin Bundesliga season. A five-row free TheSportsDB table is insufficient. For a real future season, omit `--demo` and configure `SEASON_CUTOFF` / `SEASON_END_TIME` as Unix seconds.

If names differ, set `SEASON_ALIASES_PATH` to a reviewed JSON map of OpenLigaDB IDs to football-data IDs, for example `{ "40": "5" }` **only after confirming those IDs identify the same entity**. Team and player aliases are separate files. Ambiguous names abort preparation. Display names must fit 32 UTF-8 bytes; review/shorten a long name without changing its IDs. Scorer candidates are capped at 32; an unmapped winner leads to waiting and eventually refund. Do not market this as coverage of every player.

The output is `app/src/data/seasons.json` or `SEASON_CONFIG_PATH`; no credential is embedded. Review it, run `npm run catalog:publish` when Redis is configured, then connect the GlobalConfig authority in `/admin` and create the season. Two feeds are initialized first, then the market. Failed creation may leave unused immutable feeds; funds are not accepted until the market exists.

Historical demos are visibly labeled and use a short future betting window against a known historical result. They demonstrate settlement mechanics, not price discovery. The repository ships an empty manifest list rather than an unverified mapping. Configuring an API key does not itself create a season: preparation, mapping review and authority creation are required.

Finality jobs currently support completed **double round-robin leagues**; playoffs, points adjustments, postponed/unplayed games and joint championships need a reviewed job before creation. A season leader midseason is never treated as final. Browser settlement cannot access server API keys; use the authenticated keeper/CLI for football-data or PandaScore feeds.
