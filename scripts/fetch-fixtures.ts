/**
 * Rebuilds app/src/data/fixtures.json from TheSportsDB plus every other configured provider
 * (OpenLigaDB always; football-data.org, API-Football, PandaScore when their key is set).
 *
 * The TheSportsDB endpoint that feeds this catalog is what the primary Switchboard oracles
 * call when a market settles, so an id here is exactly the id the chain resolves against.
 *
 *   npx ts-node scripts/fetch-fixtures.ts
 */
import { loadEnv } from "./sources/env";
import { buildCatalog, writeCatalog } from "./sources/catalog";

async function main() {
  loadEnv();
  const catalog = await buildCatalog();
  writeCatalog(catalog);
  console.log(
    `wrote ${catalog.meta.count} fixtures, ${catalog.meta.upcoming} not finished yet`,
    JSON.stringify(catalog.meta.bySource)
  );
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
