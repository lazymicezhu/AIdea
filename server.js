const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 4173);
const ASSET_DIR = path.join(ROOT, "assets");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".pdf": "application/pdf"
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function cleanFilename(name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext)
    .trim()
    .replace(/[\\/:*?"<>|#%{}]+/g, "-")
    .replace(/\s+/g, "-") || "asset";
  return `${Date.now()}-${base}${ext}`;
}

function parseMultipart(buffer, contentType) {
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) return [];
  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  const files = [];
  let start = buffer.indexOf(boundary);

  while (start !== -1) {
    start += boundary.length;
    if (buffer[start] === 45 && buffer[start + 1] === 45) break;
    if (buffer[start] === 13 && buffer[start + 1] === 10) start += 2;

    const headerEnd = buffer.indexOf(Buffer.from("\r\n\r\n"), start);
    if (headerEnd === -1) break;

    const headerText = buffer.slice(start, headerEnd).toString("utf8");
    const filenameMatch = headerText.match(/filename="([^"]*)"/i);
    let next = buffer.indexOf(boundary, headerEnd + 4);
    if (next === -1) break;

    let bodyEnd = next - 2;
    if (bodyEnd < headerEnd + 4) bodyEnd = next;
    if (filenameMatch && filenameMatch[1]) {
      files.push({
        filename: filenameMatch[1],
        data: buffer.slice(headerEnd + 4, bodyEnd)
      });
    }
    start = next;
  }

  return files;
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function handleUpload(req, res) {
  const body = await readRequestBody(req);
  const files = parseMultipart(body, req.headers["content-type"] || "");
  if (!files.length) {
    send(res, 400, JSON.stringify({ error: "No file received" }), {
      "Content-Type": "application/json"
    });
    return;
  }

  await fs.mkdir(ASSET_DIR, { recursive: true });
  const saved = [];
  for (const file of files) {
    const filename = cleanFilename(file.filename);
    const assetPath = path.join(ASSET_DIR, filename);
    await fs.writeFile(assetPath, file.data);
    saved.push({ path: `assets/${filename}` });
  }

  send(res, 200, JSON.stringify(saved[0]), {
    "Content-Type": "application/json"
  });
}

async function handleStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.normalize(path.join(ROOT, pathname));

  if (!filePath.startsWith(ROOT)) {
    send(res, 403, "Forbidden");
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    const type = MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    send(res, 200, data, { "Content-Type": type });
  } catch {
    send(res, 404, "Not found");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/upload") {
      await handleUpload(req, res);
      return;
    }
    if (req.method === "GET" || req.method === "HEAD") {
      await handleStatic(req, res);
      return;
    }
    send(res, 405, "Method not allowed");
  } catch (error) {
    console.error(error);
    send(res, 500, "Server error");
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`MiniNote running at http://localhost:${PORT}/`);
});
