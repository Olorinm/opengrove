import { createOpenGrove } from "../app/create-opengrove.js";
import { wereadCompanionCapability } from "../capabilities/weread-companion/index.js";
import type { AgentEvent, EvalCase } from "../core.js";
import { createScriptedCompanionSession } from "../runtime/scripted-session.js";

export interface EvalResult {
  id: string;
  ok: boolean;
  checks: Record<string, boolean>;
  answer: string;
  eventTypes: string[];
}

export async function runCapabilityEvals(): Promise<EvalResult[]> {
  const evals = wereadCompanionCapability.evals ?? [];
  const results: EvalResult[] = [];

  for (const evalCase of evals) {
    results.push(await runEvalCase(evalCase));
  }

  return results;
}

async function runEvalCase(evalCase: EvalCase): Promise<EvalResult> {
  const app = createOpenGrove({
    readPage: () => ({
      title: "微信读书 Eval 页",
      url: "https://weread.qq.com/web/reader/eval",
      selection: "浏览器其实也是一种操作系统，agent 可以长在它的活动空间里。",
      locator: `eval:${evalCase.id}`,
    }),
    createSession: () => createScriptedCompanionSession(),
    sessionId: `eval:${evalCase.id}`,
  });

  const events: AgentEvent[] = [];
  for await (const event of app.runTurn(evalCase.input)) {
    events.push(event);
  }

  const answer = events
    .filter((event): event is Extract<AgentEvent, { type: "assistant.delta" }> => event.type === "assistant.delta")
    .map((event) => event.text)
    .join("");

  const eventTypes = events.map((event) => event.type);
  const checks = {
    readsSelection: events.some(
      (event) => event.type === "tool.started" && event.toolId === "browser.readSelection",
    ),
    answers: answer.trim().length > 0,
    citesSelection: answer.includes("浏览器其实也是一种操作系统"),
    noImplicitMemoryWrite: app.memory.list().length === 0,
  };

  return {
    id: evalCase.id,
    ok: Object.values(checks).every(Boolean),
    checks,
    answer,
    eventTypes,
  };
}

if (process.argv[1]?.endsWith("run-evals.js")) {
  const results = await runCapabilityEvals();
  console.log(JSON.stringify({ ok: results.every((result) => result.ok), results }, null, 2));
  if (!results.every((result) => result.ok)) {
    process.exitCode = 1;
  }
}
