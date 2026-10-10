import { loadEnv } from "./sources/env";
loadEnv();
import { CATALOG_PATH } from "./sources/catalog";
import { writeStore } from "../app/src/lib/store";
import * as fs from "fs";
import * as path from "path";
import { validateManifest } from "../app/src/lib/season-jobs";
async function main() {
  await writeStore(
    "catalog",
    CATALOG_PATH,
    JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8")),
  );
  const file =
    process.env.SEASON_CONFIG_PATH ||
    path.join(__dirname, "../app/src/data/seasons.json");
  if (file)
    await writeStore(
      "seasons",
      file,
      JSON.parse(fs.readFileSync(file, "utf8")).map(validateManifest),
    );
  console.log("Catalog and configured manifests published");
}
main().catch(() => {
  console.error("Catalog publish failed; check KV and file configuration");
  process.exitCode = 1;
});
