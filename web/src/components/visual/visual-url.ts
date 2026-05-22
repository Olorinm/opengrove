export function isOpenGroveSelfPreviewUrl(value: string): boolean {
  const raw = value.trim();
  if (!raw || typeof window === "undefined") return false;
  try {
    const target = new URL(raw, window.location.href);
    const current = new URL(window.location.href);
    if (target.origin === current.origin) return !isOpenGroveMountedAppPreviewUrl(target);
    const localHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
    if (localHosts.has(target.hostname) && localHosts.has(current.hostname) && target.port === current.port) {
      return !isOpenGroveMountedAppPreviewUrl(target);
    }
    return false;
  } catch {
    return false;
  }
}

export function isOpenGroveMountedAppPreviewUrl(value: string | URL): boolean {
  const base = typeof window === "undefined" ? "http://opengrove.local" : window.location.href;
  const url = value instanceof URL ? value : new URL(value, base);
  if (/^\/apps\/[^/]+\/ui(?:\/|$)/.test(url.pathname)) return true;
  return url.pathname === "/ui/" &&
    url.searchParams.get("view") === "app" &&
    url.searchParams.get("embedded") === "app";
}
