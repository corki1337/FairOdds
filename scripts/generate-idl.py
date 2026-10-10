#!/usr/bin/env python3
"""Generate the client IDL from Anchor's compiler output; no handwritten account layouts."""
import json, os, re, subprocess, sys
from pathlib import Path
root = Path(__file__).resolve().parent.parent
name = sys.argv[1] if len(sys.argv) > 1 else "aichain"
package = "yield-park" if name == "yield_park" else name
env = dict(os.environ, ANCHOR_IDL_BUILD_SKIP_LINT="TRUE")
result = subprocess.run(["cargo", "test", "-p", package, "--features", "idl-build", "--lib", "__anchor_private_print_idl", "--", "--show-output"], cwd=root, env=env, capture_output=True, text=True)
if result.returncode:
    raise SystemExit(result.stderr)
blocks = {}
for kind, value in re.findall(r"--- IDL begin (.*?) ---\n(.*?)\n--- IDL end .*? ---", result.stdout, re.S):
    blocks.setdefault(kind, []).append(json.loads(value))
idl = blocks["program"][0]
idl["address"] = json.loads(blocks["address"][0])
idl["errors"] = blocks.get("errors", [[]])[0]
idl["events"] = []
for event in blocks.get("event", []):
    idl["events"].append(event["event"])
    idl["types"].extend(event["types"])
def normalize(value):
    if isinstance(value, dict): return {k: normalize(v) for k,v in value.items()}
    if isinstance(value, list): return [normalize(v) for v in value]
    if isinstance(value, str) and "::" in value: return value.rsplit("::", 1)[-1]
    return value
idl = normalize(idl)
types = {t["name"]: t for t in idl["types"]}
idl["types"] = list(types.values())
output = root / f"app/src/lib/idl/{name}.json"
output.write_text(json.dumps(idl, indent=2)+"\n")
print(f"Generated {len(idl['instructions'])} instructions and {len(idl['accounts'])} accounts")
