#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const localUserNames = [["peng", "bo"].join(""), ["yo", "yo"].join("")].join("|");
const localWorkspaceName = "\u4ee3\u7801\u9879\u76ee\u6c47\u603b";
const legacyWorkspaceName = ["project", "shire"].join("-");
const localPathRegex = new RegExp(
  `${"/Users"}/(?:${localUserNames})\\b|${"/Volumes"}/External APFS|${localWorkspaceName}|${legacyWorkspaceName}`,
);

const patterns = [
  {
    name: "private key block",
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  },
  {
    name: "AWS access key",
    regex: /AKIA[0-9A-Z]{16}/,
  },
  {
    name: "GitHub token",
    regex: /(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}/,
  },
  {
    name: "Slack token",
    regex: /xox[baprs]-[A-Za-z0-9-]{10,}/,
  },
  {
    name: "OpenAI-style secret key",
    regex: /sk-[A-Za-z0-9_-]{32,}/,
  },
  {
    name: "local absolute path",
    regex: localPathRegex,
  },
];

const ignoredPathParts = [
  "/node_modules/",
  "/dist/",
  "/web-dist/",
  "/data/",
  "/.git/",
];

function trackedAndUntrackedFiles() {
  const output = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"]);
  return output
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter((file) => file !== "scripts/check-secrets.mjs")
    .filter((file) => !ignoredPathParts.some((part) => `/${file}`.includes(part)));
}

const findings = [];
for (const file of trackedAndUntrackedFiles()) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const pattern of patterns) {
      if (pattern.regex.test(line)) {
        findings.push(`${file}:${index + 1}: ${pattern.name}`);
      }
    }
  }
}

if (findings.length > 0) {
  console.error("Potential sensitive content found:");
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log("No high-confidence secrets or local absolute paths found.");
