#!/usr/bin/env node
// Serves the static export in out/ at http://localhost:43128/single-site/, the same path
// layout as https://square.umin.ac.jp/single-site/, to check a build before uploading.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "out");
const BASE = process.env.BASE_PATH ?? "/single-site";
const PORT = Number(process.env.PORT ?? 43128);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".gz": "application/gzip",
};

if (!existsSync(OUT)) {
  console.error("out/ がありません。先に npm run build を実行してください");
  process.exit(1);
}

createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
  if (!url.startsWith(`${BASE}/`)) {
    res.writeHead(302, { Location: `${BASE}/` }).end();
    return;
  }
  let file = path.join(OUT, url.slice(BASE.length));
  if (!file.startsWith(OUT)) {
    res.writeHead(403).end();
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!existsSync(file)) {
    res.writeHead(404, { "Content-Type": TYPES[".html"] });
    createReadStream(path.join(OUT, "404.html")).pipe(res);
    return;
  }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}).listen(PORT, () => {
  console.log(`http://localhost:${PORT}${BASE}/`);
});
