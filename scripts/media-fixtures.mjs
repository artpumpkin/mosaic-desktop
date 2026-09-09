import { writeFileSync, readFileSync } from "node:fs";
import { MEDIA_KINDS, defaultOptions } from "../lib/media/presets.ts";

// Synthetic vectors shared with the Rust command-boundary tests. Exercise
// defaults, every select value, and range endpoints from the actual UI catalog.
const fixtures = [];
for (const kind of MEDIA_KINDS) {
  for (const operation of kind.operations) {
    const defaults = defaultOptions(operation);
    const options = [defaults];
    for (const control of operation.controls) {
      const values = control.kind === "select" ? control.options.map(o => o.value)
        : control.kind === "range" ? [control.min, control.max] : [false, true];
      for (const value of values) options.push({ ...defaults, [control.key]: value });
    }
    for (const option of options) fixtures.push(operation.build(`/demo/sample.${kind.extensions[0]}`, option));
  }
}
const output = `${JSON.stringify(fixtures, null, 2)}\n`;
const file = new URL("../tests/media-presets.json", import.meta.url);
if (process.argv.includes("--write")) writeFileSync(file, output);
else if (readFileSync(file, "utf8") !== output) throw new Error("Media fixtures are stale; regenerate with --write");
console.log(`Verified ${fixtures.length} media preset vectors`);
