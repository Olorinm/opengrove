type ApiBaseGlobal = typeof globalThis & {
  __OPENGROVE_API_BASE__?: string;
};

export function apiUrl(path: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) {
    return path;
  }

  const base = readApiBase();
  if (!base) {
    return path;
  }

  return new URL(path, ensureTrailingSlash(base)).toString();
}

function readApiBase(): string | undefined {
  const globalBase = (globalThis as ApiBaseGlobal).__OPENGROVE_API_BASE__;
  if (typeof globalBase === "string" && globalBase.trim()) {
    return globalBase.trim();
  }

  if (typeof document !== "undefined") {
    const metaBase = document
      .querySelector<HTMLMetaElement>('meta[name="opengrove-api-base"]')
      ?.content
      .trim();
    if (metaBase) {
      return metaBase;
    }
  }

  return undefined;
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
