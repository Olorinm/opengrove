import type { VisualAnnotationPoint, VisualAnnotationRect } from "../../bridge";

type JsonRecord = Record<string, unknown>;

interface ReactFiberLike extends JsonRecord {
  return?: ReactFiberLike | null;
  type?: unknown;
  elementType?: unknown;
  _debugOwner?: ReactFiberLike | null;
  _debugSource?: unknown;
}

export function collectVisualAnnotationTarget(input: {
  iframe: HTMLIFrameElement | null;
  stage: HTMLElement | null;
  point?: VisualAnnotationPoint;
  rect?: VisualAnnotationRect;
}): JsonRecord | undefined {
  const iframe = input.iframe;
  const stage = input.stage;
  if (!iframe || !stage) return undefined;

  let frameDocument: Document | null | undefined;
  let frameWindow: Window | null | undefined;
  try {
    frameDocument = iframe.contentDocument;
    frameWindow = iframe.contentWindow;
    void frameDocument?.body;
  } catch {
    return unavailableTarget("cross_origin_or_unloaded");
  }
  if (!frameDocument || !frameWindow) return unavailableTarget("frame_not_ready");

  const frameBounds = iframe.getBoundingClientRect();
  const stageBounds = stage.getBoundingClientRect();
  const framePoint = toFramePoint(input.point ?? rectCenter(input.rect), stageBounds, frameBounds);
  const frameRect = input.rect ? toFrameRect(input.rect, stageBounds, frameBounds) : undefined;
  const element = framePoint ? deepElementFromPoint(frameDocument, framePoint.x, framePoint.y) : null;
  const meaningfulElements = frameRect ? collectMeaningfulElementsInRect(frameDocument, frameRect) : [];
  const primaryElement = normalizeElement(element) ?? meaningfulElements[0]?.element ?? null;

  if (!primaryElement) {
    return {
      capture: captureMeta(frameWindow, "no_element_at_point"),
      selectionRect: frameRect,
    };
  }

  const reactInfo = collectReactInfo(primaryElement);
  const accessibility = collectAccessibility(primaryElement);
  const computedStyles = collectComputedStyles(frameWindow, primaryElement);
  const selectedText = truncate(frameDocument.getSelection?.()?.toString().trim() ?? "", 600);
  const selector = uniqueSelector(primaryElement, frameDocument, frameWindow);
  const sourceHint = reactInfo.sourceFile || sourceHintFromAttributes(primaryElement);

  return {
    capture: captureMeta(frameWindow, "ok"),
    selector,
    elementPath: elementPath(primaryElement),
    fullPath: fullDomPath(primaryElement),
    tagName: primaryElement.tagName.toLowerCase(),
    text: elementText(primaryElement),
    className: primaryElement.className || undefined,
    cssClasses: classList(primaryElement),
    ariaLabel: accessibility.ariaLabel,
    role: accessibility.role,
    boundingBox: domRect(primaryElement.getBoundingClientRect()),
    selectionRect: frameRect,
    selectedText: selectedText || undefined,
    nearbyText: nearbyText(primaryElement),
    nearbyElements: nearbyElements(primaryElement),
    computedStyles,
    accessibility,
    isFixed: computedStyles.position === "fixed",
    reactPath: reactInfo.reactPath,
    reactComponents: reactInfo.components,
    sourceHint,
    sourceFile: reactInfo.sourceFile,
    elementBoundingBoxes: meaningfulElements.map((item) => ({
      selector: uniqueSelector(item.element, frameDocument, frameWindow),
      tagName: item.element.tagName.toLowerCase(),
      text: elementText(item.element),
      boundingBox: item.boundingBox,
    })),
  };
}

function unavailableTarget(reason: string): JsonRecord {
  return {
    capture: {
      status: "unavailable",
      reason,
    },
  };
}

function captureMeta(frameWindow: Window, status: string): JsonRecord {
  return {
    status,
    origin: "iframe-dom",
    url: safeLocationHref(frameWindow),
    capturedAt: new Date().toISOString(),
  };
}

function safeLocationHref(frameWindow: Window): string | undefined {
  try {
    return frameWindow.location.href;
  } catch {
    return undefined;
  }
}

function rectCenter(rect: VisualAnnotationRect | undefined): VisualAnnotationPoint | undefined {
  if (!rect) return undefined;
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

function toFramePoint(
  point: VisualAnnotationPoint | undefined,
  stageBounds: DOMRect,
  frameBounds: DOMRect,
): VisualAnnotationPoint | undefined {
  if (!point) return undefined;
  return {
    x: clamp(point.x + stageBounds.left - frameBounds.left, 0, frameBounds.width),
    y: clamp(point.y + stageBounds.top - frameBounds.top, 0, frameBounds.height),
  };
}

function toFrameRect(rect: VisualAnnotationRect, stageBounds: DOMRect, frameBounds: DOMRect): VisualAnnotationRect {
  const topLeft = toFramePoint({ x: rect.x, y: rect.y }, stageBounds, frameBounds) ?? { x: 0, y: 0 };
  const bottomRight = toFramePoint({ x: rect.x + rect.width, y: rect.y + rect.height }, stageBounds, frameBounds) ?? topLeft;
  return {
    x: Math.min(topLeft.x, bottomRight.x),
    y: Math.min(topLeft.y, bottomRight.y),
    width: Math.max(1, Math.abs(bottomRight.x - topLeft.x)),
    height: Math.max(1, Math.abs(bottomRight.y - topLeft.y)),
  };
}

function deepElementFromPoint(document: Document, x: number, y: number): Element | null {
  let element = document.elementFromPoint(x, y);
  while (element?.shadowRoot) {
    const nested = element.shadowRoot.elementFromPoint(x, y);
    if (!nested || nested === element) break;
    element = nested;
  }
  return normalizeElement(element);
}

function normalizeElement(element: Element | null): Element | null {
  if (!element) return null;
  const tagName = element.tagName.toLowerCase();
  if (tagName === "html") return element.ownerDocument.body || element;
  return element;
}

function collectMeaningfulElementsInRect(document: Document, rect: VisualAnnotationRect) {
  const selector = [
    "button",
    "a",
    "input",
    "textarea",
    "select",
    "img",
    "video",
    "canvas",
    "svg",
    "[role]",
    "[aria-label]",
    "[data-testid]",
    "[data-test-id]",
    "[data-cy]",
    "h1",
    "h2",
    "h3",
    "p",
    "li",
    "label",
  ].join(",");
  return Array.from(document.querySelectorAll(selector))
    .slice(0, 500)
    .map((element) => ({ element, boundingBox: domRect(element.getBoundingClientRect()) }))
    .filter((item) => intersects(item.boundingBox, rect))
    .slice(0, 16);
}

function intersects(left: VisualAnnotationRect, right: VisualAnnotationRect): boolean {
  return left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y;
}

function uniqueSelector(element: Element, document: Document, frameWindow: Window): string | undefined {
  const id = element.getAttribute("id");
  if (id) {
    const selector = `#${cssEscape(id, frameWindow)}`;
    if (isUniqueSelector(selector, document)) return selector;
  }

  for (const attribute of ["data-testid", "data-test-id", "data-cy", "aria-label", "name"]) {
    const value = element.getAttribute(attribute);
    if (!value) continue;
    const selector = `${element.tagName.toLowerCase()}[${attribute}="${cssString(value)}"]`;
    if (isUniqueSelector(selector, document)) return selector;
  }

  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    const part = selectorPart(current, frameWindow);
    parts.unshift(part);
    const selector = parts.join(" > ");
    if (isUniqueSelector(selector, document)) return selector;
    current = current.parentElement;
    if (current?.tagName.toLowerCase() === "html") break;
  }
  return parts.join(" > ") || undefined;
}

function selectorPart(element: Element, frameWindow: Window): string {
  const tagName = element.tagName.toLowerCase();
  const id = element.getAttribute("id");
  if (id) return `${tagName}#${cssEscape(id, frameWindow)}`;
  const classes = classList(element).slice(0, 2).map((className) => `.${cssEscape(className, frameWindow)}`).join("");
  const parent = element.parentElement;
  if (!parent) return `${tagName}${classes}`;
  const sameTagSiblings = Array.from(parent.children).filter((item) => item.tagName === element.tagName);
  if (sameTagSiblings.length <= 1) return `${tagName}${classes}`;
  return `${tagName}${classes}:nth-of-type(${sameTagSiblings.indexOf(element) + 1})`;
}

function isUniqueSelector(selector: string, document: Document): boolean {
  try {
    return document.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

function cssEscape(value: string, frameWindow: Window): string {
  const escape = (frameWindow as Window & { CSS?: { escape?: (value: string) => string } }).CSS?.escape;
  if (typeof escape === "function") return escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
}

function cssString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function elementPath(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && parts.length < 6) {
    const tagName = current.tagName.toLowerCase();
    const id = current.getAttribute("id");
    const classes = classList(current).slice(0, 2).map((className) => `.${className}`).join("");
    const label = current.getAttribute("aria-label") || directText(current);
    parts.unshift(`${tagName}${id ? `#${id}` : classes}${label ? ` "${truncate(label, 32)}"` : ""}`);
    current = current.parentElement;
  }
  return parts.join(" > ");
}

function fullDomPath(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current) {
    parts.unshift(selectorPart(current, element.ownerDocument.defaultView ?? window));
    current = current.parentElement;
  }
  return parts.join(" > ");
}

function collectReactInfo(element: Element): {
  reactPath?: string;
  components?: string[];
  sourceFile?: string;
} {
  const fiber = reactFiberFromElement(element);
  if (!fiber) return {};
  const components: string[] = [];
  let sourceFile: string | undefined;
  let current: ReactFiberLike | null | undefined = fiber;
  let depth = 0;
  while (current && depth < 32) {
    const name = reactComponentName(current);
    if (name && !components.includes(name)) {
      components.unshift(name);
    }
    sourceFile ??= sourceFromFiber(current);
    current = current.return;
    depth += 1;
  }
  return {
    reactPath: components.length ? components.join(" > ") : undefined,
    components: components.length ? components : undefined,
    sourceFile,
  };
}

function reactFiberFromElement(element: Element): ReactFiberLike | undefined {
  const record = element as unknown as JsonRecord;
  const key = Object.keys(record).find((item) =>
    item.startsWith("__reactFiber$") ||
    item.startsWith("__reactInternalInstance$") ||
    item.startsWith("__reactProps$"));
  if (!key) return undefined;
  const value = record[key];
  return isRecord(value) ? value as ReactFiberLike : undefined;
}

function reactComponentName(fiber: ReactFiberLike): string | undefined {
  return componentName(fiber.elementType) || componentName(fiber.type);
}

function componentName(value: unknown): string | undefined {
  if (typeof value === "string") return undefined;
  if (typeof value === "function") {
    const named = value as { displayName?: string; name?: string };
    return cleanComponentName(named.displayName || named.name);
  }
  if (isRecord(value)) {
    const displayName = typeof value.displayName === "string" ? value.displayName : "";
    const name = typeof value.name === "string" ? value.name : "";
    const render = isRecord(value.render) ? componentName(value.render) : "";
    const nestedType = isRecord(value.type) ? componentName(value.type) : "";
    return cleanComponentName(displayName || name || render || nestedType);
  }
  return undefined;
}

function cleanComponentName(name: string | undefined): string | undefined {
  const trimmed = name?.trim();
  if (!trimmed || trimmed === "Fragment" || trimmed === "ForwardRef" || trimmed.startsWith("bound ")) return undefined;
  return trimmed;
}

function sourceFromFiber(fiber: ReactFiberLike): string | undefined {
  const source = sourceRecord(fiber._debugSource) ?? sourceRecord(fiber._debugOwner?._debugSource);
  if (!source) return undefined;
  const fileName = typeof source.fileName === "string" ? source.fileName : "";
  if (!fileName) return undefined;
  const lineNumber = typeof source.lineNumber === "number" ? source.lineNumber : undefined;
  const columnNumber = typeof source.columnNumber === "number" ? source.columnNumber : undefined;
  return [fileName, lineNumber, columnNumber].filter((item) => item !== undefined && item !== "").join(":");
}

function sourceRecord(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function sourceHintFromAttributes(element: Element): string | undefined {
  for (const attribute of ["data-source", "data-source-file", "data-file", "data-component"]) {
    const value = element.getAttribute(attribute);
    if (value) return value;
  }
  return undefined;
}

function collectAccessibility(element: Element): JsonRecord {
  return {
    role: element.getAttribute("role") || implicitRole(element) || undefined,
    ariaLabel: element.getAttribute("aria-label") || undefined,
    title: element.getAttribute("title") || undefined,
    placeholder: element.getAttribute("placeholder") || undefined,
    alt: element.getAttribute("alt") || undefined,
  };
}

function implicitRole(element: Element): string | undefined {
  const tagName = element.tagName.toLowerCase();
  if (tagName === "button") return "button";
  if (tagName === "a" && element.getAttribute("href")) return "link";
  if (tagName === "input" || tagName === "textarea") return "textbox";
  if (/^h[1-6]$/.test(tagName)) return "heading";
  if (tagName === "img") return "img";
  return undefined;
}

function collectComputedStyles(frameWindow: Window, element: Element): JsonRecord {
  const styles = frameWindow.getComputedStyle(element);
  return {
    display: styles.display,
    position: styles.position,
    zIndex: styles.zIndex,
    color: styles.color,
    backgroundColor: styles.backgroundColor,
    fontSize: styles.fontSize,
    fontWeight: styles.fontWeight,
    lineHeight: styles.lineHeight,
    width: styles.width,
    height: styles.height,
    padding: styles.padding,
    margin: styles.margin,
    borderRadius: styles.borderRadius,
  };
}

function nearbyText(element: Element): string | undefined {
  const text = element.parentElement?.textContent || element.textContent || "";
  return truncate(normalizeWhitespace(text), 700) || undefined;
}

function nearbyElements(element: Element): JsonRecord[] {
  const parent = element.parentElement;
  if (!parent) return [];
  return Array.from(parent.children)
    .filter((item) => item !== element)
    .slice(0, 8)
    .map((item) => ({
      tagName: item.tagName.toLowerCase(),
      text: elementText(item),
      className: item.className || undefined,
      role: item.getAttribute("role") || implicitRole(item) || undefined,
    }));
}

function classList(element: Element): string[] {
  return Array.from(element.classList).filter(Boolean).slice(0, 12);
}

function elementText(element: Element): string | undefined {
  const value = element.getAttribute("aria-label") ||
    element.getAttribute("title") ||
    element.getAttribute("placeholder") ||
    directText(element) ||
    element.textContent ||
    "";
  return truncate(normalizeWhitespace(value), 240) || undefined;
}

function directText(element: Element): string {
  return Array.from(element.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent || "")
    .join(" ")
    .trim();
}

function domRect(rect: DOMRect): VisualAnnotationRect {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number): string {
  const normalized = normalizeWhitespace(value);
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
