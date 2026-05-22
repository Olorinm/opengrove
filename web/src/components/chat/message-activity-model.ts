import type { SkillPart, ToolPart } from "../../bridge";
import { formatJson, summarize } from "../../format";

export type ActivityItem =
  | { type: "skill"; key: string; part: SkillPart }
  | { type: "approval"; key: string; part: ToolPart }
  | { type: "tool"; key: string; call?: ToolPart; result?: ToolPart };

export interface ActivityEntry {
  groupKey: string;
  item: ActivityItem;
}

export interface ChoiceFormOption {
  value: string;
  label: string;
  description: string;
}

export interface ChoiceFormQuestion {
  id: string;
  prompt: string;
  options: ChoiceFormOption[];
}

export interface ChoiceForm {
  title: string;
  instructions: string;
  submitLabel: string;
  questions: ChoiceFormQuestion[];
}

export function buildActivityItems(parts: Array<ToolPart | SkillPart>): ActivityItem[] {
  const items: ActivityItem[] = [];
  const usedResultIndexes = new Set<number>();

  parts.forEach((part, index) => {
    if (part.type === "skill") {
      items.push({ type: "skill", key: part.id, part });
      return;
    }

    if (part.phase === "approval") {
      items.push({ type: "approval", key: part.id, part });
      return;
    }

    if (part.phase === "call") {
      const resultIndex = parts.findIndex(
        (candidate, candidateIndex) =>
          candidateIndex > index &&
          candidate.type === "tool" &&
          candidate.phase === "result" &&
          candidate.toolId === part.toolId &&
          !usedResultIndexes.has(candidateIndex),
      );
      const result = resultIndex >= 0 && parts[resultIndex]?.type === "tool"
        ? (parts[resultIndex] as ToolPart)
        : undefined;
      if (result) {
        usedResultIndexes.add(resultIndex);
      }
      items.push({ type: "tool", key: result ? `${part.id}:${result.id}` : part.id, call: part, result });
      return;
    }

    if (part.phase === "result" && !usedResultIndexes.has(index)) {
      items.push({ type: "tool", key: part.id, result: part });
    }
  });

  return items;
}

export function choiceFormFromItem(item: ActivityItem): ChoiceForm | null {
  if (item.type !== "tool") {
    return null;
  }
  const value = recordValue(item.result?.result);
  if (stringValue(value.kind) !== "choice_form") {
    return null;
  }
  const questions = Array.isArray(value.questions)
    ? value.questions
        .map((question, index) => {
          const questionValue = recordValue(question);
          const options = Array.isArray(questionValue.options)
            ? questionValue.options
                .map((option, optionIndex) => {
                  const optionValue = recordValue(option);
                  const label = stringValue(optionValue.label);
                  if (!label) {
                    return null;
                  }
                  return {
                    value: stringValue(optionValue.value) || String(optionIndex + 1),
                    label,
                    description: stringValue(optionValue.description),
                  };
                })
                .filter((option): option is ChoiceFormOption => Boolean(option))
            : [];
          const prompt = stringValue(questionValue.prompt);
          if (!prompt || !options.length) {
            return null;
          }
          return {
            id: stringValue(questionValue.id) || `q${index + 1}`,
            prompt,
            options,
          };
        })
        .filter((question): question is ChoiceFormQuestion => Boolean(question))
    : [];
  if (!questions.length) {
    return null;
  }
  return {
    title: stringValue(value.title) || "请选择",
    instructions: stringValue(value.instructions),
    submitLabel: stringValue(value.submitLabel) || "提交",
    questions,
  };
}

export function summarizeActivityItems(
  items: ActivityItem[],
  options: {
    active?: boolean;
    pendingApproval?: boolean;
    activeChoiceForm?: boolean;
    fallbackStatus?: string;
  } = {},
): string {
  if (options.pendingApproval) {
    return "等待确认";
  }
  if (options.activeChoiceForm) {
    return "等待选择";
  }
  const stats = activityStats(items);
  const fragments: string[] = [];

  if (options.active) {
    return activeActivitySummary(items);
  }

  if (stats.readCount) {
    fragments.push(`已探索 ${stats.readCount} 个文件`);
  }
  if (stats.searchCount) {
    fragments.push(`${stats.searchCount} 次搜索`);
  }
  if (stats.skillNames.length === 1) {
    fragments.push(`使用了 /${stats.skillNames[0]}`);
  } else if (stats.skillNames.length > 1) {
    fragments.push(`使用了 ${stats.skillNames.length} 个 skill`);
  }
  if (stats.browseCount) {
    fragments.push(`浏览 ${stats.browseCount} 次`);
  }
  if (stats.commandCount) {
    fragments.push(`已运行 ${stats.commandCount} 条命令`);
  }
  if (stats.editCount) {
    fragments.push(`已编辑 ${stats.editCount} 个文件`);
  }
  if (stats.memoryCount) {
    fragments.push(`已处理 ${stats.memoryCount} 条记忆`);
  }
  if (stats.artifactCount) {
    fragments.push(`已产出 ${stats.artifactCount} 个成果`);
  }
  if (stats.choiceFormCount) {
    fragments.push(`${stats.choiceFormCount} 组问题`);
  }
  if (stats.approvalCount) {
    fragments.push(`${stats.approvalCount} 个动作`);
  }

  if (!fragments.length) {
    fragments.push(options.fallbackStatus || `已完成 ${items.length} 个步骤`);
  }

  return fragments.join(" ");
}

function activityStats(items: ActivityItem[]) {
  const skillNames = uniqueStrings(
    items
      .filter((item): item is Extract<ActivityItem, { type: "skill" }> => item.type === "skill")
      .map((item) => item.part.skillName || item.part.title || item.part.skillId),
  );
  return {
    skillNames,
    searchCount: items.filter((item) => activityItemKind(item) === "search").length,
    readCount: items.filter((item) => activityItemKind(item) === "read").length,
    browseCount: items.filter((item) => activityItemKind(item) === "browser").length,
    commandCount: items.filter((item) => activityItemKind(item) === "command").length,
    editCount: countEditedFiles(items),
    memoryCount: items.filter((item) => activityItemKind(item) === "memory").length,
    artifactCount: items.filter((item) => activityItemKind(item) === "artifact").length,
    choiceFormCount: items.filter((item) => Boolean(choiceFormFromItem(item))).length,
    approvalCount: items.filter((item) => item.type === "approval" && item.part.approvalStatus === "pending").length,
  };
}

function activeActivitySummary(items: ActivityItem[]): string {
  const runningItem = items.find((item) => activityItemStatus(item) === "running") || items[0];
  const target = activityTargetLabel(runningItem);
  switch (activityItemKind(runningItem)) {
    case "search":
      return target ? `正在搜索 ${target}` : "正在搜索文件";
    case "read":
      return target ? `正在读取 ${target}` : "正在读取文件";
    case "edit":
      return target ? `正在编辑 ${target}` : "正在编辑文件";
    case "command":
      return target ? `正在运行 ${target}` : "正在运行命令";
    case "browser":
      return target ? `正在浏览 ${target}` : "正在浏览页面";
    case "memory":
      return "正在处理记忆";
    case "artifact":
      return "正在生成结果";
    case "skill":
      return "正在加载能力";
    default:
      return "正在处理";
  }
}

export function primaryActivityKind(items: ActivityItem[]): string {
  const runningItem = items.find((item) => activityItemStatus(item) === "running");
  if (runningItem) {
    return activityItemKind(runningItem);
  }
  const priority = ["edit", "search", "read", "command", "browser", "artifact", "memory", "skill", "approval"];
  return priority.find((kind) => items.some((item) => activityItemKind(item) === kind)) || "tool";
}

function countEditedFiles(items: ActivityItem[]): number {
  const editItems = items.filter((item) => activityItemKind(item) === "edit");
  const files = uniqueStrings(editItems.flatMap(activityItemFileHints));
  return files.length || editItems.length;
}

export function activityItemTitle(item: ActivityItem): string {
  const status = activityItemStatus(item);
  if (item.type === "skill") {
    const name = item.part.skillName || item.part.title || item.part.skillId || "skill";
    return `${status === "running" ? "正在加载" : "已使用"} /${name.replace(/^\//, "")}`;
  }
  if (item.type === "approval") {
    return item.part.approvalStatus === "pending"
      ? `等待确认 · ${item.part.title || item.part.toolId || "动作"}`
      : `已${item.part.approvalStatus === "approved" ? "确认" : "拒绝"} · ${item.part.title || item.part.toolId || "动作"}`;
  }

  const tool = item.call || item.result;
  const kind = activityItemKind(item);
  const target = activityTargetLabel(item);
  if (kind === "search") return statusAwareTitle(status, "正在搜索", "已搜索", target || `文件 · ${toolPreview(tool)}`);
  if (kind === "read") return statusAwareTitle(status, "正在读取", "已读取", target || `文件 · ${filePreview(item)}`);
  if (kind === "command") return statusAwareTitle(status, "正在运行", "已运行", target || `命令 · ${toolPreview(tool)}`);
  if (kind === "edit") return statusAwareTitle(status, "正在编辑", "已编辑", target || `文件 · ${filePreview(item)}`);
  if (kind === "browser") return statusAwareTitle(status, "正在浏览", "已浏览", target || `网页 · ${toolPreview(tool)}`);
  if (kind === "memory") return statusAwareTitle(status, "正在处理", "已处理", `记忆 · ${toolPreview(tool)}`);
  if (kind === "artifact") return statusAwareTitle(status, "正在生成", "已生成", `结果 · ${toolPreview(tool)}`);
  return tool?.title || tool?.toolId || "工具调用";
}

function statusAwareTitle(status: string, runningPrefix: string, completedPrefix: string, label: string): string {
  const normalized = status.toLowerCase();
  if (normalized === "running") {
    return `${runningPrefix} ${label}`;
  }
  if (["blocked", "incomplete", "rejected", "failed", "error"].includes(normalized)) {
    return `未完成 ${label}`;
  }
  return `${completedPrefix} ${label}`;
}

export function activityItemDetail(item: ActivityItem): string {
  return activityItemDetailDisplay(item)?.label || "";
}

export function activityItemDetailDisplay(item: ActivityItem): { label: string; title?: string } | null {
  if (item.type === "skill") {
    const label = summarize(item.part.description || item.part.contentPreview || item.part.source || "", 150);
    return label ? { label } : null;
  }
  if (item.type === "approval") {
    const label = summarize(item.part.approvalReason || formatMessageValue(item.part.input), 150);
    return label ? { label } : null;
  }

  const kind = activityItemKind(item);
  const readable = activityItemReadableDetail(item);
  if (["command", "search", "read", "browser"].includes(kind)) {
    const label = summarize(compactActivityDetailPaths(readable), 160);
    return label ? { label, title: readable === label ? undefined : readable } : null;
  }
  const text = readable || activityItemRawText(item);
  const label = summarize(text, 160);
  return label ? { label } : null;
}

export function activityItemTitleTooltip(item: ActivityItem): string {
  if (item.type === "skill") {
    return item.part.source || item.part.skillId || item.part.skillName || "";
  }
  if (item.type === "approval") {
    return formatMessageValue(item.part.input);
  }
  const fileHints = activityItemFileHints(item);
  if (fileHints.length) {
    return fileHints.join("\n");
  }
  const tool = item.call || item.result;
  if (!tool) {
    return "";
  }
  const structured = structuredTargetLabel(tool);
  if (structured) {
    return structured;
  }
  return commandText(tool);
}

function activityItemReadableDetail(item: ActivityItem): string {
  if (item.type !== "tool") {
    return "";
  }
  const kind = activityItemKind(item);
  if (!["command", "search", "read", "browser"].includes(kind)) {
    return "";
  }
  const input = recordValue(item.call?.input || item.result?.input);
  const cwd = stringValue(input.cwd) || stringValue(input.workdir);
  const resultText = readableResultText(item.result?.result);
  const error = item.result?.error || item.call?.error || "";
  return [cwd ? `cwd: ${cwd}` : "", resultText, error].filter(Boolean).join(" · ");
}

function activityItemRawText(item: ActivityItem): string {
  if (item.type === "skill") {
    return [item.part.description, item.part.contentPreview, item.part.result].filter(Boolean).join("\n");
  }
  if (item.type === "approval") {
    return [item.part.approvalReason, formatMessageValue(item.part.input)].filter(Boolean).join("\n");
  }
  return [
    item.call ? formatMessageValue(item.call.input) : "",
    item.result ? formatMessageValue(item.result.result) : "",
    item.result?.error || item.call?.error || "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function activityItemError(item: ActivityItem): string {
  if (item.type !== "tool") {
    return "";
  }
  return item.result?.error || item.call?.error || "";
}

export function activityItemStatus(item: ActivityItem): string {
  if (item.type === "skill") {
    if (item.part.status === "invoked" || item.part.status === "started") return "running";
    return item.part.status || "complete";
  }
  if (item.type === "approval") {
    return item.part.status || "requires-action";
  }
  return item.result?.status || item.call?.status || "running";
}

export function activityItemKind(item: ActivityItem): string {
  if (item.type === "skill") return "skill";
  if (item.type === "approval") return "approval";
  const tool = item.call || item.result;
  const toolId = String(tool?.toolId || "").toLowerCase();
  if (toolId.includes("filechange") || toolId.includes("file_change") || toolId.includes("patch")) return "edit";
  if (toolId.includes("command") || toolId.includes("exec")) return commandActivityKind(tool) || "command";
  if (toolId.includes("search")) return "search";
  if (toolId.includes("read") || toolId.includes("file")) return "read";
  if (toolId.includes("browser") || toolId.includes("computer")) return "browser";
  if (toolId.includes("memory")) return "memory";
  if (toolId.includes("artifact")) return "artifact";
  return "tool";
}

function toolPreview(tool: ToolPart | undefined): string {
  if (!tool) return "工具";
  const input = recordValue(tool.input);
  const command = commandText(tool);
  const title = stringValue(input.title);
  return summarize(command || title || tool.title || tool.toolId || "工具", 72);
}

function activityTargetLabel(item: ActivityItem | undefined): string {
  if (!item) {
    return "";
  }
  if (item.type === "skill") {
    return item.part.skillName ? `/${item.part.skillName.replace(/^\//, "")}` : item.part.title || "";
  }
  if (item.type === "approval") {
    return item.part.title || item.part.toolId || "";
  }
  const kind = activityItemKind(item);
  if (kind === "edit") {
    return filePreview(item);
  }
  const tool = item.call || item.result;
  if (!tool) {
    return "";
  }
  if (kind === "search") {
    return searchTargetLabel(tool);
  }
  if (kind === "read") {
    return readTargetLabel(tool);
  }
  if (kind === "command") {
    return commandTargetLabel(tool);
  }
  if (kind === "browser") {
    return browserTargetLabel(tool);
  }
  return "";
}

function searchTargetLabel(tool: ToolPart): string {
  const command = commandText(tool);
  const tokens = shellWords(command);
  const executable = commandExecutable(tokens);
  if (!tokens.length || !["rg", "grep", "ag", "fd", "find"].includes(executable)) {
    return structuredTargetLabel(tool) || "";
  }
  const positional = commandPositionals(tokens.slice(1));
  if (executable === "find") {
    return summarizePathTargets(positional.length ? positional : ["."]);
  }
  if (tokens.includes("--files")) {
    return summarizePathTargets(positional) || "文件";
  }
  const pathTargets = positional.slice(1).filter(isPathLikeToken);
  if (pathTargets.length) {
    return summarizePathTargets(pathTargets);
  }
  const fallbackPaths = positional.filter(isPathLikeToken);
  if (fallbackPaths.length) {
    return summarizePathTargets(fallbackPaths);
  }
  return positional[0] ? `"${summarize(positional[0], 36)}"` : "文件";
}

function readTargetLabel(tool: ToolPart): string {
  const command = commandText(tool);
  const tokens = shellWords(command);
  const positional = commandPositionals(tokens.slice(1));
  const paths = positional.filter(isPathLikeToken);
  if (paths.length) {
    return summarizePathTargets(paths.slice(-2));
  }
  return structuredTargetLabel(tool) || pathBaseName(tool.title || "") || "";
}

function commandTargetLabel(tool: ToolPart): string {
  const command = commandText(tool);
  const tokens = shellWords(command);
  if (tokens[0] === "npm" && tokens[1] === "run" && tokens[2]) {
    return summarize(command, 44);
  }
  if (tokens[0] === "npm" && tokens[1]) {
    return summarize(command, 44);
  }
  return summarize(command || structuredTargetLabel(tool) || tool.title || "", 44);
}

function browserTargetLabel(tool: ToolPart): string {
  const input = recordValue(tool.input);
  const result = recordValue(tool.result);
  return (
    stringValue(input.url) ||
    stringValue(result.url) ||
    stringValue(input.title) ||
    stringValue(result.title) ||
    structuredTargetLabel(tool)
  );
}

function structuredTargetLabel(tool: ToolPart): string {
  const input = recordValue(tool.input);
  const result = recordValue(tool.result);
  return [
    stringValue(input.path),
    stringValue(input.file),
    stringValue(input.filePath),
    stringValue(input.target),
    stringValue(result.path),
    stringValue(result.file),
    stringValue(result.filePath),
    stringValue(result.target),
  ].find(Boolean) || "";
}

function commandText(tool: ToolPart | undefined): string {
  if (!tool) return "";
  const input = recordValue(tool.input);
  return cleanShellCommand(
    stringValue(input.cmd) ||
      stringValue(input.command) ||
      stringValue(input.shellCommand) ||
      stringValue(input.args) ||
      "",
  );
}

function cleanShellCommand(command: string): string {
  let value = command.trim();
  value = value.replace(/^\/bin\/(?:zsh|bash|sh)\s+-lc\s+/, "").trim();
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    value = value.slice(1, -1);
  }
  return value.replace(/\\"/g, '"').replace(/\\'/g, "'");
}

function shellWords(command: string): string[] {
  const words: string[] = [];
  const pattern = /"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|(\S+)/g;
  for (const match of command.matchAll(pattern)) {
    const value = match[1] ?? match[2] ?? match[3] ?? "";
    if (value) {
      words.push(value.replace(/\\(["'\\])/g, "$1"));
    }
  }
  return words;
}

function commandExecutable(tokens: string[]): string {
  const first = tokens[0] || "";
  return pathBaseName(first);
}

function commandPositionals(tokens: string[]): string[] {
  const positionals: string[] = [];
  const optionsWithValues = new Set([
    "-e",
    "-f",
    "-g",
    "--glob",
    "--type",
    "--type-add",
    "--context",
    "--after-context",
    "--before-context",
    "--max-depth",
    "--ignore-file",
  ]);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token || isShellOperator(token)) {
      continue;
    }
    if (token.startsWith("-")) {
      if (optionsWithValues.has(token) && index + 1 < tokens.length) {
        index += 1;
      }
      continue;
    }
    positionals.push(token);
  }
  return positionals;
}

function isShellOperator(token: string): boolean {
  return ["|", "||", "&&", ";", ">", ">>", "<", "2>", "2>>"].includes(token);
}

function isPathLikeToken(token: string): boolean {
  const value = token.trim();
  if (!value || value.startsWith("$")) {
    return false;
  }
  return (
    value === "." ||
    value === ".." ||
    value.startsWith("/") ||
    value.startsWith("~/") ||
    value.includes("/") ||
    /\.[A-Za-z0-9]{1,8}$/.test(value) ||
    ["src", "web", "extension", "scripts", "test", "tests", "docs"].includes(value)
  );
}

function summarizePathTargets(paths: string[]): string {
  const cleaned = uniqueStrings(paths.map(cleanPathToken).filter(Boolean));
  if (!cleaned.length) {
    return "";
  }
  if (cleaned.length === 1) {
    return displayPathTarget(cleaned[0]);
  }
  const first = displayPathTarget(cleaned[0]);
  return `${first} 等 ${cleaned.length} 个位置`;
}

function cleanPathToken(path: string): string {
  return path
    .replace(/^['"]|['"]$/g, "")
    .replace(/[,:;]+$/g, "")
    .trim();
}

function displayPathTarget(path: string): string {
  if (path === ".") {
    return "当前目录";
  }
  if (path === "..") {
    return "上级目录";
  }
  const normalized = path.replace(/\\/g, "/");
  const base = pathBaseName(normalized);
  if (/\.[A-Za-z0-9]{1,8}$/.test(base)) {
    return base;
  }
  if (normalized.startsWith("/") && base) {
    return base;
  }
  return normalized;
}

function compactActivityDetailPaths(detail: string): string {
  return detail
    .split(" · ")
    .map((segment) => {
      const cwdMatch = segment.match(/^cwd:\s*(.+)$/);
      if (cwdMatch?.[1]) {
        return `cwd: ${compactPathLabel(cwdMatch[1])}`;
      }
      return segment;
    })
    .join(" · ");
}

function compactPathLabel(path: string): string {
  const cleaned = cleanPathToken(path).replace(/[\\/]+$/g, "");
  if (!cleaned) {
    return path;
  }
  if (cleaned === ".") {
    return "当前目录";
  }
  if (cleaned === "..") {
    return "上级目录";
  }
  return pathBaseName(cleaned) || cleaned;
}

function commandActivityKind(tool: ToolPart | undefined): string {
  const command = commandText(tool);
  if (!command) return "command";
  const searchesFiles =
    /^(rg|grep|ag|fd|find)\b/.test(command) ||
    (/\b(rg|grep|ag|fd|find)\b/.test(command) && /\b(-n|--files|--glob|--hidden)\b/.test(command));
  if (searchesFiles) {
    return "search";
  }
  if (/^(sed|cat|nl|head|tail|wc|ls|tree)\b/.test(command)) {
    return "read";
  }
  if (/^(apply_patch|patch)\b/.test(command)) {
    return "edit";
  }
  return "command";
}

function readableResultText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (!value || typeof value !== "object") {
    return "";
  }
  if (Array.isArray(value)) {
    return value.map(readableResultText).filter(Boolean).join("\n");
  }
  const record = value as Record<string, unknown>;
  const preferredKeys = ["output", "stdout", "stderr", "text", "message", "summary", "observation", "title"];
  const lines = preferredKeys
    .map((key) => record[key])
    .filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
  if (lines.length) {
    return lines.join("\n");
  }
  return "";
}

function filePreview(item: ActivityItem): string {
  const files = activityItemFileHints(item);
  if (files.length === 1) return summarize(files[0], 54);
  if (files.length > 1) return `${files.length} 个文件`;
  return "文件变更";
}

export function editActivityInfo(item: ActivityItem): { label: string; fullPaths: string[]; added?: number; removed?: number } | null {
  const fullPaths = activityItemFileHints(item);
  const stats = editStatsFromItem(item);
  if (fullPaths.length > 1) {
    return {
      label: `${fullPaths.length} 个文件`,
      fullPaths,
      ...stats,
    };
  }
  const fullPath = fullPaths[0] || filePreview(item);
  return {
    label: pathBaseName(fullPath),
    fullPaths: fullPaths.length ? fullPaths : [fullPath],
    ...stats,
  };
}

function activityItemFileHints(item: ActivityItem): string[] {
  const values = activityItemStructuredValues(item);
  return uniqueStrings([
    ...values.flatMap(extractFileHintsFromValue),
    ...extractFileHints(activityItemRawText(item)),
  ]);
}

function activityItemStructuredValues(item: ActivityItem): unknown[] {
  if (item.type === "tool") {
    return [item.call?.input, item.result?.result].filter((value) => value !== undefined);
  }
  if (item.type === "approval") {
    return [item.part.input, item.part.approvalInput].filter((value) => value !== undefined);
  }
  return [];
}

function editStatsFromItem(item: ActivityItem): { added?: number; removed?: number } {
  const diffs = uniqueStrings(activityItemStructuredValues(item).flatMap(extractDiffTextsFromValue));
  if (diffs.length) {
    return editStatsFromText(diffs.join("\n"));
  }
  return editStatsFromText(activityItemRawText(item));
}

function editStatsFromText(text: string): { added?: number; removed?: number } {
  const explicitStats = [...text.matchAll(/(?:^|[^\S\r\n])\+(\d+)[^\S\r\n]+-?(\d+)(?=$|[^\S\r\n])/g)];
  if (explicitStats.length) {
    return explicitStats.reduce(
      (total, match) => ({
        added: (total.added || 0) + Number(match[1] || 0),
        removed: (total.removed || 0) + Number(match[2] || 0),
      }),
      { added: 0, removed: 0 },
    );
  }

  let added = 0;
  let removed = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++") && !line.startsWith("***")) {
      added += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      removed += 1;
    }
  }
  return added || removed ? { added, removed } : {};
}

function pathBaseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function extractFileHintsFromValue(value: unknown): string[] {
  if (typeof value === "string") {
    return extractFileHints(value);
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap(extractFileHintsFromValue);
  }
  const hints: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    const lowerKey = key.toLowerCase();
    if (typeof child === "string" && isPathHintKey(lowerKey)) {
      hints.push(child);
    }
    hints.push(...extractFileHintsFromValue(child));
  }
  return hints;
}

function extractDiffTextsFromValue(value: unknown): string[] {
  if (!value || typeof value !== "object") {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap(extractDiffTextsFromValue);
  }
  const diffs: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    const lowerKey = key.toLowerCase();
    if (typeof child === "string" && (lowerKey === "diff" || lowerKey === "patch")) {
      diffs.push(child);
      continue;
    }
    diffs.push(...extractDiffTextsFromValue(child));
  }
  return diffs;
}

function isPathHintKey(key: string): boolean {
  return ["file", "filepath", "file_path", "filename", "path", "target", "target_path"].includes(key);
}

function extractFileHints(text: string): string[] {
  const patterns = [
    /\*\*\* (?:Update|Add|Delete) File: ([^\n]+)/g,
    /(?:^|\n)\s*["']?(?:file|path|target|filename)["']?\s*[:=]\s*["']?([^"',\n}]+)/gi,
  ];
  return patterns.flatMap((pattern) =>
    [...String(text || "").matchAll(pattern)]
      .map((match) => match[1]?.trim())
      .filter((value): value is string => Boolean(value)),
  );
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function formatMessageValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  return formatJson(value);
}

export function isUserInputApproval(part: ToolPart): boolean {
  const toolId = stringValue(part?.toolId);
  const input = recordValue(part?.approvalInput);
  const method = stringValue(input.method);
  return (
    toolId === "user_input" ||
    method === "item/tool/requestUserInput" ||
    method === "mcpServer/elicitation/request"
  );
}

export function userInputPromptLabel(part: ToolPart): string {
  const input = recordValue(part?.approvalInput);
  const params = recordValue(input.params);
  return stringValue(params.title) || stringValue(params.prompt) || stringValue(params.message) || "回答";
}

export function buildUserInputApprovalResponse(part: ToolPart, text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const input = recordValue(part?.approvalInput);
  const params = recordValue(input.params);
  const firstQuestionId = firstUserInputQuestionId(params);
  if (stringValue(input.method) === "mcpServer/elicitation/request") {
    return {
      content: firstQuestionId ? { [firstQuestionId]: trimmed } : { answer: trimmed },
    };
  }
  return {
    answers: firstQuestionId
      ? { [firstQuestionId]: { answers: trimmed ? [trimmed] : [] } }
      : { answer: { answers: trimmed ? [trimmed] : [] } },
  };
}

function firstUserInputQuestionId(params: Record<string, unknown>): string {
  const questions = Array.isArray(params.questions)
    ? params.questions
    : Array.isArray(params.fields)
      ? params.fields
      : [];
  for (const question of questions) {
    const value = recordValue(question);
    const id = stringValue(value.id) || stringValue(value.name);
    if (id) return id;
  }
  return "";
}
