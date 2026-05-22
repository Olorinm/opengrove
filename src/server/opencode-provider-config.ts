import type {
  BridgeProviderProfile,
  BridgeRuntimeControlOption,
} from "./bridge-types.js";

const OPENCODE_CONFIG_SCHEMA = "https://opencode.ai/config.json";
const OPENCODE_BEDROCK_PROVIDER_ID = "amazon-bedrock";
const OPENCODE_PROVIDER_PACKAGE = "@ai-sdk/openai-compatible";

export function opencodeProviderKey(providerId: string): string {
  const normalized = providerId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (isAwsBedrockProviderId(normalized)) return OPENCODE_BEDROCK_PROVIDER_ID;
  return `opengrove-${normalized || "provider"}`.slice(0, 64);
}

export function opencodeModelIdForProvider(providerId: string, model: string): string {
  return `${opencodeProviderKey(providerId)}/${model}`;
}

export function opencodeProviderConfigContent(
  profile: BridgeProviderProfile,
  apiKey: string | undefined,
  model: string | undefined,
): string | undefined {
  if (opencodeSupportsAwsBedrockProvider(profile)) {
    return opencodeBedrockProviderConfigContent(profile, model);
  }

  const baseUrl = profile.openaiBaseUrl?.trim();
  if (!baseUrl || !apiKey) return undefined;
  const selectedModel = model?.trim() || profile.models[0]?.id;
  const providerKey = opencodeProviderKey(profile.id);
  const qualifiedModel = selectedModel ? `${providerKey}/${selectedModel}` : undefined;

  const config = {
    $schema: OPENCODE_CONFIG_SCHEMA,
    ...(qualifiedModel
      ? {
          model: qualifiedModel,
          small_model: qualifiedModel,
        }
      : {}),
    provider: {
      [providerKey]: {
        npm: OPENCODE_PROVIDER_PACKAGE,
        name: profile.name,
        options: {
          baseURL: baseUrl,
          apiKey,
        },
        models: opencodeModels(profile.models, selectedModel),
      },
    },
  };

  return JSON.stringify(config);
}

export function opencodeSupportsProvider(profile: BridgeProviderProfile): boolean {
  return Boolean(profile.openaiBaseUrl?.trim() || opencodeSupportsAwsBedrockProvider(profile));
}

function opencodeBedrockProviderConfigContent(
  profile: BridgeProviderProfile,
  model: string | undefined,
): string | undefined {
  const selectedModel = model?.trim() || profile.models[0]?.id;
  const providerKey = OPENCODE_BEDROCK_PROVIDER_ID;
  const qualifiedModel = selectedModel ? `${providerKey}/${selectedModel}` : undefined;
  const options = opencodeBedrockOptions(profile);

  const config = {
    $schema: OPENCODE_CONFIG_SCHEMA,
    ...(qualifiedModel
      ? {
          model: qualifiedModel,
          small_model: qualifiedModel,
        }
      : {}),
    provider: {
      [providerKey]: {
        name: profile.name,
        ...(Object.keys(options).length ? { options } : {}),
        models: opencodeModels(profile.models, selectedModel, { includeProviderModelIds: true }),
      },
    },
  };

  return JSON.stringify(config);
}

function opencodeSupportsAwsBedrockProvider(profile: BridgeProviderProfile): boolean {
  return isAwsBedrockProviderId(profile.id) && Boolean(profile.anthropicBaseUrl?.trim() || profile.models.length);
}

function opencodeBedrockOptions(profile: BridgeProviderProfile): Record<string, string> {
  const endpoint = profile.anthropicBaseUrl?.trim();
  const region = endpoint ? awsRegionFromBedrockEndpoint(endpoint) : undefined;
  return {
    ...(region ? { region } : {}),
    ...(endpoint ? { endpoint } : {}),
  };
}

function awsRegionFromBedrockEndpoint(endpoint: string): string | undefined {
  return endpoint.match(/bedrock-runtime[.-]([a-z0-9-]+)\.amazonaws\.com/i)?.[1];
}

function opencodeModels(
  models: BridgeRuntimeControlOption[],
  selectedModel: string | undefined,
  options: { includeProviderModelIds?: boolean } = {},
): Record<string, unknown> {
  const seen = new Set<string>();
  const ids = [selectedModel, ...models.map((model) => model.id)]
    .map((id) => id?.trim())
    .filter((id): id is string => Boolean(id && !seen.has(id) && seen.add(id)));

  return Object.fromEntries(
    ids.map((id) => {
      const model = models.find((item) => item.id === id);
      const providerModelId = options.includeProviderModelIds ? providerModelIdFromOption(model) : undefined;
      return [
        id,
        {
          ...(providerModelId && providerModelId !== id ? { id: providerModelId } : {}),
          name: model?.label || id,
          tool_call: true,
          reasoning: false,
          limit: {
            context: 128000,
            output: 4096,
          },
        },
      ];
    }),
  );
}

function providerModelIdFromOption(model: BridgeRuntimeControlOption | undefined): string | undefined {
  return model?.description?.match(/provider model:\s*(.+)$/i)?.[1]?.trim();
}

function isAwsBedrockProviderId(providerId: string): boolean {
  return providerId === "aws-bedrock" ||
    providerId === "aws-bedrock-api-key" ||
    providerId === OPENCODE_BEDROCK_PROVIDER_ID;
}
