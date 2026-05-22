import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const releaseMode = process.argv.includes("--release");
const root = process.cwd();
const changelogPath = join(root, "CHANGELOG.md");
const packagePath = join(root, "package.json");

function fail(message) {
  console.error(`Release notes check failed: ${message}`);
  process.exit(1);
}

function git(args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) return undefined;
  return result.stdout.trim();
}

function meaningfulBullets(markdown) {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+\S/.test(line))
    .filter((line) => !/^[-*]\s+\.{3}\s*$/.test(line));
}

function section(markdown, title) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^##\\s+\\[?${title}\\]?\\s*$`, "i").test(line.trim()));
  if (start < 0) return undefined;
  const end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line.trim()));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim();
}

if (!existsSync(changelogPath)) {
  fail("CHANGELOG.md is missing. Add an Unreleased section before preparing a release.");
}
if (!existsSync(packagePath)) {
  fail("package.json is missing.");
}

const changelog = readFileSync(changelogPath, "utf8");
const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
const version = String(packageJson.version || "").trim();
if (!version) fail("package.json does not contain a version.");

const latestTag = git(["describe", "--tags", "--abbrev=0"]);
const currentTag = `v${version}`;
const commitRange = latestTag ? `${latestTag}..HEAD` : "HEAD";
const commits = git(["log", "--oneline", commitRange]);
const status = git(["status", "--short"]);
const unreleased = section(changelog, "Unreleased");
const unreleasedEntries = unreleased ? meaningfulBullets(unreleased) : [];

const releaseNotePath = join(root, "docs", "releases", `${currentTag}.md`);
const releaseNoteExists = existsSync(releaseNotePath);
const releaseNoteEntries = releaseNoteExists
  ? meaningfulBullets(readFileSync(releaseNotePath, "utf8"))
  : [];
const releaseNoteReady = latestTag !== currentTag && releaseNoteEntries.length > 0;

console.log("Release notes preflight");
console.log(`- package version: ${version}`);
console.log(`- latest tag: ${latestTag || "(none)"}`);
console.log(`- commits checked: ${commitRange}`);
console.log(`- working tree: ${status ? "has local changes" : "clean"}`);
if (commits) {
  console.log("");
  console.log(commits);
} else {
  console.log("- no commits found in range");
}
if (status) {
  console.log("");
  console.log(status);
}
console.log("");
console.log(`- CHANGELOG.md Unreleased entries: ${unreleasedEntries.length}`);
console.log(`- release note file: ${releaseNoteExists ? `docs/releases/${currentTag}.md` : "(missing)"}`);
console.log(`- release note entries: ${releaseNoteEntries.length}`);

if (releaseMode) {
  if (latestTag === currentTag) {
    fail(`package.json is still at the latest released version (${currentTag}). Run npm version X.Y.Z --no-git-tag-version first.`);
  }
  if (!releaseNoteReady) {
    fail(`create docs/releases/${currentTag}.md with at least one meaningful bullet before release.`);
  }
  console.log("Release note file is ready for the current package version.");
} else {
  if (unreleasedEntries.length === 0 && !releaseNoteReady) {
    fail("add at least one entry to CHANGELOG.md under ## Unreleased, or prepare the current version release note after bumping.");
  }
  console.log("Changelog buffer is ready. Compare the commit list above before drafting the release note.");
}
