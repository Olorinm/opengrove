export type OpenGroveProfile = "local" | "server" | "test";

export function normalizeOpenGroveProfile(value: unknown, fallback: OpenGroveProfile = "local"): OpenGroveProfile {
  return value === "server" || value === "test" || value === "local" ? value : fallback;
}
