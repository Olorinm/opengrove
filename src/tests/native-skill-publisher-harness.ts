import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { createOpenGrove } from "../app/create-opengrove.js";
import { APP_CONFIG_DIR } from "../identity.js";
import { createClaudeCodeKernelAdapter } from "../kernel/adapters/claude-code.js";
import { createCodexKernelAdapter } from "../kernel/adapters/codex.js";
import { createHermesKernelAdapter } from "../kernel/adapters/hermes.js";
import type { KernelAdapter } from "../kernel/types.js";

async function main() {
  const cwd = mkdtempSync(join(tmpdir(), "opengrove-native-skill-"));
  const projectSkillDir = join(cwd, APP_CONFIG_DIR, "skills", "native-demo");
  mkdirSync(projectSkillDir, { recursive: true });
  writeFileSync(
    join(projectSkillDir, "SKILL.md"),
    [
      "---",
      "title: Native Demo",
      "description: Native demo skill for publisher verification.",
      "when_to_use: When validating native skill publication.",
      "user-invocable: true",
      "---",
      "# Native Demo",
      "",
      "Native marker: SHOULD_NOT_BE_HOST_INJECTED",
    ].join("\n"),
    "utf8",
  );

  const kernels: Array<{ kernel: KernelAdapter; target: string }> = [
    {
      kernel: createCodexKernelAdapter({ command: "/bin/echo", cwd }),
      target: join(cwd, ".codex", "skills", "native-demo", "SKILL.md"),
    },
    {
      kernel: createClaudeCodeKernelAdapter({ cliPath: "/bin/echo", cwd }),
      target: join(cwd, ".claude", "skills", "native-demo", "SKILL.md"),
    },
    {
      kernel: createHermesKernelAdapter(),
      target: join(cwd, APP_CONFIG_DIR, "native-skills", "hermes", "native-demo", "SKILL.md"),
    },
  ];

  for (const { kernel, target } of kernels) {
    const app = createOpenGrove({
      cwd,
      readPage: () => ({
        title: "Native Skill Page",
        url: "https://example.test/native-skill",
        visibleText: "Native demo skill for publisher verification.",
      }),
      kernel,
      sessionId: `native-skill-harness-${kernel.id}`,
    });

    assert.ok(existsSync(target), `${kernel.id} should receive a native skill copy`);
    if (kernel.capabilities.knowledge?.toolMediatedSkills) {
      assert.ok(app.tools.get("skill.invoke"), `${kernel.id} should expose OpenGrove skill.invoke when the kernel declares tool-mediated skills`);
    } else {
      assert.ok(!app.tools.get("skill.invoke"), `${kernel.id} should not receive a duplicate OpenGrove skill.invoke tool`);
    }
  }

  const app = createOpenGrove({
    cwd,
    readPage: () => ({
      title: "Native Skill Page",
      url: "https://example.test/native-skill",
      visibleText: "Native demo skill for publisher verification.",
    }),
    kernel: createHermesKernelAdapter(),
    sessionId: "native-skill-harness",
  });

  const events = [];
  for await (const event of app.runTurn("Run native demo", { requestedSkillName: "native-demo" })) {
    events.push(event);
  }

  const request = events.find((event) => event.type === "model.requested");
  assert.ok(request && request.type === "model.requested", "model.requested should be emitted");
  assert.ok(
    !request.request.context?.promptBlock.includes("SHOULD_NOT_BE_HOST_INJECTED"),
    "native skill body should not be host-injected into assembled context",
  );
  assert.ok(
    request.request.tools.every((tool) => tool.id !== "skill.invoke"),
    "runtime request should not include skill.invoke for native skill kernels",
  );
  assert.ok(
    app.knowledge.listDeliveries().some((delivery) =>
      delivery.knowledgeId === "skill.native-demo" && delivery.mode === "native_skill"
    ),
    "skill delivery should be recorded as native_skill",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
