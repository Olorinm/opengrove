import { Command } from "cmdk";
import { Box } from "lucide-react";
import type { SkillRecord } from "../../bridge";
import { summarize } from "../../format";
import type { KernelSlashCommand } from "../../runtime/ui-model";

export function SlashCommandMenu(props: {
  commands: KernelSlashCommand[];
  skills: SkillRecord[];
  activeIndex: number;
  onSelectCommand(command: KernelSlashCommand): void;
  onSelect(skill: SkillRecord): void;
}) {
  const commandCount = props.commands.length;
  return (
    <div className="skill-menu">
      <Command shouldFilter={false}>
        <Command.List className="skill-menu-list">
          {props.commands.length ? (
            <Command.Group className="skill-menu-group" heading={<div className="skill-menu-heading">斜杠命令</div>}>
              {props.commands.map((command, index) => (
                <Command.Item
                  key={command.id}
                  value={command.name}
                  className="skill-menu-item"
                  data-kind="command"
                  data-selected={index === props.activeIndex ? "true" : "false"}
                  onSelect={() => props.onSelectCommand(command)}
                >
                  <div className="skill-menu-item-main">
                    <span className="skill-menu-item-title">
                      <span className="skill-menu-slash">/</span>
                      {command.name}
                    </span>
                    <span className="skill-menu-item-description">
                      {command.title} · {summarize(command.description, 118)}
                    </span>
                  </div>
                  <span className="skill-menu-item-source">内核</span>
                </Command.Item>
              ))}
            </Command.Group>
          ) : null}
          {props.skills.length ? (
            <Command.Group className="skill-menu-group" heading={<div className="skill-menu-heading">技能</div>}>
            {props.skills.map((skill, index) => (
              <Command.Item
                key={skill.id || skill.name}
                value={skill.name || skill.id}
                className="skill-menu-item"
                data-kind="skill"
                data-selected={commandCount + index === props.activeIndex ? "true" : "false"}
                onSelect={() => props.onSelect(skill)}
              >
                <div className="skill-menu-item-icon" aria-hidden="true">
                  <Box size={14} />
                </div>
                <div className="skill-menu-item-main">
                  <span className="skill-menu-item-title">{formatSkillTitle(skill)}</span>
                  <span className="skill-menu-item-description">
                    {summarize(skill.description || skill.whenToUse || "按需加载这一组方法和工作流。", 132)}
                  </span>
                </div>
                <span className="skill-menu-item-source">{formatSkillSourceLabel(skill)}</span>
              </Command.Item>
            ))}
          </Command.Group>
          ) : null}
        </Command.List>
      </Command>
    </div>
  );
}

function formatSkillTitle(skill: SkillRecord): string {
  const raw = String(skill.title || skill.displayName || skill.name || skill.id || "Skill").trim();
  const packId = String(skill.packId || "").toLowerCase();
  const normalized = raw.toLowerCase();
  if (normalized === "browser" && packId.includes("browser-use")) return "Browser Use";
  if (normalized === "imagegen") return "Image Gen";
  if (normalized === "openai-docs") return "OpenAI Docs";
  return raw
    .split(/[-_:]+/)
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === "pm" || lower === "api" || lower === "ui") {
        return lower.toUpperCase();
      }
      return part.toUpperCase() === part ? part : part.slice(0, 1).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function formatSkillSourceLabel(skill: SkillRecord): string {
  const source = String(skill.source || "").toLowerCase();
  if (source === "user") return "个人";
  if (source === "project") return "项目";
  if (source === "pack") return "个人";
  if (source === "bundled" || source === "system") return "系统";
  return skill.packId ? "个人" : "系统";
}
