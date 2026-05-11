import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { InMemoryRelay, type RelaySnapshot } from "./in-memory-relay.js";

export function createRelayStore(statePath: string | undefined): InMemoryRelay {
  const path = statePath?.trim();
  if (!path) {
    return new InMemoryRelay();
  }
  return new InMemoryRelay({
    snapshot: readSnapshot(path),
    onChange: (snapshot) => writeSnapshot(path, snapshot),
  });
}

function readSnapshot(path: string): RelaySnapshot | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as RelaySnapshot;
  return parsed && parsed.version === 1 ? parsed : undefined;
}

function writeSnapshot(path: string, snapshot: RelaySnapshot) {
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = `${path}.${process.pid}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  chmodSync(tmpPath, 0o600);
  renameSync(tmpPath, path);
}
