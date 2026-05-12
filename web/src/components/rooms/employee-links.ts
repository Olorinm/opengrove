import {
  roomMemberSourceLabel,
  type RoomMember,
} from "./rooms-storage";

export type EmployeeLinkPayload = {
  token: string;
  employeeId: string;
  name: string;
  role: string;
  color?: string;
  homeNodeLabel: string;
  createdAt: string;
};

const EMPLOYEE_LINK_PARAM = "employeeLink";
const EMPLOYEE_LINK_PREFIX = "OGE1";

export function createEmployeeLink(member: RoomMember, homeNodeLabel = "OpenGrove"): EmployeeLinkPayload {
  return {
    token: member.id,
    employeeId: member.id,
    name: member.name,
    role: member.role,
    color: member.color,
    homeNodeLabel,
    createdAt: member.id,
  };
}

export function employeeLinkCode(link: EmployeeLinkPayload): string {
  return `${EMPLOYEE_LINK_PREFIX}-${encodeEmployeeLink(link)}`;
}

export function employeeLinkPreview(code: string): string {
  const digits = code.replace(`${EMPLOYEE_LINK_PREFIX}-`, "").replace(/\D/g, "");
  const groups = digits.match(/.{1,4}/g) ?? [];
  if (!groups.length) return code;
  if (groups.length <= 6) return `${EMPLOYEE_LINK_PREFIX}-${groups.join(" ")}`;
  return `${EMPLOYEE_LINK_PREFIX}-${groups.slice(0, 3).join(" ")} ... ${groups.slice(-2).join(" ")}`;
}

export function readEmployeeLinkFromLocation(): string | null {
  const raw = new URLSearchParams(window.location.search).get(EMPLOYEE_LINK_PARAM);
  return raw || null;
}

export function clearEmployeeLinkFromLocation(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete(EMPLOYEE_LINK_PARAM);
  window.history.replaceState({}, "", url.toString());
}

export function memberFromEmployeeLinkUrl(rawLink: string): RoomMember {
  const payload = readEmployeeLinkPayload(rawLink);
  const memberId = `remote_${payload.token}_${payload.employeeId}`.replace(/[^A-Za-z0-9_-]/g, "_");
  return {
    id: memberId,
    name: payload.name,
    kernel: "remote-agent",
    model: "OpenGrove Link",
    role: payload.role || "员工",
    status: "waiting",
    color: payload.color || "#0ea5e9",
    lastActive: "待命",
    source: "remote",
    sourceLabel: roomMemberSourceLabel({ source: "remote" }),
    inviteStatus: "accepted",
    homeNodeLabel: payload.homeNodeLabel,
  };
}

function readEmployeeLinkPayload(rawLink: string): EmployeeLinkPayload {
  const text = rawLink.trim();
  if (!text) throw new Error("empty_employee_link");
  const url = parseUrl(text);
  const rawPayload = url ? url.searchParams.get(EMPLOYEE_LINK_PARAM) : text;
  if (!rawPayload) throw new Error("missing_employee_link_payload");
  const parsed = decodeEmployeeLink(rawPayload);
  const token = String(parsed.token || "").trim();
  const employeeId = String(parsed.employeeId || "").trim();
  const name = String(parsed.name || "").trim();
  if (!token || !employeeId || !name) throw new Error("invalid_employee_link");
  return {
    token,
    employeeId,
    name,
    role: String(parsed.role || "员工").trim() || "员工",
    color: String(parsed.color || "").trim() || undefined,
    homeNodeLabel: String(parsed.homeNodeLabel || "OpenGrove").trim() || "OpenGrove",
    createdAt: String(parsed.createdAt || employeeId),
  };
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function encodeEmployeeLink(link: EmployeeLinkPayload): string {
  const bytes = new TextEncoder().encode(JSON.stringify(link));
  return Array.from(bytes, (byte) => byte.toString().padStart(3, "0")).join("");
}

function decodeEmployeeLink(raw: string): Partial<EmployeeLinkPayload> {
  const text = raw.trim();
  if (text.startsWith("{")) {
    return JSON.parse(text) as Partial<EmployeeLinkPayload>;
  }
  const withoutPrefix = text.startsWith(`${EMPLOYEE_LINK_PREFIX}-`)
    ? text.slice(EMPLOYEE_LINK_PREFIX.length + 1)
    : text;
  const numeric = withoutPrefix.replace(/[\s-]/g, "");
  if (/^\d+$/.test(numeric) && numeric.length % 3 === 0) {
    const bytes = new Uint8Array(numeric.length / 3);
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Number(numeric.slice(index * 3, index * 3 + 3));
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as Partial<EmployeeLinkPayload>;
  }
  const padded = text.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  const binary = window.atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as Partial<EmployeeLinkPayload>;
}
