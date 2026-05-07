export const APP_PRODUCT_NAME = "OpenGrove";
export const APP_PROTOCOL_ID = "opengrove";
export const APP_KNOWLEDGE_SCOPE = "app";
export const APP_ENV_PREFIX = "OPENGROVE";
export const APP_CONFIG_DIR = ".opengrove";
export const APP_VAULT_DIR = "opengrove-vault";
export const APP_VAULT_ROOT_NAME = APP_PRODUCT_NAME;
export const APP_BRIDGE_TOKEN_HEADER = "x-opengrove-token";
export const APP_LOCAL_BRIDGE_NAME = `${APP_PROTOCOL_ID}-local-bridge`;
export const APP_MANAGED_BY = APP_PROTOCOL_ID;
export const APP_NATIVE_SKILL_MARKER_FILE = ".opengrove-native-skill.json";

export function appEnvName(name: string): string {
  return `${APP_ENV_PREFIX}_${name}`;
}

export function readAppEnv(name: string): string | undefined {
  return process.env[appEnvName(name)];
}
