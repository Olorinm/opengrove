import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import clsx from "clsx";
import {
  BoxSelect,
  CircleDashed,
  Eye,
  EyeOff,
  MousePointer2,
  MousePointerClick,
  PanelRightClose,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import type {
  VisualAnnotation,
  VisualAnnotationPoint,
  VisualAnnotationRect,
  DeveloperSession,
} from "../../bridge";
import { OpenGroveSaplingMark } from "../sidebar/app-navigation";
import { collectVisualAnnotationTarget } from "./visual-annotation-target";
import { isOpenGroveMountedAppPreviewUrl, isOpenGroveSelfPreviewUrl } from "./visual-url";
import {
  VISUAL_AI_PANEL_MAX_WIDTH,
  VISUAL_AI_PANEL_MIN_WIDTH,
  VISUAL_AI_RAIL_MIN_BOTTOM,
  annotationAnchor,
  annotationRectFromTarget,
  annotationStatus,
  clamp,
  hoverTargetFromContext,
  normalizeRect,
  pendingKindLabel,
  pointToStyle,
  popupAnchor,
  readVisualAiPanelWidth,
  readVisualAiRailBottom,
  rectToStyle,
  writeVisualAiPanelWidth,
  writeVisualAiRailBottom,
  type AiPanelResize,
  type AiRailDrag,
  type Gesture,
  type HoverTarget,
  type PendingAnnotationDraft,
  type VisualAnnotationInput,
  type VisualTool,
} from "./visual-workbench-model";

export type { VisualAnnotationInput } from "./visual-workbench-model";

export function VisualWorkbench(props: {
  activeSession?: DeveloperSession;
  developerMode?: boolean;
  previewReloadKey?: string | number;
  corePanel: ReactNode;
  allowAiCollapse?: boolean;
  onCreateSession(): void;
  onAddAnnotation(sessionId: string, annotation: VisualAnnotationInput): void;
  onDeleteAnnotation(sessionId: string, annotationId: string): void;
  onPreviewLoaded(sessionId: string): void;
  onPreviewFailed(sessionId: string, message: string): void;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const aiRailDragRef = useRef<AiRailDrag | null>(null);
  const aiPanelResizeRef = useRef<AiPanelResize | null>(null);
  const aiRailWasDraggedRef = useRef(false);
  const [tool, setTool] = useState<VisualTool>("select");
  const [toolbarOpen, setToolbarOpen] = useState(true);
  const [showMarkers, setShowMarkers] = useState(true);
  const [pendingAnnotation, setPendingAnnotation] = useState<PendingAnnotationDraft | null>(null);
  const [pendingComment, setPendingComment] = useState("");
  const [hoverTarget, setHoverTarget] = useState<HoverTarget | null>(null);
  const [frameVersion, setFrameVersion] = useState(0);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [previewUnavailable, setPreviewUnavailable] = useState(false);
  const [aiPanelCollapsed, setAiPanelCollapsed] = useState(false);
  const [aiPanelWidth, setAiPanelWidth] = useState(readVisualAiPanelWidth);
  const [aiRailBottom, setAiRailBottom] = useState(readVisualAiRailBottom);
  const [aiRailDragging, setAiRailDragging] = useState(false);
  const activeSession = props.activeSession;
  const developerMode = props.developerMode === true;
  const allowAiCollapse = props.allowAiCollapse !== false;
  const selfPreviewBlocked = activeSession ? isOpenGroveSelfPreviewUrl(activeSession.targetUrl) : false;
  const mountedAppUiPreview = activeSession ? isOpenGroveMountedAppPreviewUrl(activeSession.targetUrl) : false;
  const previewUnavailableMessage = activeSession?.preview.status === "error" && !mountedAppUiPreview
    ? activeSession.preview.error || "预览服务未响应"
    : previewUnavailable
      ? "启动用户项目的 dev server 后刷新预览。"
      : "";
  const previewIsUnavailable = Boolean(previewUnavailableMessage);
  const annotationCount = activeSession?.annotations.length ?? 0;

  useEffect(() => {
    setTool("select");
    setPendingAnnotation(null);
    setPendingComment("");
    setHoverTarget(null);
    setGesture(null);
  }, [activeSession?.id]);

  useEffect(() => {
    if (!allowAiCollapse) {
      setAiPanelCollapsed(false);
    }
  }, [allowAiCollapse]);

  useEffect(() => {
    setHoverTarget(null);
  }, [tool]);

  useEffect(() => {
    if (developerMode) {
      setToolbarOpen(true);
      setAiPanelCollapsed(false);
      return;
    }
    setTool("select");
    setToolbarOpen(false);
    setPendingAnnotation(null);
    setPendingComment("");
    setHoverTarget(null);
    setGesture(null);
  }, [developerMode]);

  useEffect(() => {
    if (!activeSession || selfPreviewBlocked) {
      setPreviewUnavailable(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 2500);
    setPreviewUnavailable(false);

    void fetch(activeSession.targetUrl, {
      cache: "no-store",
      mode: "no-cors",
      signal: controller.signal,
    })
      .then(() => {
        if (!cancelled) setPreviewUnavailable(false);
      })
      .catch(() => {
        if (!cancelled) {
          setPreviewUnavailable(true);
          props.onPreviewFailed(activeSession.id, "preview_unreachable");
        }
      })
      .finally(() => window.clearTimeout(timeout));

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [activeSession?.id, activeSession?.targetUrl, frameVersion, props.previewReloadKey, selfPreviewBlocked]);

  useEffect(() => {
    if (!aiRailDragging) return;
    function handleMouseMove(event: globalThis.MouseEvent) {
      updateAiRailDrag(event.clientY);
    }
    function handleMouseUp(event: globalThis.MouseEvent) {
      finishAiRailDrag(event.clientY);
    }
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [aiRailDragging]);

  function stagePoint(event: PointerEvent<HTMLDivElement>): {
    point: VisualAnnotationPoint;
    viewport: { width: number; height: number };
  } | undefined {
    const bounds = stageRef.current?.getBoundingClientRect();
    if (!bounds) return undefined;
    return {
      point: {
        x: clamp(event.clientX - bounds.left, 0, bounds.width),
        y: clamp(event.clientY - bounds.top, 0, bounds.height),
      },
      viewport: {
        width: Math.max(1, Math.round(bounds.width)),
        height: Math.max(1, Math.round(bounds.height)),
      },
    };
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!developerMode || !activeSession || tool === "select" || pendingAnnotation) return;
    const target = event.target;
    if (target instanceof HTMLElement && target.closest("button, input, textarea")) return;
    const nextPoint = stagePoint(event);
    if (!nextPoint) return;
    setPendingAnnotation(null);
    if (tool === "element") {
      const targetContext = collectTargetContext({ point: nextPoint.point });
      const rect = annotationRectFromTarget(targetContext, nextPoint.viewport, nextPoint.point);
      setPendingAnnotation({
        kind: "element",
        url: activeSession.targetUrl,
        viewport: nextPoint.viewport,
        rect,
        target: targetContext,
        anchor: annotationAnchor(rect, nextPoint.viewport),
      });
      setHoverTarget(null);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === "stroke") {
      setGesture({ kind: "stroke", points: [nextPoint.point], viewport: nextPoint.viewport });
      return;
    }
    setGesture({ kind: tool, start: nextPoint.point, current: nextPoint.point, viewport: nextPoint.viewport });
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (developerMode && activeSession && tool === "element" && !pendingAnnotation && !gesture) {
      const nextPoint = stagePoint(event);
      if (!nextPoint) return;
      const targetContext = collectTargetContext({ point: nextPoint.point });
      setHoverTarget(hoverTargetFromContext(targetContext, nextPoint.viewport, nextPoint.point));
      return;
    }
    if (!gesture) return;
    const nextPoint = stagePoint(event);
    if (!nextPoint) return;
    if (gesture.kind === "stroke") {
      setGesture({ ...gesture, points: [...gesture.points, nextPoint.point], viewport: nextPoint.viewport });
      return;
    }
    setGesture({ ...gesture, current: nextPoint.point, viewport: nextPoint.viewport });
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!gesture || !activeSession) return;
    const pointerId = event.pointerId;
    if (event.currentTarget.hasPointerCapture(pointerId)) {
      event.currentTarget.releasePointerCapture(pointerId);
    }
    if (gesture.kind === "stroke") {
      if (gesture.points.length > 2) {
        const anchor = gesture.points[gesture.points.length - 1] ?? gesture.points[0];
        setPendingAnnotation({
          kind: "stroke",
          url: activeSession.targetUrl,
          viewport: gesture.viewport,
          points: gesture.points,
          target: collectTargetContext({ point: anchor }),
          anchor: popupAnchor(anchor, gesture.viewport),
        });
      }
      setGesture(null);
      return;
    }
    const dragDistance = Math.hypot(gesture.current.x - gesture.start.x, gesture.current.y - gesture.start.y);
    if (gesture.kind === "box" && dragDistance < 8) {
      setGesture(null);
      return;
    }
    const rect = normalizeRect(gesture.start, gesture.current, gesture.kind === "note");
    setPendingAnnotation({
      kind: gesture.kind === "note" ? "note" : "box",
      url: activeSession.targetUrl,
      viewport: gesture.viewport,
      rect,
      target: collectTargetContext({ rect }),
      anchor: annotationAnchor(rect, gesture.viewport),
    });
    setGesture(null);
  }

  function collectTargetContext(input: { point?: VisualAnnotationPoint; rect?: VisualAnnotationRect }) {
    return collectVisualAnnotationTarget({
      iframe: frameRef.current,
      stage: stageRef.current,
      point: input.point,
      rect: input.rect,
    });
  }

  function submitPendingAnnotation() {
    if (!activeSession || !pendingAnnotation) return;
    props.onAddAnnotation(activeSession.id, {
      kind: pendingAnnotation.kind,
      comment: pendingComment.trim(),
      transcript: pendingAnnotation.transcript,
      url: pendingAnnotation.url,
      viewport: pendingAnnotation.viewport,
      rect: pendingAnnotation.rect,
      points: pendingAnnotation.points,
      target: pendingAnnotation.target,
    });
    setPendingAnnotation(null);
    setPendingComment("");
    setHoverTarget(null);
    setShowMarkers(true);
    setTool("select");
  }

  function cancelPendingAnnotation() {
    setPendingAnnotation(null);
    setPendingComment("");
    setHoverTarget(null);
    setTool("select");
  }

  function clearAnnotations() {
    if (!activeSession) return;
    activeSession.annotations.forEach((annotation) => props.onDeleteAnnotation(activeSession.id, annotation.id));
  }

  function onAiRailMouseDown(event: MouseEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    const railBounds = event.currentTarget.closest(".visual-developer-ai-rail")?.getBoundingClientRect();
    const tabBounds = event.currentTarget.getBoundingClientRect();
    if (!railBounds) return;
    aiRailDragRef.current = {
      startClientY: event.clientY,
      startBottom: aiRailBottom,
      railHeight: railBounds.height,
      tabHeight: tabBounds.height,
      moved: false,
    };
    setAiRailDragging(true);
  }

  function updateAiRailDrag(clientY: number) {
    const drag = aiRailDragRef.current;
    if (!drag) return;
    const deltaY = clientY - drag.startClientY;
    if (Math.abs(deltaY) > 3) drag.moved = true;
    const maxBottom = Math.max(VISUAL_AI_RAIL_MIN_BOTTOM, drag.railHeight - drag.tabHeight - VISUAL_AI_RAIL_MIN_BOTTOM);
    setAiRailBottom(clamp(drag.startBottom - deltaY, VISUAL_AI_RAIL_MIN_BOTTOM, maxBottom));
  }

  function finishAiRailDrag(clientY: number) {
    const drag = aiRailDragRef.current;
    if (!drag) return;
    const deltaY = clientY - drag.startClientY;
    const maxBottom = Math.max(VISUAL_AI_RAIL_MIN_BOTTOM, drag.railHeight - drag.tabHeight - VISUAL_AI_RAIL_MIN_BOTTOM);
    const nextBottom = clamp(drag.startBottom - deltaY, VISUAL_AI_RAIL_MIN_BOTTOM, maxBottom);
    setAiRailBottom(nextBottom);
    writeVisualAiRailBottom(nextBottom);
    aiRailWasDraggedRef.current = drag.moved;
    aiRailDragRef.current = null;
    setAiRailDragging(false);
    window.setTimeout(() => {
      aiRailWasDraggedRef.current = false;
    }, 0);
  }

  function openCollapsedAiPanel(event: MouseEvent<HTMLButtonElement>) {
    if (aiRailWasDraggedRef.current) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    setAiPanelCollapsed(false);
  }

  return (
    <section
      className="visual-workbench"
      data-ai-collapsed={developerMode && allowAiCollapse && aiPanelCollapsed ? "true" : "false"}
      data-developer-mode={developerMode ? "true" : "false"}
      style={{ "--opengrove-visual-ai-width": `${aiPanelWidth}px` } as CSSProperties}
      aria-label="开发者模式"
    >
      <section className="visual-preview-column" aria-label="预览和标注">
        {developerMode ? (toolbarOpen ? (
          <div className="visual-toolbar" aria-label="标注工具">
            {annotationCount > 0 ? <span className="visual-toolbar-badge">{annotationCount}</span> : null}
            <ToolButton active={tool === "select"} label="浏览" onClick={() => setTool("select")} icon={<MousePointer2 size={18} />} />
            <ToolButton active={tool === "element"} label="点选元素" onClick={() => setTool("element")} icon={<MousePointerClick size={18} />} />
            <ToolButton active={tool === "box"} label="圈选区域" onClick={() => setTool("box")} icon={<BoxSelect size={18} />} />
            <ToolButton active={tool === "stroke"} label="画线" onClick={() => setTool("stroke")} icon={<Pencil size={18} />} />
            <ToolButton active={tool === "note"} label="添加备注" onClick={() => setTool("note")} icon={<CircleDashed size={18} />} />
            <div className="visual-toolbar-divider" />
            <button
              className="visual-toolbar-button"
              data-active={!showMarkers ? "true" : "false"}
              disabled={annotationCount === 0}
              type="button"
              onClick={() => setShowMarkers((value) => !value)}
              aria-label={showMarkers ? "隐藏标注" : "显示标注"}
              title={showMarkers ? "隐藏标注" : "显示标注"}
            >
              {showMarkers ? <Eye size={18} /> : <EyeOff size={18} />}
              <span>{showMarkers ? "隐藏标注" : "显示标注"}</span>
            </button>
            <button
              className="visual-toolbar-button"
              data-danger="true"
              disabled={annotationCount === 0}
              type="button"
              onClick={clearAnnotations}
              aria-label="清空标注"
              title="清空标注"
            >
              <Trash2 size={18} />
              <span>清空标注</span>
            </button>
            <div className="visual-toolbar-divider" />
            <button
              className="visual-toolbar-button"
              type="button"
              onClick={() => setToolbarOpen(false)}
              aria-label="收起标注工具"
              title="收起标注工具"
            >
              <X size={18} />
              <span>收起</span>
            </button>
          </div>
        ) : (
          <button className="visual-toolbar-collapsed" type="button" onClick={() => setToolbarOpen(true)} aria-label="打开标注工具" title="打开标注工具">
            <CircleDashed size={22} />
            {annotationCount > 0 ? <span className="visual-toolbar-collapsed-badge">{annotationCount}</span> : null}
          </button>
        )) : null}

        <div className="visual-browser-frame" data-empty={!activeSession ? "true" : "false"}>
          {developerMode ? (
          <header className="visual-preview-header visual-floating-panel">
            <span className="visual-browser-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <div>
              <span className="visual-preview-kicker">Preview</span>
              <strong>{activeSession?.title || "进入开发者模式后显示预览"}</strong>
              {activeSession ? <small>{activeSession.targetUrl}</small> : null}
            </div>
            {activeSession ? (
              <button
                className="visual-icon-button"
                type="button"
                onClick={() => setFrameVersion((value) => value + 1)}
                aria-label="刷新预览"
                title="刷新预览"
              >
                <RefreshCw size={16} />
              </button>
            ) : null}
          </header>
          ) : null}

          <div className="visual-preview-shell" data-empty={!activeSession ? "true" : "false"}>
            {activeSession && selfPreviewBlocked ? (
              <div className="visual-preview-blocked">
                <strong>不能预览 OpenGrove 自己</strong>
                <span>这里应该加载用户项目的网页，例如项目 dev server 地址，而不是当前 OpenGrove UI。</span>
              </div>
            ) : activeSession && previewIsUnavailable ? (
              <div className="visual-preview-blocked">
                <strong>预览服务未响应</strong>
                <span>{previewUnavailableMessage}</span>
                <code>{activeSession.targetUrl}</code>
              </div>
            ) : activeSession ? (
              <div ref={stageRef} className="visual-preview-stage">
                <iframe
                  ref={frameRef}
                  key={`${activeSession.id}:${props.previewReloadKey ?? 0}:${frameVersion}`}
                  className="visual-preview-frame"
                  src={activeSession.targetUrl}
                  title={activeSession.title}
                  sandbox="allow-downloads allow-forms allow-modals allow-pointer-lock allow-popups allow-same-origin allow-scripts"
                  onLoad={() => {
                    setPreviewUnavailable(false);
                    props.onPreviewLoaded(activeSession.id);
                  }}
                  onError={() => {
                    setPreviewUnavailable(true);
                    props.onPreviewFailed(activeSession.id, "preview_load_failed");
                  }}
                />
                <div
                  className="visual-draw-layer"
                  data-active={developerMode && tool !== "select" && !pendingAnnotation ? "true" : "false"}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerLeave={() => setHoverTarget(null)}
                >
                  {developerMode && hoverTarget ? <HoverTargetPreview target={hoverTarget} /> : null}
                  {developerMode && gesture ? <DraftGesture gesture={gesture} /> : null}
                </div>
                {developerMode ? (
                <div className="visual-annotation-layer">
                  {showMarkers
                    ? activeSession.annotations.map((annotation, index) => (
                      <AnnotationView
                        key={annotation.id}
                        annotation={annotation}
                        index={index}
                        onDelete={() => props.onDeleteAnnotation(activeSession.id, annotation.id)}
                      />
                    ))
                    : null}
                  {pendingAnnotation ? <PendingAnnotationPreview draft={pendingAnnotation} /> : null}
                </div>
                ) : null}
                {developerMode && pendingAnnotation ? (
                  <AnnotationPopup
                    draft={pendingAnnotation}
                    value={pendingComment}
                    onChange={setPendingComment}
                    onSubmit={submitPendingAnnotation}
                    onCancel={cancelPendingAnnotation}
                  />
                ) : null}
                {previewUnavailable ? (
                  <div className="visual-preview-unavailable">
                    <strong>预览服务未响应</strong>
                    <span>启动用户项目的 dev server 后刷新预览。</span>
                    <code>{activeSession.targetUrl}</code>
                  </div>
                ) : null}
              </div>
            ) : (
              <button className="visual-preview-empty" type="button" onClick={props.onCreateSession}>
                <Plus size={20} />
                <span>进入开发者模式后，项目预览会显示在这里</span>
              </button>
            )}
          </div>
        </div>
      </section>

      {developerMode ? (allowAiCollapse && aiPanelCollapsed ? (
        <aside className="visual-developer-ai-rail" aria-label="开发对话已收起">
          <button
            className="visual-ai-rail-tab"
            type="button"
            style={{ "--visual-ai-rail-bottom": `${aiRailBottom}px` } as CSSProperties}
            data-dragging={aiRailDragging ? "true" : "false"}
            onMouseDown={onAiRailMouseDown}
            onClick={openCollapsedAiPanel}
            aria-label="展开开发对话，拖动可调整位置"
            title="展开开发对话；拖动可调整位置"
          >
            <span className="visual-ai-rail-mark">
              <OpenGroveSaplingMark />
            </span>
          </button>
        </aside>
      ) : (
        <>
        <div
          className="visual-ai-resize-handle"
          role="separator"
          aria-label="调整开发对话宽度"
          aria-orientation="vertical"
          onPointerDown={onAiPanelResizePointerDown}
        />
        <aside className="visual-developer-ai-panel library-ai-panel" aria-label="开发对话">
          <header className="library-ai-header">
            <div className="library-ai-conversation-controls">
              <button className="library-ai-thread-button" type="button" disabled>
                <span>{activeSession ? activeSession.title : "开发对话"}</span>
              </button>
            </div>
            {allowAiCollapse ? (
              <button
                className="visual-icon-button visual-ai-collapse-button"
                type="button"
                onClick={() => setAiPanelCollapsed(true)}
                aria-label="收起开发对话"
                title="收起开发对话"
              >
                <PanelRightClose size={16} />
              </button>
            ) : null}
          </header>
          {props.corePanel}
        </aside>
        </>
      )) : null}
    </section>
  );

  function onAiPanelResizePointerDown(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    aiPanelResizeRef.current = {
      startClientX: event.clientX,
      startWidth: aiPanelWidth,
    };
    document.body.dataset.sidebarResizing = "true";
    window.addEventListener("pointermove", onAiPanelResizePointerMove);
    window.addEventListener("pointerup", onAiPanelResizePointerUp, { once: true });
  }

  function onAiPanelResizePointerMove(event: globalThis.PointerEvent) {
    const resize = aiPanelResizeRef.current;
    if (!resize) return;
    const nextWidth = clamp(
      resize.startWidth - (event.clientX - resize.startClientX),
      VISUAL_AI_PANEL_MIN_WIDTH,
      VISUAL_AI_PANEL_MAX_WIDTH,
    );
    setAiPanelWidth(nextWidth);
    writeVisualAiPanelWidth(nextWidth);
  }

  function onAiPanelResizePointerUp() {
    aiPanelResizeRef.current = null;
    delete document.body.dataset.sidebarResizing;
    window.removeEventListener("pointermove", onAiPanelResizePointerMove);
  }
}

function ToolButton(props: { active: boolean; label: string; icon: ReactNode; onClick(): void }) {
  return (
    <button
      className="visual-toolbar-button"
      data-active={props.active ? "true" : "false"}
      type="button"
      onClick={props.onClick}
      aria-label={props.label}
      title={props.label}
    >
      {props.icon}
      <span>{props.label}</span>
    </button>
  );
}

function PendingAnnotationPreview(props: { draft: PendingAnnotationDraft }) {
  const draft = props.draft;
  if (draft.points?.length) {
    return (
      <div className="visual-annotation-stroke visual-annotation-pending">
        <svg className="visual-annotation-svg" viewBox={`0 0 ${draft.viewport.width} ${draft.viewport.height}`} preserveAspectRatio="none">
          <polyline points={draft.points.map((point) => `${point.x},${point.y}`).join(" ")} />
        </svg>
      </div>
    );
  }
  if (!draft.rect) return null;
  return (
    <div
      className={clsx("visual-annotation-box", "visual-annotation-pending", draft.kind === "note" && "visual-annotation-note")}
      style={rectToStyle(draft.rect, draft.viewport)}
    />
  );
}

function HoverTargetPreview(props: { target: HoverTarget }) {
  return (
    <div className="visual-hover-target" style={rectToStyle(props.target.rect, props.target.viewport)}>
      <span>{props.target.label}</span>
    </div>
  );
}

function AnnotationPopup(props: {
  draft: PendingAnnotationDraft;
  value: string;
  onChange(value: string): void;
  onSubmit(): void;
  onCancel(): void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    props.onSubmit();
  }

  return (
    <form className="visual-annotation-popup" style={pointToStyle(props.draft.anchor, props.draft.viewport)} onSubmit={submit}>
      <div className="visual-annotation-popup-header">
        <span>{pendingKindLabel(props.draft.kind)}</span>
        <button type="button" onClick={props.onCancel} aria-label="取消标注" title="取消">
          <X size={13} />
        </button>
      </div>
      <textarea
        autoFocus
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder="描述你希望 Core 修改什么"
      />
      <div className="visual-annotation-popup-actions">
        <button type="button" onClick={props.onCancel}>取消</button>
        <button type="submit">添加标注</button>
      </div>
    </form>
  );
}

function AnnotationView(props: {
  annotation: VisualAnnotation;
  index: number;
  onDelete(): void;
}) {
  const annotation = props.annotation;
  const status = annotationStatus(annotation);
  if (annotation.points?.length) {
    const firstPoint = annotation.points[0] ?? { x: 0, y: 0 };
    return (
      <div className="visual-annotation-stroke" data-status={status}>
        <svg className="visual-annotation-svg" viewBox={`0 0 ${annotation.viewport.width} ${annotation.viewport.height}`} preserveAspectRatio="none">
          <polyline points={annotation.points.map((point) => `${point.x},${point.y}`).join(" ")} />
        </svg>
        <span className="visual-annotation-stroke-badge" style={pointToStyle(firstPoint, annotation.viewport)}>
          <AnnotationBadge annotation={annotation} index={props.index} onDelete={props.onDelete} />
        </span>
      </div>
    );
  }
  if (!annotation.rect) return null;
  const style = rectToStyle(annotation.rect, annotation.viewport);
  return (
    <div
      className={clsx("visual-annotation-box", annotation.kind === "note" && "visual-annotation-note")}
      data-status={status}
      style={style}
    >
      <AnnotationBadge annotation={annotation} index={props.index} onDelete={props.onDelete} />
    </div>
  );
}

function AnnotationBadge(props: {
  annotation: VisualAnnotation;
  index: number;
  onDelete(): void;
}) {
  const status = annotationStatus(props.annotation);
  return (
    <span className="visual-annotation-badge" data-status={status} title={`${status} · ${props.annotation.comment || props.annotation.kind}`}>
      <span className="visual-annotation-badge-number">{props.index + 1}</span>
      <i className="visual-annotation-status-dot" aria-hidden="true" />
      {props.annotation.comment ? <strong>{props.annotation.comment}</strong> : null}
      <button type="button" onClick={props.onDelete} aria-label="删除标注" title="删除标注">
        <Trash2 size={12} />
      </button>
    </span>
  );
}

function DraftGesture(props: { gesture: Gesture }) {
  const gesture = props.gesture;
  if (gesture.kind === "stroke") {
    return (
      <svg className="visual-annotation-svg visual-annotation-draft" viewBox={`0 0 ${gesture.viewport.width} ${gesture.viewport.height}`} preserveAspectRatio="none">
        <polyline points={gesture.points.map((point) => `${point.x},${point.y}`).join(" ")} />
      </svg>
    );
  }
  const rect = normalizeRect(gesture.start, gesture.current, gesture.kind === "note");
  return <div className="visual-annotation-box visual-annotation-draft" style={rectToStyle(rect, gesture.viewport)} />;
}
