import { resolve } from "node:path";
import type { AgentTurnRequest } from "../../core.js";
import type { CodexAppServerClient } from "./app-server-client.js";
import type { CodexTurnInputItem } from "./types.js";

export function buildCodexDeveloperInstructions(): string {
  const sections = [
    "You are running inside the OpenGrove host.",
    "Use Codex native tools for local workspace operations, and use OpenGrove dynamic tools for browser state, memory, skills, and host actions when they are available.",
    "Do not treat an installed skill, slash-menu entry, plan, text direction, or prompt as a completed artifact. For image tasks, only say images were generated if a real image generation tool/item produced image output and the final response includes renderable image references.",
    "When you need the user to choose from structured options, prefer the OpenGrove dynamic tool `host.ui.requestChoices`. For step-by-step flows, ask one question per tool call. After it returns, stop; the host submit button sends the user's choice as the next user turn.",
    "When an OpenGrove dynamic tool returns an approval_required result, stop and explain that the run is waiting for host approval.",
    "The host may attach a fresh per-turn context block to the user message. Treat that block as current host state for the turn; do not assume older host context in the Codex thread is still current.",
  ];
  return sections.filter((section) => typeof section === "string" && section.trim()).join("\n\n");
}

export function buildCodexTurnInput(request: AgentTurnRequest): string {
  const sections = [
    request.assembledContext?.promptBlock?.trim()
      ? `Host context for this turn:\n${request.assembledContext.promptBlock.trim()}`
      : "",
    buildRequestedSkillSection(request),
    `User request:\n${request.input}`,
  ];
  return sections.filter((section) => typeof section === "string" && section.trim()).join("\n\n");
}

export function buildCodexTurnInputItems(request: AgentTurnRequest, text: string): CodexTurnInputItem[] {
  const items: CodexTurnInputItem[] = [{ type: "text", text, text_elements: [] }];
  const skillItem = buildCodexSkillInputItem(request);
  if (skillItem) {
    items.push(skillItem);
  }
  for (const attachment of request.context.page?.attachments ?? []) {
    if (attachment.localPath) {
      items.push({
        type: "mention",
        name: attachment.name,
        path: attachment.localPath,
      });
    }
    if (attachment.kind !== "image" || !attachment.dataUrl || !attachment.dataUrl.startsWith("data:image/")) {
      continue;
    }
    items.push({
      type: "image",
      url: attachment.dataUrl,
      detail: "auto",
    });
  }
  return items;
}

export async function refreshCodexNativeSkillList(
  client: CodexAppServerClient,
  cwd: string,
  request: AgentTurnRequest,
): Promise<void> {
  const invocation = request.requestedSkillInvocation;
  if (!invocation || invocation.content.trim() || !invocation.sourcePath) {
    return;
  }
  if (!isProjectCodexSkillPath(invocation.sourcePath, cwd)) {
    return;
  }
  try {
    await client.request(
      "skills/list",
      {
        cwds: [cwd],
        forceReload: true,
      },
      { timeoutMs: 10_000, signal: request.signal },
    );
  } catch {
    // Skill-list refresh is a cache hint. A failure here should not block a
    // turn that already carries the exact native skill input item.
  }
}

export function imageGenerationTruthCorrection(request: AgentTurnRequest, finalText: string, generatedImageCount: number): string {
  const skillName = request.requestedSkillInvocation?.skillName;
  if (skillName !== "bottle-reference-brief") {
    return "";
  }
  if (generatedImageCount > 0 || hasRenderableImageMarkdown(finalText)) {
    return "";
  }
  if (!/(已生成|生成.{0,12}(图|图片|产品图)|可见.{0,8}(图|图片)|方向图)/.test(finalText)) {
    return "";
  }
  return [
    "更正：当前这一轮没有收到真实 `imageGeneration` 结果，也没有可渲染图片文件，所以不能视为已经生成了图片。",
    "上面的内容只能算 brief 或方向说明。这个 skill 在没有真实图像生成工具时应该降级为 4 条白底产品图 prompt，而不是把文字方向当作图片产物。",
  ].join("\n");
}

function buildRequestedSkillSection(request: AgentTurnRequest): string {
  const invocation = request.requestedSkillInvocation;
  if (!invocation) {
    return "";
  }
  if (!invocation.content.trim()) {
    return [
      `Native Codex skill selected: $${invocation.skillName}`,
      `Skill path: ${invocation.sourcePath}`,
      invocation.allowedTools.length
        ? `Host-declared tool scope for this skill: ${invocation.allowedTools.join(", ")}`
        : "",
      "Do not reload this skill through an OpenGrove tool; the Codex skill input item carries the native skill reference.",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    `Loaded host skill for this turn /${invocation.skillName}:`,
    invocation.content,
    invocation.allowedTools.length
      ? `Host-declared tool scope for this skill: ${invocation.allowedTools.join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildCodexSkillInputItem(request: AgentTurnRequest): CodexTurnInputItem | undefined {
  const invocation = request.requestedSkillInvocation;
  if (!invocation || invocation.content.trim() || !invocation.sourcePath) {
    return undefined;
  }
  return {
    type: "skill",
    name: invocation.skillName,
    path: invocation.sourcePath,
  };
}

function isProjectCodexSkillPath(path: string, cwd: string): boolean {
  const normalizedPath = resolve(path).replace(/\\/g, "/");
  const normalizedRoot = resolve(cwd, ".codex", "skills").replace(/\\/g, "/");
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

function hasRenderableImageMarkdown(text: string): boolean {
  return /!\[[^\]]*]\((?:\/generated\/|data:image\/|https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/)[^)]+\)/.test(text);
}
