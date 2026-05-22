import { useEffect, useRef, useState } from "react";
import type { MouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { clamp } from "../format";
import { APP_STORAGE_KEYS } from "../identity";
import {
  LIBRARY_AI_RAIL_BOTTOM_STORAGE_KEY,
  MAX_LIBRARY_AI_PANEL_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_LIBRARY_AI_PANEL_WIDTH,
  MIN_LIBRARY_AI_RAIL_BOTTOM,
  MIN_SIDEBAR_WIDTH,
  readStoredLibraryAiPanelWidth,
  readStoredLibraryAiRailBottom,
  readStoredSidebarWidth,
} from "./app-shell-state";
import { MIN_COMPOSER_HEIGHT } from "./ui-model";

export function useAppLayoutResize(options: {
  composerHeight: number;
  setComposerHeight(height: number): void;
  openLibraryAiPanel(): void;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(readStoredSidebarWidth);
  const [libraryAiPanelWidth, setLibraryAiPanelWidth] = useState(readStoredLibraryAiPanelWidth);
  const [libraryAiRailBottom, setLibraryAiRailBottom] = useState(readStoredLibraryAiRailBottom);
  const [libraryAiRailDragging, setLibraryAiRailDragging] = useState(false);
  const resizeRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const sidebarResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const libraryAiResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const libraryAiRailDragRef = useRef<{ startClientY: number; startBottom: number; railHeight: number; tabHeight: number; moved: boolean } | null>(null);
  const libraryAiRailWasDraggedRef = useRef(false);

  useEffect(() => {
    if (!libraryAiRailDragging) return undefined;
    function handleMouseMove(event: globalThis.MouseEvent) {
      updateLibraryAiRailDrag(event.clientY);
    }
    function handleMouseUp(event: globalThis.MouseEvent) {
      finishLibraryAiRailDrag(event.clientY);
    }
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [libraryAiRailDragging]);

  useEffect(() => {
    if (options.composerHeight > 64) {
      options.setComposerHeight(MIN_COMPOSER_HEIGHT);
    }
  }, [options.composerHeight, options.setComposerHeight]);

  function onComposerPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const handle = event.target as HTMLElement;
    if (!handle.closest("[data-action='resize-composer']")) {
      return;
    }
    resizeRef.current = {
      startY: event.clientY,
      startHeight: options.composerHeight,
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
  }

  function onPointerMove(event: PointerEvent) {
    if (!resizeRef.current) {
      return;
    }
    options.setComposerHeight(resizeRef.current.startHeight + resizeRef.current.startY - event.clientY);
  }

  function onPointerUp() {
    resizeRef.current = null;
    window.removeEventListener("pointermove", onPointerMove);
  }

  function onSidebarResizePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    sidebarResizeRef.current = {
      startX: event.clientX,
      startWidth: sidebarWidth,
    };
    document.body.dataset.sidebarResizing = "true";
    window.addEventListener("pointermove", onSidebarResizePointerMove);
    window.addEventListener("pointerup", onSidebarResizePointerUp, { once: true });
  }

  function onSidebarResizePointerMove(event: PointerEvent) {
    if (!sidebarResizeRef.current) {
      return;
    }
    const nextWidth = clamp(
      sidebarResizeRef.current.startWidth + event.clientX - sidebarResizeRef.current.startX,
      MIN_SIDEBAR_WIDTH,
      MAX_SIDEBAR_WIDTH,
    );
    setSidebarWidth(nextWidth);
    window.localStorage.setItem(APP_STORAGE_KEYS.sidebarWidth, String(Math.round(nextWidth)));
  }

  function onSidebarResizePointerUp() {
    sidebarResizeRef.current = null;
    delete document.body.dataset.sidebarResizing;
    window.removeEventListener("pointermove", onSidebarResizePointerMove);
  }

  function onLibraryAiResizePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    libraryAiResizeRef.current = {
      startX: event.clientX,
      startWidth: libraryAiPanelWidth,
    };
    document.body.dataset.sidebarResizing = "true";
    window.addEventListener("pointermove", onLibraryAiResizePointerMove);
    window.addEventListener("pointerup", onLibraryAiResizePointerUp, { once: true });
  }

  function onLibraryAiResizePointerMove(event: PointerEvent) {
    if (!libraryAiResizeRef.current) {
      return;
    }
    const nextWidth = clamp(
      libraryAiResizeRef.current.startWidth - (event.clientX - libraryAiResizeRef.current.startX),
      MIN_LIBRARY_AI_PANEL_WIDTH,
      MAX_LIBRARY_AI_PANEL_WIDTH,
    );
    setLibraryAiPanelWidth(nextWidth);
    window.localStorage.setItem(APP_STORAGE_KEYS.libraryAiPanelWidth, String(Math.round(nextWidth)));
  }

  function onLibraryAiResizePointerUp() {
    libraryAiResizeRef.current = null;
    delete document.body.dataset.sidebarResizing;
    window.removeEventListener("pointermove", onLibraryAiResizePointerMove);
  }

  function onLibraryAiRailMouseDown(event: MouseEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    const railBounds = event.currentTarget.closest(".library-ai-edge-rail")?.getBoundingClientRect();
    const tabBounds = event.currentTarget.getBoundingClientRect();
    if (!railBounds) return;
    libraryAiRailDragRef.current = {
      startClientY: event.clientY,
      startBottom: libraryAiRailBottom,
      railHeight: railBounds.height,
      tabHeight: tabBounds.height,
      moved: false,
    };
    setLibraryAiRailDragging(true);
  }

  function updateLibraryAiRailDrag(clientY: number) {
    const drag = libraryAiRailDragRef.current;
    if (!drag) return;
    const deltaY = clientY - drag.startClientY;
    if (Math.abs(deltaY) > 3) drag.moved = true;
    const maxBottom = Math.max(MIN_LIBRARY_AI_RAIL_BOTTOM, drag.railHeight - drag.tabHeight - MIN_LIBRARY_AI_RAIL_BOTTOM);
    setLibraryAiRailBottom(clamp(drag.startBottom - deltaY, MIN_LIBRARY_AI_RAIL_BOTTOM, maxBottom));
  }

  function finishLibraryAiRailDrag(clientY: number) {
    const drag = libraryAiRailDragRef.current;
    if (!drag) return;
    const deltaY = clientY - drag.startClientY;
    const maxBottom = Math.max(MIN_LIBRARY_AI_RAIL_BOTTOM, drag.railHeight - drag.tabHeight - MIN_LIBRARY_AI_RAIL_BOTTOM);
    const nextBottom = clamp(drag.startBottom - deltaY, MIN_LIBRARY_AI_RAIL_BOTTOM, maxBottom);
    setLibraryAiRailBottom(nextBottom);
    window.localStorage.setItem(LIBRARY_AI_RAIL_BOTTOM_STORAGE_KEY, String(Math.round(nextBottom)));
    libraryAiRailWasDraggedRef.current = drag.moved;
    libraryAiRailDragRef.current = null;
    setLibraryAiRailDragging(false);
    window.setTimeout(() => {
      libraryAiRailWasDraggedRef.current = false;
    }, 0);
  }

  function openLibraryAiFromRail(event: MouseEvent<HTMLButtonElement>) {
    if (libraryAiRailWasDraggedRef.current) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    options.openLibraryAiPanel();
  }

  return {
    sidebarWidth,
    libraryAiPanelWidth,
    libraryAiRailBottom,
    libraryAiRailDragging,
    onComposerPointerDown,
    onSidebarResizePointerDown,
    onLibraryAiResizePointerDown,
    onLibraryAiRailMouseDown,
    openLibraryAiFromRail,
  };
}
