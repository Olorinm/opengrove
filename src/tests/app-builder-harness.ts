import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appImportReport, inspectAppSource, mountAppInSettings, scaffoldApp, stageAppSource, validateAppRoot } from "../app-builder/cli.js";
import { importProjectAsApp } from "../app-builder/importer.js";
import { validateAppManifestText } from "../app-builder/manifest.js";

const tempRoot = mkdtempSync(join(tmpdir(), "opengrove-app-builder-"));

try {
  const appRoot = join(tempRoot, "demo-app");
  const scaffolded = scaffoldApp(appRoot, {
    id: "demo-app",
    title: "Demo App",
    description: "Harness app.",
  });
  assert.equal(scaffolded.ok, true);

  const valid = validateAppRoot(appRoot);
  assert.equal(valid.ok, true);
  assert.equal(valid.workspacePath, "workspace");

  const inspected = inspectAppSource(appRoot);
  assert.equal(inspected.sourceType, "opengrove-app");
  assert.equal(inspected.manifest, "valid");
  assert.equal(inspected.recommendedUiKind, "file-workbench");

  const stagedRoot = join(tempRoot, "staged-app");
  const staged = await stageAppSource(appRoot, {
    target: stagedRoot,
    copy: true,
  });
  assert.equal(staged.ok, true);
  assert.equal(existsSync(join(stagedRoot, "opengrove.app.json")), true);

  const report = appImportReport(stagedRoot);
  assert.equal(report.readyToMount, true);
  assert.deepEqual(report.mountCandidate, {
    id: "demo-app",
    title: "Demo App",
    path: stagedRoot,
    enabled: true,
  });

  const settingsPath = join(tempRoot, "bridge-settings.json");
  const mounted = mountAppInSettings(stagedRoot, { settingsPath });
  assert.equal(mounted.ok, true);
  const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as { mountedApps: Array<{ id: string; path: string; title: string; enabled: boolean }> };
  assert.deepEqual(settings.mountedApps, [{
    id: "demo-app",
    path: stagedRoot,
    title: "Demo App",
    enabled: true,
  }]);

  const webRoot = join(tempRoot, "web-project");
  scaffoldApp(webRoot, {
    id: "web-project",
    title: "Web Project",
    uiKind: "web-app",
  });
  writeFileSync(join(webRoot, "package.json"), JSON.stringify({ name: "web-project", scripts: { dev: "vite" } }), "utf8");
  const webInspected = inspectAppSource(webRoot);
  assert.equal(webInspected.uiStatus, "existing-ui");

  const workflowSource = join(tempRoot, "workflow-source");
  mkdirSync(join(workflowSource, "src"), { recursive: true });
  mkdirSync(join(workflowSource, "scripts"), { recursive: true });
  mkdirSync(join(workflowSource, "projects", "#1#", "tmp"), { recursive: true });
  mkdirSync(join(workflowSource, "projects", "#1#", "outputs", "final"), { recursive: true });
  mkdirSync(join(workflowSource, "clip_generator_tmp"), { recursive: true });
  writeFileSync(join(workflowSource, "requirements.txt"), "pydantic\n", "utf8");
  writeFileSync(join(workflowSource, "src", "project_compat.py"), "print('ok')\n", "utf8");
  writeFileSync(join(workflowSource, "scripts", "run.py"), "print('run')\n", "utf8");
  writeFileSync(join(workflowSource, "projects", "#1#", "outputs", "final", "clip_plan.json"), JSON.stringify({
    source_video: join(workflowSource, "projects", "#1#", "source", "videos", "EP1.mp4"),
  }), "utf8");
  writeFileSync(join(workflowSource, ".env"), "SECRET=1\n", "utf8");
  writeFileSync(join(workflowSource, "clip_generator_tmp", "cache.mp4"), "cache", "utf8");
  writeFileSync(join(workflowSource, "projects", "#1#", "tmp", "cache.mp4"), "cache", "utf8");
  const workflowInspected = inspectAppSource(workflowSource);
  assert.equal(workflowInspected.sourceType, "workflow-project");
  const importedWorkflowRoot = join(tempRoot, "imported-workflow");
  const importedWorkflow = importProjectAsApp(workflowSource, {
    id: "workflow-import",
    title: "Workflow Import",
    target: importedWorkflowRoot,
  });
  assert.equal(importedWorkflow.ok, true);
  assert.equal(validateAppRoot(importedWorkflowRoot).ok, true);
  assert.equal(existsSync(join(importedWorkflowRoot, "source-project", "src", "project_compat.py")), true);
  assert.equal(existsSync(join(importedWorkflowRoot, "source-project", ".env")), false);
  assert.equal(existsSync(join(importedWorkflowRoot, "source-project", "clip_generator_tmp")), false);
  assert.equal(existsSync(join(importedWorkflowRoot, "source-project", "projects", "#1#", "tmp")), false);
  const importedClipPlan = JSON.parse(readFileSync(join(importedWorkflowRoot, "source-project", "projects", "#1#", "outputs", "final", "clip_plan.json"), "utf8")) as { source_video: string };
  assert.equal(importedClipPlan.source_video.startsWith(realpathSync(join(importedWorkflowRoot, "source-project"))), true);

  const unsafeRoot = join(tempRoot, "unsafe-app");
  scaffoldApp(unsafeRoot, {
    id: "unsafe-app",
    title: "Unsafe App",
    force: true,
  });
  writeFileSync(join(unsafeRoot, "opengrove.app.json"), JSON.stringify({
    id: "unsafe-app",
    title: "Unsafe App",
    ui: { kind: "file-workbench", workspace: "../outside" },
  }), "utf8");
  const unsafe = validateAppRoot(unsafeRoot);
  assert.equal(unsafe.ok, false);
  assert.deepEqual(unsafe.issues, ["workspace escapes app root: ../outside"]);

  const jsoncWithGlob = validateAppManifestText(`{
    // comment
    "id": "glob-app",
    "title": "Glob App",
    "ui": { "kind": "file-workbench", "workspace": "workspace" },
    "capabilities": {
      "cli": [{
        "id": "glob-cli",
        "command": "./bin/glob",
        "artifacts": ["workspace/runs/**", "source-project/projects/**/outputs/**"]
      }]
    }
  }`);
  assert.equal(jsoncWithGlob.ok, true);
  const globManifest = jsoncWithGlob.manifest as { capabilities?: { cli?: Array<{ artifacts?: string[] }> } };
  assert.deepEqual(globManifest.capabilities?.cli?.[0]?.artifacts, ["workspace/runs/**", "source-project/projects/**/outputs/**"]);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
