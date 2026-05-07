import { useEffect, useMemo, useRef } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownKeymap, pasteURLAsLink } from "@codemirror/lang-markdown";
import { bracketMatching, defaultHighlightStyle, HighlightStyle, indentOnInput, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { EditorState, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, drawSelection, dropCursor, EditorView, highlightActiveLine, highlightSpecialChars, keymap, placeholder, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { tags } from "@lezer/highlight";

interface MarkdownCodeEditorProps {
  value: string;
  format: string;
  autoFocus?: boolean;
  placeholder?: string;
  onChange(value: string): void;
}

const markdownHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, class: "tok-heading" },
  { tag: tags.emphasis, class: "tok-emphasis" },
  { tag: tags.strong, class: "tok-strong" },
  { tag: tags.link, class: "tok-link" },
  { tag: tags.url, class: "tok-url" },
  { tag: tags.monospace, class: "tok-monospace" },
]);

const headingClasses = new Map([
  ["ATXHeading1", "cm-md-heading cm-md-heading-1"],
  ["ATXHeading2", "cm-md-heading cm-md-heading-2"],
  ["ATXHeading3", "cm-md-heading cm-md-heading-3"],
  ["ATXHeading4", "cm-md-heading cm-md-heading-4"],
  ["ATXHeading5", "cm-md-heading cm-md-heading-5"],
  ["ATXHeading6", "cm-md-heading cm-md-heading-6"],
  ["SetextHeading1", "cm-md-heading cm-md-heading-1"],
  ["SetextHeading2", "cm-md-heading cm-md-heading-2"],
]);

const syntaxMarkNodes = new Set(["HeaderMark", "EmphasisMark", "LinkMark", "CodeMark", "CodeInfo", "ListMark", "QuoteMark"]);

const markdownLivePreviewDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildMarkdownLivePreviewDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildMarkdownLivePreviewDecorations(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
);

function buildMarkdownLivePreviewDecorations(view: EditorView): DecorationSet {
  const decorations: Array<Range<Decoration>> = [];
  const activeLine = view.state.doc.lineAt(view.state.selection.main.head);
  decorations.push(Decoration.line({ class: "cm-md-active-line" }).range(activeLine.from));
  const frontmatterEnd = markdownFrontmatterEnd(view.state.doc.toString());
  if (frontmatterEnd > 0) {
    let line = view.state.doc.lineAt(0);
    while (line.from < frontmatterEnd) {
      decorations.push(Decoration.line({ class: "cm-md-frontmatter-line" }).range(line.from));
      if (line.to >= frontmatterEnd || line.number >= view.state.doc.lines) break;
      line = view.state.doc.line(line.number + 1);
    }
  }
  syntaxTree(view.state).iterate({
    enter(node) {
      const name = node.name;
      const inFrontmatter = frontmatterEnd > 0 && node.from < frontmatterEnd && node.to <= frontmatterEnd;
      if (inFrontmatter) return false;
      const onActiveLine = node.from <= activeLine.to && node.to >= activeLine.from;
      const headingClass = headingClasses.get(name);
      if (headingClass) {
        decorations.push(Decoration.mark({ class: headingClass }).range(node.from, node.to));
      }
      if (syntaxMarkNodes.has(name)) {
        decorations.push(
          Decoration.mark({ class: onActiveLine ? "cm-md-syntax cm-md-syntax-active" : "cm-md-syntax cm-md-syntax-muted" }).range(node.from, node.to),
        );
      }
      if (name === "URL" && !onActiveLine) {
        decorations.push(Decoration.mark({ class: "cm-md-link-url-muted" }).range(node.from, node.to));
      }
    },
  });
  return Decoration.set(decorations, true);
}

function markdownFrontmatterEnd(text: string): number {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return 0;
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) return 0;
  return end + "\n---".length;
}

export function MarkdownCodeEditor(props: MarkdownCodeEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(props.onChange);
  const valueRef = useRef(props.value);
  const extensions = useMemo(() => {
    const base = [
      highlightSpecialChars(),
      history(),
      drawSelection(),
      highlightActiveLine(),
      dropCursor(),
      indentOnInput(),
      bracketMatching(),
      EditorView.lineWrapping,
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      syntaxHighlighting(markdownHighlightStyle),
      markdownLivePreviewDecorations,
      keymap.of([...markdownKeymap, indentWithTab, ...defaultKeymap, ...historyKeymap]),
      pasteURLAsLink,
      placeholder(props.placeholder ?? ""),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        const nextValue = update.state.doc.toString();
        valueRef.current = nextValue;
        onChangeRef.current(nextValue);
      }),
      EditorView.theme({
        "&": {
          background: "transparent",
          color: "#242721",
          fontSize: "15px",
        },
        ".cm-scroller": {
          fontFamily: "inherit",
          lineHeight: "1.75",
        },
        ".cm-content": {
          padding: "0",
          caretColor: "#20221d",
          minHeight: "calc(100vh - 230px)",
        },
        ".cm-line": {
          padding: "0",
        },
        ".cm-activeLine": {
          backgroundColor: "transparent",
        },
        ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
          backgroundColor: "#d9d4c8 !important",
        },
        ".cm-cursor": {
          borderLeftColor: "#20221d",
        },
        ".cm-placeholder": {
          color: "#b5b4ad",
        },
        ".cm-gutters": {
          display: "none",
        },
        "&.cm-focused": {
          outline: "none",
        },
      }),
    ];
    if (props.format === "markdown") {
      base.splice(6, 0, markdown());
    }
    return base;
  }, [props.format, props.placeholder]);

  useEffect(() => {
    onChangeRef.current = props.onChange;
  }, [props.onChange]);

  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: props.value,
        extensions,
      }),
    });
    viewRef.current = view;
    valueRef.current = props.value;
    if (props.autoFocus) {
      view.focus();
    }
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [extensions]);

  useEffect(() => {
    if (props.autoFocus) {
      viewRef.current?.focus();
    }
  }, [props.autoFocus]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentValue = view.state.doc.toString();
    if (props.value === currentValue || props.value === valueRef.current) return;
    valueRef.current = props.value;
    view.dispatch({
      changes: { from: 0, to: currentValue.length, insert: props.value },
    });
  }, [props.value]);

  return <div className="knowledge-markdown-codemirror" ref={hostRef} />;
}
