import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const outDir = join(projectRoot, "web-dist");
const assetsDir = join(outDir, "assets");
const sourcemap = process.env.OPENGROVE_WEB_SOURCEMAP === "1";
const apiBase = process.env.OPENGROVE_WEB_API_BASE ?? "";

await rm(outDir, { recursive: true, force: true });
await mkdir(assetsDir, { recursive: true });

await build({
  entryPoints: [join(projectRoot, "web", "src", "main.tsx")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: join(outDir, "assets", "app.js"),
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  minify: true,
  sourcemap,
});

const indexTemplate = (await readFile(join(projectRoot, "web", "index.html"), "utf8"))
  .replace(
    /<meta name="opengrove-api-base" content="[^"]*" \/>/,
    `<meta name="opengrove-api-base" content="${escapeHtmlAttribute(apiBase)}" />`,
  );
await writeFile(join(outDir, "index.html"), indexTemplate, "utf8");

function escapeHtmlAttribute(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
