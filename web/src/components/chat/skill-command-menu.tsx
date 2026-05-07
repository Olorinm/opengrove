import { Command } from "cmdk";
import { Box } from "lucide-react";
import type { SkillRecord } from "../../bridge";
import { summarize } from "../../format";

export function SkillCommandMenu(props: {
  skills: SkillRecord[];
  activeIndex: number;
  onSelect(skill: SkillRecord): void;
}) {
  return (
    <div className="skill-menu">
      <div className="skill-menu-heading">技能</div>
      <Command shouldFilter={false}>
        <Command.List className="skill-menu-list">
          <Command.Group className="skill-menu-group">
            {props.skills.map((skill, index) => (
              <Command.Item
                key={skill.id || skill.name}
                value={skill.name || skill.id}
                className="skill-menu-item"
                data-selected={index === props.activeIndex ? "true" : "false"}
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
  if (normalized === "vfs-pm-guard") return "VFS PM Guard";
  return raw
    .split(/[-_:]+/)
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === "vfs" || lower === "pm" || lower === "api" || lower === "ui") {
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
