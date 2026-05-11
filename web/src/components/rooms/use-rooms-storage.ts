import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { KernelOption, ModelId } from "../../bridge";
import {
  LEGACY_ROOMS_STORAGE_KEY,
  ROOMS_STATE_EVENT,
  mergeRoomsByUpdatedAt,
  mergeStateForStorage,
  normalizeStoredRoomsState,
  readStoredState,
  roomsStorageKey,
  type Room,
  type RoomMember,
  type RoomsState,
} from "./rooms-storage";

export function useRoomsStorage(params: {
  activeKernel?: string;
  activeModel: ModelId;
  activeWorkspaceRoot: string;
  kernelOptions: KernelOption[];
}): {
  rooms: Room[];
  setRooms: Dispatch<SetStateAction<Room[]>>;
  members: RoomMember[];
  setMembers: Dispatch<SetStateAction<RoomMember[]>>;
  activeRoomId: string;
  setActiveRoomId: Dispatch<SetStateAction<string>>;
  storageWarning: string;
} {
  const seededState = useMemo(
    () => readStoredState(params.activeKernel, params.activeModel, params.activeWorkspaceRoot, params.kernelOptions),
    [params.activeKernel, params.activeModel, params.activeWorkspaceRoot, params.kernelOptions],
  );
  const storageKey = useMemo(() => roomsStorageKey(params.activeWorkspaceRoot), [params.activeWorkspaceRoot]);
  const [rooms, setRooms] = useState<Room[]>(seededState.rooms);
  const [members, setMembers] = useState<RoomMember[]>(seededState.members);
  const [activeRoomId, setActiveRoomId] = useState(seededState.activeRoomId);
  const [storageWarning, setStorageWarning] = useState("");

  useEffect(() => {
    const nextState = readStoredState(params.activeKernel, params.activeModel, params.activeWorkspaceRoot, params.kernelOptions);
    setRooms(nextState.rooms);
    setMembers(nextState.members);
    setActiveRoomId(nextState.activeRoomId);
    setStorageWarning("");
  }, [storageKey]);

  useEffect(() => {
    try {
      const nextState = mergeStateForStorage({ rooms, members, activeRoomId }, params.activeWorkspaceRoot);
      writeStorageState(storageKey, nextState);
      setStorageWarning("");
    } catch {
      setStorageWarning("聊天室状态保存失败，当前消息仍保留在本页。");
    }
  }, [activeRoomId, members, params.activeWorkspaceRoot, rooms, storageKey]);

  useEffect(() => {
    function applyIncomingState(incoming: RoomsState) {
      setMembers(incoming.members);
      setRooms((current) => mergeRoomsByUpdatedAt(current, incoming.rooms));
      if (!document.hasFocus() && incoming.activeRoomId) {
        setActiveRoomId(incoming.activeRoomId);
      }
    }

    function handleStorage(event: StorageEvent) {
      if (event.key !== storageKey || !event.newValue) return;
      try {
        const incoming = normalizeStoredRoomsState(JSON.parse(event.newValue) as Partial<RoomsState>, members, activeRoomId);
        if (incoming) applyIncomingState(incoming);
      } catch {
        // Ignore malformed room state from another tab.
      }
    }

    function handleRoomsStateChanged(event: Event) {
      const detail = (event as CustomEvent<{ storageKey?: string }>).detail;
      if (detail?.storageKey && detail.storageKey !== storageKey) return;
      try {
        const incoming = normalizeStoredRoomsState(
          JSON.parse(window.localStorage.getItem(storageKey) || "null") as Partial<RoomsState>,
          members,
          activeRoomId,
        );
        if (incoming) applyIncomingState(incoming);
      } catch {
        // Ignore malformed room state from local editing surfaces.
      }
    }

    window.addEventListener("storage", handleStorage);
    window.addEventListener(ROOMS_STATE_EVENT, handleRoomsStateChanged);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(ROOMS_STATE_EVENT, handleRoomsStateChanged);
    };
  }, [activeRoomId, members, storageKey]);

  return {
    rooms,
    setRooms,
    members,
    setMembers,
    activeRoomId,
    setActiveRoomId,
    storageWarning,
  };
}

function writeStorageState(storageKey: string, state: RoomsState) {
  const serialized = JSON.stringify(state);
  try {
    window.localStorage.setItem(storageKey, serialized);
  } catch {
    window.localStorage.removeItem(LEGACY_ROOMS_STORAGE_KEY);
    window.localStorage.setItem(storageKey, serialized);
  }
}
