export const APP_PRODUCT_NAME = "OpenGrove";
export const APP_PROTOCOL_ID = "opengrove";
export const APP_BRIDGE_TOKEN_HEADER = "x-opengrove-token";
export const APP_VAULT_DIR = "opengrove-vault";
export const APP_DEFAULT_PROJECT_ID = `project:${APP_PROTOCOL_ID}`;
export const APP_DEFAULT_PROJECT_TITLE = APP_PRODUCT_NAME;

export const APP_STORAGE_KEYS = {
  uiModel: `${APP_PROTOCOL_ID}UiModel`,
  uiView: `${APP_PROTOCOL_ID}UiView`,
  uiThreadId: `${APP_PROTOCOL_ID}UiThreadId`,
  uiState: `${APP_PROTOCOL_ID}-react-ui`,
  bridgeToken: `${APP_PROTOCOL_ID}BridgeToken`,
  sandbox: `${APP_PROTOCOL_ID}Sandbox`,
  approvalPolicy: `${APP_PROTOCOL_ID}ApprovalPolicy`,
} as const;
