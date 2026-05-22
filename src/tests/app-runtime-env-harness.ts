import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BridgeState } from "../server/bridge-types.js";
import { resolveMountedAppRuntimeEnv } from "../server/app-runtime-env.js";
import { normalizeCustomProviderProfiles } from "../server/provider-profiles.js";

const tmp = mkdtempSync(join(tmpdir(), "opengrove-app-runtime-env-"));
const appRoot = join(tmp, "mounted-app");
process.env.AWS_BEARER_TOKEN_BEDROCK = "ABSKenv-bedrock-test-key";
mkdirSync(appRoot, { recursive: true });
writeFileSync(
  join(appRoot, "opengrove.app.json"),
  JSON.stringify({
    id: "env-app",
    title: "Env App",
    runtimeEnv: {
      providerKeys: [
        {
          providerId: "aws-bedrock-api-key",
          env: { apiKey: "AWS_BEARER_TOKEN_BEDROCK" },
        },
        {
          providerId: "gemini",
          env: { apiKey: ["GOOGLE_API_KEY", "GEMINI_API_KEY"] },
        },
        {
          providerId: "missing-provider",
          env: "MISSING_PROVIDER_KEY",
          required: true,
        },
      ],
    },
  }, null, 2),
  "utf8",
);

const state = {
  settings: {
    mountedApps: [{ id: "env-app", path: appRoot, enabled: true }],
    customProviders: [
      {
        id: "aws-bedrock-api-key",
        name: "AWS Bedrock (API Key)",
        protocol: "anthropic-compatible",
        credentialKind: "api-key",
        apiKey: "ark-invalid-bedrock-test-key",
        models: [],
      },
      {
        id: "gemini",
        name: "Google AI Studio (Gemini API Key)",
        protocol: "gemini-compatible",
        credentialKind: "api-key",
        apiKey: "gemini-test-key",
        models: [],
      },
    ],
  },
} as unknown as BridgeState;

const resolved = resolveMountedAppRuntimeEnv(state, "env-app");
assert.ok(resolved);
assert.equal(resolved.appId, "env-app");
assert.equal(resolved.env.AWS_BEARER_TOKEN_BEDROCK, "ABSKenv-bedrock-test-key");
assert.equal(resolved.env.GOOGLE_API_KEY, "gemini-test-key");
assert.equal(resolved.env.GEMINI_API_KEY, "gemini-test-key");
assert.deepEqual(resolved.injectedEnv, [
  "AWS_BEARER_TOKEN_BEDROCK",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
]);
assert.deepEqual(resolved.missing, [
  {
    providerId: "missing-provider",
    env: ["MISSING_PROVIDER_KEY"],
    required: true,
    reason: "provider-not-found",
  },
]);

const inlineBedrockProviders = normalizeCustomProviderProfiles([
  {
    id: "aws-bedrock-api-key",
    name: "AWS Bedrock (API Key)",
    protocol: "anthropic-compatible",
    credentialKind: "api-key",
    apiKey: "AWS_BEARER_TOKEN_BEDROCK=ABSKinline-bedrock-test-key",
    models: [],
  },
]);
assert.equal(inlineBedrockProviders[0]?.apiKey, "ABSKinline-bedrock-test-key");

console.log("app-runtime-env harness passed");
