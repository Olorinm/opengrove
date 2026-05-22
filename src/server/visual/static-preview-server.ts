import { createReadStream, stat } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const root = resolve(process.cwd());
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 5173);

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

const server = createServer((request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { allow: "GET, HEAD" });
    response.end("Method not allowed");
    return;
  }

  const requestedPath = resolveRequestPath(request.url);
  if (!requestedPath) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  serveFile(requestedPath, shouldFallbackToIndex(request.url, request.headers.accept), request.method === "HEAD", response);
});

server.listen(port, host);

function resolveRequestPath(rawUrl: string | undefined): string | undefined {
  const pathname = safeDecode(new URL(rawUrl || "/", "http://opengrove.local").pathname);
  let relativePath = normalize(pathname);
  if (relativePath === "." || relativePath === sep) relativePath = "";
  while (relativePath.startsWith(sep)) relativePath = relativePath.slice(1);
  const resolvedPath = resolve(root, relativePath || "index.html");
  if (resolvedPath !== root && !resolvedPath.startsWith(`${root}${sep}`)) return undefined;
  return resolvedPath;
}

function serveFile(
  path: string,
  fallbackToIndex: boolean,
  headOnly: boolean,
  response: ServerResponse,
) {
  stat(path, (error, stats) => {
    if (!error && stats.isDirectory()) {
      serveFile(join(path, "index.html"), fallbackToIndex, headOnly, response);
      return;
    }
    if (error || !stats.isFile()) {
      if (fallbackToIndex && path !== join(root, "index.html")) {
        serveFile(join(root, "index.html"), false, headOnly, response);
        return;
      }
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "content-length": stats.size,
      "content-type": MIME_TYPES[extname(path).toLowerCase()] || "application/octet-stream",
    });
    if (headOnly) {
      response.end();
      return;
    }
    createReadStream(path)
      .on("error", () => {
        if (!response.headersSent) response.writeHead(500);
        response.end("Internal server error");
      })
      .pipe(response);
  });
}

function shouldFallbackToIndex(rawUrl: string | undefined, acceptHeader: string | string[] | undefined): boolean {
  const pathname = new URL(rawUrl || "/", "http://opengrove.local").pathname;
  const accept = Array.isArray(acceptHeader) ? acceptHeader.join(",") : acceptHeader || "";
  return !extname(pathname) && accept.includes("text/html");
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "/";
  }
}
