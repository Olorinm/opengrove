import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const outDir = join(projectRoot, "web-dist");
const assetsDir = join(outDir, "assets");
const esbuildBin = join(projectRoot, "node_modules", "esbuild", "bin", "esbuild");

await rm(outDir, { recursive: true, force: true });
await mkdir(assetsDir, { recursive: true });

await execFileAsync(esbuildBin, [
  join(projectRoot, "web", "src", "main.tsx"),
  "--bundle",
  "--format=esm",
  "--platform=browser",
  "--target=es2022",
  "--outfile=web-dist/assets/app.js",
  "--sourcemap",
]);

const indexTemplate = await readFile(join(projectRoot, "web", "index.html"), "utf8");
await writeFile(join(outDir, "index.html"), indexTemplate, "utf8");
