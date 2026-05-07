import { useQuery } from "@tanstack/react-query";
import type {
  ApprovalsResponse,
  BridgeSettingsResponse,
  ContextRecordsResponse,
  EventsResponse,
  HealthResponse,
  InventoryResponse,
} from "../bridge";
import { bridgeHeaders, fetchJson } from "../bridge";

export function useBridgeQueries() {
  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: () => fetchJson<HealthResponse>("/health"),
    refetchInterval: 15_000,
  });

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => fetchJson<BridgeSettingsResponse>("/settings", { headers: bridgeHeaders(false) }),
    refetchInterval: 15_000,
  });

  const inventoryQuery = useQuery({
    queryKey: ["inventory"],
    queryFn: () => fetchJson<InventoryResponse>("/inventory", { headers: bridgeHeaders(false) }),
    refetchInterval: 8_000,
  });

  const approvalsQuery = useQuery({
    queryKey: ["approvals"],
    queryFn: () => fetchJson<ApprovalsResponse>("/approvals", { headers: bridgeHeaders(false) }),
    refetchInterval: 8_000,
  });

  const contextRecordsQuery = useQuery({
    queryKey: ["context-records"],
    queryFn: () => fetchJson<ContextRecordsResponse>("/context-records", { headers: bridgeHeaders(false) }),
    refetchInterval: 8_000,
  });

  const eventsQuery = useQuery({
    queryKey: ["events"],
    queryFn: () => fetchJson<EventsResponse>("/events", { headers: bridgeHeaders(false) }),
    refetchInterval: 8_000,
  });

  return {
    healthQuery,
    settingsQuery,
    inventoryQuery,
    approvalsQuery,
    contextRecordsQuery,
    eventsQuery,
  };
}
