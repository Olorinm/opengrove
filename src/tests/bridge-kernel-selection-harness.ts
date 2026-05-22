import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APP_PROTOCOL_ID, appEnvName } from "../identity.js";
import { BRIDGE_KERNEL_IDS, type BridgeKernelId, type BridgeProviderProfile } from "../server/bridge-types.js";
import { createBridgeState, recreateBridgeApp } from "../server/bridge-state.js";
import { createBridgeKernel, getBridgeKernelOptions, normalizeBridgeKernelPreference, resolveBridgeKernel } from "../server/kernel-selection.js";
import { kernelModelAliasesForProvider, kernelModelForProviderSelection } from "../server/kernel-model-routing.js";
import { filterEnabledKnowledgeDocuments } from "../server/knowledge-files.js";
import { codexProviderConfigForKernel, getBridgeProviderProfiles, providerEnvForKernel, providerSupportsKernel, resolveProviderForKernel } from "../server/provider-profiles.js";
import { normalizeCodexModelId } from "../runtime/codex/policy.js";
import { readKernelNativeProviderProfile } from "../server/kernel-native-profiles.js";
import { providerBindingFingerprint } from "../server/provider-binding.js";

async function main() {
  const cwd = mkdtempSync(join(tmpdir(), "opengrove-bridge-kernel-"));
  const fakeHermes = join(cwd, "fake-hermes.sh");
  writeFileSync(
    fakeHermes,
    [
      "#!/bin/sh",
      "if [ \"$1\" = \"--version\" ]; then",
      "  echo \"hermes-fake 0.0.0\"",
      "  exit 0",
      "fi",
      "echo \"bridge hermes ok\"",
    ].join("\n"),
    "utf8",
  );
  chmodSync(fakeHermes, 0o755);

  process.env[appEnvName("HERMES_BIN")] = fakeHermes;
  process.env[appEnvName("BRIDGE_SETTINGS_PATH")] = join(cwd, "bridge-settings.json");
  const fakeDeepSeek = join(cwd, "fake-deepseek.sh");
  writeFileSync(
    fakeDeepSeek,
    [
      "#!/bin/sh",
      "if [ \"$1\" = \"--version\" ]; then",
      "  echo \"deepseek-fake 0.0.0\"",
      "  exit 0",
      "fi",
      "echo \"deepseek ok\"",
    ].join("\n"),
    "utf8",
  );
  chmodSync(fakeDeepSeek, 0o755);
  process.env[appEnvName("DEEPSEEK_TUI_BIN")] = fakeDeepSeek;
  process.env[appEnvName("VOLC_CODING_API_KEY")] = "test-key";

  const hermesHome = join(cwd, "hermes-home");
  mkdirSync(hermesHome, { recursive: true });
  writeFileSync(
    join(hermesHome, "config.yaml"),
    [
      "model:",
      "  provider: \"volcengine\"",
      "  default: \"glm-5.1\"",
      "  base_url: \"https://ark.cn-beijing.volces.com/api/coding/v3\"",
      "  api_mode: \"chat_completions\"",
      `  key_env: "${appEnvName("VOLC_CODING_API_KEY")}"`,
      "providers:",
      "  \"volcengine\":",
      "    name: \"Volcengine Ark\"",
      "    models:",
      "      \"glm-5.1\": {}",
      "      \"minimax-m2.7\": {}",
    ].join("\n"),
    "utf8",
  );
  const hermesNative = readKernelNativeProviderProfile("hermes", { configHome: hermesHome });
  assert.equal(hermesNative?.providerId, "volcengine");
  assert.equal(hermesNative?.providerLabel, "Volcengine Ark");
  assert.equal(hermesNative?.baseUrl, "https://ark.cn-beijing.volces.com/api/coding/v3");
  assert.equal(hermesNative?.apiKeyEnv, appEnvName("VOLC_CODING_API_KEY"));
  assert.equal(hermesNative?.defaultModel, "glm-5.1");
  assert.deepEqual(hermesNative?.models.map((model) => model.id), ["glm-5.1", "minimax-m2.7"]);

  assert.equal(normalizeBridgeKernelPreference("hermes", "auto"), "hermes");
  assert.equal(normalizeBridgeKernelPreference("deepseek-tui", "auto"), "deepseek-tui");
  assert.equal(resolveBridgeKernel("hermes"), "hermes");

  const state = createBridgeState({ statePath: join(cwd, "state.json") });
  const roomSeed = state.app.rooms.snapshot();
  assert.deepEqual(
    roomSeed.members,
    [],
    "kernel discovery should not auto-create employees; employees are explicit room/contact entities",
  );
  assert.deepEqual(
    roomSeed.rooms.find((room) => room.id === "room-open-group")?.memberIds,
    [],
    "the default room should be bootstrapped without turning kernels into employees",
  );
  const editorAppRoot = join(cwd, "sample-editor-app");
  mkdirSync(editorAppRoot, { recursive: true });
  writeFileSync(
    join(editorAppRoot, "opengrove.app.json"),
    JSON.stringify({
      id: "sample-editor",
      title: "Sample Editor",
      description: "Portable editing workflow for OpenGrove.",
      employees: [{
        id: "asset-editor",
        name: "Asset Editor",
        kernel: "claude-code",
        model: "claude-code-default",
        role: "Prepares workspace assets and previews.",
        defaultSkillIds: ["asset-query", "project-render"],
      }],
    }),
    "utf8",
  );
  const directorAppRoot = join(cwd, "sample-director-app");
  mkdirSync(directorAppRoot, { recursive: true });
  writeFileSync(
    join(directorAppRoot, "opengrove.app.json"),
    JSON.stringify({
      id: "sample-director",
      title: "Sample Director",
      description: "Portable director workflow for OpenGrove.",
      capabilities: {
        employees: [{
          id: "director",
          name: "Director",
          kernel: "opencode",
          model: "sample-director-model",
          role: "Coordinates the app workflow.",
        }],
      },
    }),
    "utf8",
  );
  state.settings.mountedApps = [
    { id: "sample-editor", path: editorAppRoot, enabled: true },
    { id: "sample-director", path: directorAppRoot, enabled: true },
  ];
  recreateBridgeApp(state);
  const appMembers = state.app.rooms.listMembers();
  const editorEmployee = appMembers.find((member) => member.id === "member-app-sample-editor-asset-editor");
  const directorEmployee = appMembers.find((member) => member.id === "member-app-sample-director-director");
  assert.equal(editorEmployee?.kernel, "claude-code", "manifest employee should preserve its kernel");
  assert.deepEqual(editorEmployee?.defaultSkillIds, ["asset-query", "project-render"]);
  assert.equal(directorEmployee?.kernel, "opencode", "manifest employee should preserve opencode kernel");
  assert.equal(directorEmployee?.model, "sample-director-model");
  state.settings.kernel = "hermes";
  const options = getBridgeKernelOptions(state);
  const hermesOption = options.find((option) => option.id === "hermes");
  assert.ok(hermesOption, "settings should expose Hermes");
  assert.equal(hermesOption?.available, true);
  assert.ok(Array.isArray(hermesOption?.sources), "settings should expose Hermes knowledge sources");
  assert.ok(
    (hermesOption?.sources as any[]).some((source) => source.id === "hermes.soul"),
    "Hermes sources should include the global SOUL.md file",
  );
  assert.ok(
    !(hermesOption?.sources as any[]).some((source) => source.id === `hermes.${APP_PROTOCOL_ID}-external-skills`),
    "Hermes settings sources should hide OpenGrove external publication internals",
  );
  const codexOption = options.find((option) => option.id === "codex");
  assert.ok(
    Array.isArray(codexOption?.sources) &&
      (codexOption?.sources as any[]).some((source) => source.id === "codex.user-agents-md"),
    "Codex sources should include the global AGENTS.md file",
  );
  assert.ok(
    !(codexOption?.sources as any[]).some((source) => String(source.id).includes("project")),
    "Codex settings sources should not expose project-bound files before OpenGrove has workspace binding",
  );
  const deepseekOption = options.find((option) => option.id === "deepseek-tui");
  assert.equal(deepseekOption?.available, true);
  assert.ok(
    Array.isArray(deepseekOption?.sources) &&
      (deepseekOption?.sources as any[]).some((source) => source.id === "deepseek.skills"),
    "DeepSeek TUI adapter should expose native skills as a kernel source",
  );
  const settings = state.settings;
  settings.kernelProviderBindings = { "deepseek-tui": "volc-coding-plan" };
  const providerOption = getBridgeKernelOptions(state).find((option) => option.id === "deepseek-tui");
  assert.equal(providerOption?.providerId, "volc-coding-plan");
  const volc = resolveProviderForKernel("deepseek-tui", settings.kernelProviderBindings);
  const env = providerEnvForKernel("deepseek-tui", volc, "glm-5.1");
  assert.equal(env?.DEEPSEEK_BASE_URL, "https://ark.cn-beijing.volces.com/api/coding/v3");
  assert.equal(env?.DEEPSEEK_MODEL, "glm-5.1");
  assert.equal(env?.DEEPSEEK_API_KEY, "test-key");
  assert.equal(
    kernelModelForProviderSelection("deepseek-tui", volc, "glm-5.1"),
    "glm-5.1",
    "OpenAI-compatible CLI kernels should receive provider model ids directly",
  );
  assert.equal(
    normalizeCodexModelId("gpt-5.5", "gpt-5.4"),
    "gpt-5.5",
    "Codex should let the composer-selected model override the configured default",
  );
  assert.equal(
    normalizeCodexModelId("claude-code-default", "gpt-5.4"),
    "gpt-5.4",
    "Codex should ignore stale non-Codex composer model ids",
  );
  assert.equal(
    normalizeCodexModelId("glm-5.1", "glm-5.1"),
    "glm-5.1",
    "Codex provider bindings should still pass provider-selected model ids through",
  );
  assert.equal(
    normalizeCodexModelId("gpt-5.5", "glm-5.1"),
    "glm-5.1",
    "Codex external provider bindings should not let stale OpenAI UI models leak into the provider request",
  );

  const claudeVolc = resolveProviderForKernel("claude-code", { "claude-code": "volc-coding-plan" });
  const claudeEnv = providerEnvForKernel("claude-code", claudeVolc, "glm-5.1");
  assert.equal(
    kernelModelForProviderSelection("claude-code", claudeVolc, "glm-5.1"),
    "opus",
    "Claude Code should receive a family alias, not the provider model id",
  );
  assert.deepEqual(kernelModelAliasesForProvider("claude-code", claudeVolc), {
    "glm-5.1": "opus",
    "minimax-m2.7": "opus",
    "ark-code-latest": "opus",
  });
  assert.equal(claudeEnv?.ANTHROPIC_BASE_URL, "https://ark.cn-beijing.volces.com/api/coding");
  assert.equal(claudeEnv?.ANTHROPIC_MODEL, "glm-5.1");
  assert.equal(claudeEnv?.ANTHROPIC_DEFAULT_OPUS_MODEL, "glm-5.1");
  assert.equal(claudeEnv?.ANTHROPIC_DEFAULT_SONNET_MODEL, "glm-5.1");
  assert.equal(claudeEnv?.ANTHROPIC_DEFAULT_HAIKU_MODEL, "glm-5.1");

  const codexVolc: BridgeProviderProfile = {
    ...claudeVolc!,
    apiKey: "raw-test-key",
    apiKeyEnv: undefined,
  };
  const codexEnv = providerEnvForKernel("codex", codexVolc, "glm-5.1");
  assert.equal(codexEnv?.OPENGROVE_VOLC_CODING_PLAN_API_KEY, "raw-test-key");
  const hermesEnv = providerEnvForKernel("hermes", codexVolc, "glm-5.1");
  assert.equal(hermesEnv?.OPENGROVE_VOLC_CODING_PLAN_API_KEY, "raw-test-key");
  const opencodeEnv = providerEnvForKernel("opencode", codexVolc, "glm-5.1");
  assert.ok(opencodeEnv?.OPENCODE_CONFIG_CONTENT, "OpenCode should receive an inline custom provider config");
  const opencodeConfig = JSON.parse(opencodeEnv.OPENCODE_CONFIG_CONTENT) as any;
  assert.equal(opencodeConfig.model, "opengrove-volc-coding-plan/glm-5.1");
  assert.equal(
    opencodeConfig.provider["opengrove-volc-coding-plan"].options.baseURL,
    "https://ark.cn-beijing.volces.com/api/coding/v3",
  );
  assert.equal(opencodeConfig.provider["opengrove-volc-coding-plan"].options.apiKey, "raw-test-key");
  assert.ok(opencodeConfig.provider["opengrove-volc-coding-plan"].models["glm-5.1"]);
  assert.deepEqual(codexProviderConfigForKernel(codexVolc), {
    providerKey: "opengrove_volc_coding_plan",
    name: "Volcengine Coding Plan",
    baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3",
    envKey: "OPENGROVE_VOLC_CODING_PLAN_API_KEY",
    wireApi: "responses",
  });

  const volcRouting: Record<BridgeKernelId, string | undefined> = {
    codex: "glm-5.1",
    "claude-code": "opus",
    hermes: "glm-5.1",
    pi: "glm-5.1",
    openclaw: undefined,
    "deepseek-tui": "glm-5.1",
    "gemini-cli": undefined,
    "qwen-code": "glm-5.1",
    opencode: "opengrove-volc-coding-plan/glm-5.1",
    copilot: "glm-5.1",
    "cursor-agent": undefined,
    kimi: undefined,
    "kiro-cli": undefined,
  };
  for (const kernelId of BRIDGE_KERNEL_IDS) {
    const boundProvider = resolveProviderForKernel(kernelId, { [kernelId]: "volc-coding-plan" });
    const expectedModel = volcRouting[kernelId];
    if (!expectedModel) {
      assert.equal(boundProvider, undefined, `${kernelId} should reject incompatible Volc provider binding`);
      continue;
    }
    assert.ok(boundProvider, `${kernelId} should resolve Volc provider binding`);
    assert.equal(
      kernelModelForProviderSelection(kernelId, boundProvider, "glm-5.1"),
      expectedModel,
      `${kernelId} should route provider model through the kernel-specific model contract`,
    );
  }

  const customGeminiProvider: BridgeProviderProfile = {
    id: "custom-gemini",
    name: "Custom Gemini",
    protocol: "gemini-compatible",
    geminiBaseUrl: "https://generativelanguage.googleapis.com",
    apiKeyEnv: "GEMINI_API_KEY",
    models: [{ id: "gemini-3.1-pro", label: "Gemini 3.1 Pro" }],
  };
  process.env.GEMINI_API_KEY = "test-gemini-key";
  assert.equal(
    kernelModelForProviderSelection("gemini-cli", customGeminiProvider, "gemini-3.1-pro"),
    "gemini-3.1-pro",
    "Gemini CLI should receive Gemini provider model ids directly",
  );
  const geminiEnv = providerEnvForKernel("gemini-cli", customGeminiProvider, "gemini-3.1-pro");
  assert.equal(geminiEnv?.GEMINI_MODEL, "gemini-3.1-pro");

  const profiles = getBridgeProviderProfiles();
  const openai = profiles.find((profile) => profile.id === "openai");
  const anthropic = profiles.find((profile) => profile.id === "anthropic");
  const openrouter = profiles.find((profile) => profile.id === "openrouter");
  assert.ok(openai && anthropic && openrouter);
  assert.equal(providerSupportsKernel("codex", openai), true, "Codex can use native OpenAI account login");
  assert.equal(providerSupportsKernel("claude-code", openai), false, "Claude Code should not offer OpenAI native login as a provider binding");
  assert.equal(providerSupportsKernel("pi", openai), false, "OpenAI account login should not be offered as a Pi provider binding");
  assert.equal(providerSupportsKernel("claude-code", anthropic), true, "Claude Code can use Anthropic-compatible providers");
  assert.equal(providerSupportsKernel("hermes", openai), false, "Hermes cannot reuse Codex/OpenAI native account login directly");
  assert.equal(providerSupportsKernel("hermes", anthropic), true, "Hermes can use Anthropic-compatible providers through isolated config");
  assert.equal(providerSupportsKernel("hermes", openrouter), true, "Hermes can use OpenAI-compatible providers through isolated config");
  assert.equal(providerSupportsKernel("openclaw", openrouter), false, "OpenClaw should use Gateway-native configuration, not provider bindings");
  assert.equal(providerSupportsKernel("deepseek-tui", anthropic), false, "DeepSeek TUI should not offer Anthropic-only providers");
  assert.equal(providerSupportsKernel("deepseek-tui", openrouter), true, "DeepSeek TUI can use OpenAI-compatible providers");
  assert.equal(providerSupportsKernel("qwen-code", openrouter), true, "Qwen Code can use OpenAI-compatible providers");
  assert.equal(providerSupportsKernel("gemini-cli", openrouter), false, "Gemini CLI should not offer OpenAI-compatible providers");
  assert.equal(providerSupportsKernel("copilot", anthropic), true, "Copilot can use Anthropic-compatible providers");
  const copilotAnthropicEnv = providerEnvForKernel("copilot", { ...anthropic, apiKey: "anthropic-test-key", apiKeyEnv: undefined }, "sonnet");
  assert.equal(copilotAnthropicEnv?.COPILOT_PROVIDER_TYPE, "anthropic");
  assert.equal(copilotAnthropicEnv?.COPILOT_PROVIDER_BASE_URL, "https://api.anthropic.com");
  assert.equal(copilotAnthropicEnv?.COPILOT_PROVIDER_API_KEY, "anthropic-test-key");
  const discoveredCodexLogin: BridgeProviderProfile = {
    ...openai,
    custom: true,
    origin: "discovered",
    sourceKernel: "codex",
    authConfigured: true,
  };
  assert.equal(providerSupportsKernel("codex", discoveredCodexLogin), true, "Codex should keep its own discovered account login");
  assert.equal(providerSupportsKernel("hermes", discoveredCodexLogin), false, "Discovered Codex login is not a transferable provider");
  const discoveredClaudeBedrock: BridgeProviderProfile = {
    id: "aws-bedrock",
    name: "AWS Bedrock",
    custom: true,
    origin: "discovered",
    sourceKernel: "claude-code",
    authConfigured: true,
    protocol: "anthropic-compatible",
    credentialKind: "aws",
    anthropicBaseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
    models: [{ id: "opus", label: "Opus" }],
  };
  assert.equal(providerSupportsKernel("claude-code", discoveredClaudeBedrock), true, "Claude Code Bedrock is a provider config for Claude Code");
  assert.equal(providerSupportsKernel("hermes", discoveredClaudeBedrock), false, "Bedrock credentials should not be offered to kernels without Bedrock support");
  const discoveredClaudeBedrockApiKey: BridgeProviderProfile = {
    ...discoveredClaudeBedrock,
    id: "aws-bedrock-api-key",
    name: "AWS Bedrock (API Key)",
    sourceKernel: undefined,
    authConfigured: undefined,
    apiKey: "ABSKinline-bedrock-test-key",
    models: [
      {
        id: "sonnet",
        label: "Sonnet · us.anthropic.claude-sonnet-4-6",
        description: "provider model: us.anthropic.claude-sonnet-4-6",
      },
    ],
  };
  assert.equal(providerSupportsKernel("claude-code", discoveredClaudeBedrockApiKey), true, "Claude Code can use a Bedrock bearer token provider");
  const claudeBedrockEnv = providerEnvForKernel("claude-code", discoveredClaudeBedrockApiKey, "sonnet");
  assert.equal(claudeBedrockEnv?.CLAUDE_CODE_USE_BEDROCK, "1");
  assert.equal(claudeBedrockEnv?.AWS_REGION, "us-east-1");
  assert.equal(claudeBedrockEnv?.ANTHROPIC_BEDROCK_BASE_URL, "https://bedrock-runtime.us-east-1.amazonaws.com");
  assert.equal(claudeBedrockEnv?.AWS_BEARER_TOKEN_BEDROCK, "ABSKinline-bedrock-test-key");
  assert.equal(providerSupportsKernel("opencode", discoveredClaudeBedrockApiKey), true, "OpenCode can use Amazon Bedrock through its native provider");
  assert.equal(providerSupportsKernel("opencode", anthropic), false, "OpenCode should not offer Anthropic-compatible providers unless a config generator exists");
  assert.equal(
    kernelModelForProviderSelection("opencode", discoveredClaudeBedrockApiKey, "sonnet"),
    "amazon-bedrock/sonnet",
    "OpenCode Bedrock model ids should be qualified with the built-in Amazon Bedrock provider",
  );
  const opencodeBedrockEnv = providerEnvForKernel("opencode", discoveredClaudeBedrockApiKey, "sonnet");
  assert.equal(opencodeBedrockEnv?.AWS_BEARER_TOKEN_BEDROCK, "ABSKinline-bedrock-test-key");
  const opencodeBedrockConfig = JSON.parse(opencodeBedrockEnv?.OPENCODE_CONFIG_CONTENT ?? "{}") as any;
  assert.equal(opencodeBedrockConfig.model, "amazon-bedrock/sonnet");
  assert.equal(opencodeBedrockConfig.provider["amazon-bedrock"].options.region, "us-east-1");
  assert.equal(opencodeBedrockConfig.provider["amazon-bedrock"].models.sonnet.id, "us.anthropic.claude-sonnet-4-6");
  const discoveredHermesVolc: BridgeProviderProfile = {
    id: "hermes-volc",
    name: "Hermes Volc",
    custom: true,
    origin: "discovered",
    sourceKernel: "hermes",
    authConfigured: true,
    protocol: "openai-compatible",
    openaiBaseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3",
    models: [{ id: "glm-5.1", label: "GLM-5.1" }],
  };
  assert.equal(providerSupportsKernel("hermes", discoveredHermesVolc), true, "Hermes can keep its own native provider");
  assert.equal(providerSupportsKernel("codex", discoveredHermesVolc), false, "Native Hermes provider without a transferable key should not be cross-bound");
  assert.equal(
    providerSupportsKernel("codex", { ...discoveredHermesVolc, apiKeyEnv: appEnvName("VOLC_CODING_API_KEY") }),
    true,
    "Native providers with a reusable key env can be offered to compatible kernels",
  );
  assert.equal(
    providerBindingFingerprint({ kernelId: "codex", provider: codexVolc, providerModel: "glm-5.1", kernelModel: "glm-5.1" }),
    providerBindingFingerprint({ kernelId: "codex", provider: codexVolc, providerModel: "minimax-m2.7", kernelModel: "minimax-m2.7" }),
    "Codex should keep the same native thread when only the model changes inside one provider binding",
  );

  state.app.knowledge.upsert({
    id: "test.project-claude-skill",
    type: "skill",
    title: "Project-only Claude skill",
    body: "project skill",
    tags: ["skill"],
    sourceRefs: [{ title: "project", locator: join(cwd, ".claude", "skills", "demo", "SKILL.md") }],
    scope: "project",
    metadata: {
      source: "project",
      skillRoot: join(cwd, ".claude", "skills", "demo"),
      entry: join(cwd, ".claude", "skills", "demo", "SKILL.md"),
    },
  });
  state.app.knowledge.upsert({
    id: "test.global-claude-md",
    type: "project_doc",
    title: "CLAUDE.md",
    body: "global rule",
    tags: ["claude", "instructions"],
    sourceRefs: [],
    scope: "user",
    metadata: {
      nativeGlobalKnowledge: true,
      kernelId: "claude-code",
      sourceId: "claude.user-claude-md",
      vaultPath: "Claude/CLAUDE.md",
    },
  });
  const libraryDocuments = filterEnabledKnowledgeDocuments(state, state.app.knowledge.list({ limit: 100 }));
  assert.ok(
    libraryDocuments.some((document) => document.id === "test.global-claude-md"),
    "library should show global kernel files",
  );
  assert.ok(
    !libraryDocuments.some((document) => document.id === "test.project-claude-skill"),
    "library should hide project-bound Claude files until OpenGrove has explicit workspace binding",
  );

  const adapter = createBridgeKernel(state);
  assert.equal(adapter.id, "hermes");
  const health = await adapter.healthCheck();
  assert.equal(health.status, "ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
