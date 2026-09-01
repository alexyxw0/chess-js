#!/usr/bin/env node
// A static file server for local play.
//
// Two reasons this exists rather than `python3 -m http.server`: the project
// already requires Node and nothing else, and a hardcoded port fails with
// EADDRINUSE the moment you forget you left one running. This walks up from
// the preferred port until it finds a free one and tells you which it took.
//
// Run: node scripts/serve.js [port]

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const FIRST_PORT = Number(process.argv[2]) || 8000;
const LAST_PORT = FIRST_PORT + 20;

// ES modules only load when served as JavaScript, so this table is not
// cosmetic — get .js wrong and the page fails with a bare MIME type error.
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".mp3": "audio/mpeg",
  ".ico": "image/x-icon",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  let path = decodeURIComponent(url.pathname);
  if (path.endsWith("/")) path += "index.html";

  // normalize() collapses any ../ before it can escape the project directory.
  const target = join(ROOT, normalize(path));
  if (!target.startsWith(ROOT)) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  try {
    const info = await stat(target);
    if (info.isDirectory()) throw new Error("directory");
    res.writeHead(200, {
      "Content-Type": TYPES[extname(target)] ?? "application/octet-stream",
      "Content-Length": info.size,
      "Cache-Control": "no-cache",
    });
    createReadStream(target).pipe(res);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }).end(`404 ${path}`);
  }
});

// Announce once, from the address the server actually bound to. Passing a
// callback to listen() would register a 'listening' handler per attempt, and
// the ones left over from failed attempts all fire on the eventual success.
server.on("listening", () => {
  const { port } = server.address();
  console.log(`\n  chess-js  ->  http://localhost:${port}\n`);
  console.log("  Ctrl-C to stop. This terminal stays busy while it serves.\n");
});

server.on("error", (err) => {
  if (err.code !== "EADDRINUSE") throw err;
  const port = server.__port;
  if (port >= LAST_PORT) {
    console.error(`no free port between ${FIRST_PORT} and ${LAST_PORT}`);
    process.exit(1);
  }
  console.log(`  port ${port} is busy, trying ${port + 1}`);
  listen(port + 1);
});

function listen(port) {
  server.__port = port;
  server.listen(port);
}

listen(FIRST_PORT);
