/** Compatibility entry point. Always derive IDL from Rust instead of patching by hand. */
import { execFileSync } from "child_process";
import * as path from "path";
execFileSync("python3", [path.join(__dirname, "generate-idl.py")], {
  stdio: "inherit",
});
