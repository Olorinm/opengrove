import assert from "node:assert/strict";
import { delimiter, dirname } from "node:path";
import {
  buildCodexAppServerEnv,
  CODEX_APP_SERVER_OPT_OUT_NOTIFICATION_METHODS,
} from "../runtime/codex/app-server-client.js";

const optOutMethods: readonly string[] = CODEX_APP_SERVER_OPT_OUT_NOTIFICATION_METHODS;

assert.equal(
  optOutMethods.includes("item/agentMessage/delta"),
  false,
  "Codex assistant message deltas must stay enabled so OpenGrove can stream assistant text.",
);
assert.equal(
  optOutMethods.includes("command/exec/outputDelta"),
  true,
  "High-volume command output deltas should remain opted out unless the UI consumes them directly.",
);

const codexCommand = "/Applications/Codex.app/Contents/Resources/codex";
const runtimeEnv = buildCodexAppServerEnv(codexCommand, {
  PATH: ["/usr/bin", "/bin", "/usr/bin"].join(delimiter),
});
const pathEntries = runtimeEnv.PATH?.split(delimiter) ?? [];

assert.deepEqual(
  pathEntries.slice(0, 2),
  ["/usr/bin", "/bin"],
  "Existing runtime PATH order should be preserved.",
);
assert.equal(
  pathEntries.filter((entry) => entry === "/usr/bin").length,
  1,
  "PATH augmentation should de-duplicate existing entries.",
);
assert.equal(
  pathEntries.includes(dirname(codexCommand)),
  true,
  "Codex app-server PATH should include the Codex resource directory so bundled tools such as rg are visible.",
);

console.log("✓ Codex app-server keeps assistant text deltas enabled");
console.log("✓ Codex app-server PATH includes bundled and local tool directories");
