import { AsyncLocalStorage } from "node:async_hooks";
import type { PolicyRule } from "../core.js";
import type { BrowserPageSnapshot } from "../tools/browser.js";
import type { ComputerStateSnapshot } from "../tools/computer.js";

export interface BridgeTurnContext {
  threadId: string;
  model: string;
  snapshot: BrowserPageSnapshot;
  computerSnapshot: ComputerStateSnapshot;
  policyOverrides: PolicyRule[];
}

const bridgeTurnContext = new AsyncLocalStorage<BridgeTurnContext>();

export function runWithBridgeTurnContext<T>(
  context: BridgeTurnContext,
  callback: () => Promise<T>,
): Promise<T> {
  return bridgeTurnContext.run(context, callback);
}

export function getBridgeTurnContext(): BridgeTurnContext | undefined {
  return bridgeTurnContext.getStore();
}
