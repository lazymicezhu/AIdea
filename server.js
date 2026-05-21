const http = require("node:http");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { execFile } = require("node:child_process");
const crypto = require("node:crypto");
const https = require("node:https");

const ROOT = __dirname;

function loadEnvFile() {
  try {
    const envPath = path.join(ROOT, ".env");
    const content = require("node:fs").readFileSync(envPath, "utf8");
    content.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const separator = trimmed.indexOf("=");
      if (separator === -1) return;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    });
  } catch {
    // Environment variables can still be provided by the shell.
  }
}

loadEnvFile();

const PORT = Number(process.env.PORT || 4173);
const BUNDLED_ASSET_DIR = path.join(ROOT, "assets");
const ASSET_DIR = process.env.AIDEA_DATA_DIR
  ? path.join(process.env.AIDEA_DATA_DIR, "assets")
  : BUNDLED_ASSET_DIR;
const PDF_EXPORTER = path.join(ROOT, "pdf-export.swift");
const DEFAULT_OSS_BUCKET = process.env.ALI_OSS_BUCKET || "";
const DEFAULT_OSS_REGION = process.env.ALI_OSS_REGION || "";
const DEFAULT_OSS_ENDPOINT = process.env.ALI_OSS_ENDPOINT || (DEFAULT_OSS_REGION ? `oss-${DEFAULT_OSS_REGION}.aliyuncs.com` : "");
const DEFAULT_OSS_ACCESS_KEY_ID = process.env.ALI_OSS_ACCESS_KEY_ID || "";
const DEFAULT_OSS_ACCESS_KEY_SECRET = process.env.ALI_OSS_ACCESS_KEY_SECRET || "";

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

function sendJson(res, status, payload) {
  send(res, status, JSON.stringify(payload), {
    "Content-Type": "application/json; charset=utf-8"
  });
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

function safeExportName(name, fallback = "mininote") {
  return (name || fallback)
    .trim()
    .replace(/[\\:*?"<>|#%{}]+/g, "-")
    .replace(/\s+/g, "-") || fallback;
}

function safeCloudAccount(name) {
  return safeExportName(name, "default").replace(/^-+|-+$/g, "") || "default";
}

function validateCloudInput(payload) {
  const account = safeCloudAccount(String(payload.account || ""));
  const pin = String(payload.pin || "");
  if (!/^\d{4}$/.test(pin)) {
    throw new Error("传输密钥必须是 4 位数字");
  }
  return { account, pin };
}

function pinHash(account, pin) {
  return crypto.createHash("sha256").update(`${account}:${pin}`).digest("hex");
}

function cloudPrefix(account) {
  return `mininote/${account}`;
}

function ossConfigFromPayload(payload = {}) {
  return {
    bucket: DEFAULT_OSS_BUCKET,
    endpoint: DEFAULT_OSS_ENDPOINT,
    accessKeyId: DEFAULT_OSS_ACCESS_KEY_ID,
    accessKeySecret: String(payload.ossSecret || "").trim() || DEFAULT_OSS_ACCESS_KEY_SECRET
  };
}

function ossConfigured(config) {
  return Boolean(config.bucket && config.endpoint && config.accessKeyId && config.accessKeySecret);
}

function encodeOssKey(key) {
  return key.split("/").map(encodeURIComponent).join("/");
}

function publicOssUrl(config, key) {
  return `https://${config.bucket}.${config.endpoint}/${encodeOssKey(key)}`;
}

function replaceLocalAssetsWithPublicUrls(markdown, config, prefix, assetNames) {
  const assetSet = new Set(assetNames);
  return String(markdown || "").replace(/(!?\[[^\]]*\]\()([^)]+)(\))/g, (match, opener, src, closer) => {
    const cleanSrc = decodeURIComponent(src.trim());
    if (!cleanSrc.startsWith("assets/") || !assetSet.has(cleanSrc)) return match;
    return `${opener}${publicOssUrl(config, `${prefix}/${cleanSrc}`)}${closer}`;
  });
}

function ossRequest(config, method, key, body = Buffer.alloc(0), contentType = "") {
  if (!ossConfigured(config)) {
    return Promise.reject(new Error("OSS is not configured"));
  }

  const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  const date = new Date().toUTCString();
  const resource = `/${config.bucket}/${key}`;
  const stringToSign = `${method}\n\n${contentType}\n${date}\n${resource}`;
  const signature = crypto
    .createHmac("sha1", config.accessKeySecret)
    .update(stringToSign)
    .digest("base64");

  const headers = {
    Date: date,
    Authorization: `OSS ${config.accessKeyId}:${signature}`
  };
  if (contentType) headers["Content-Type"] = contentType;
  if (method !== "GET" && method !== "DELETE") headers["Content-Length"] = payload.length;

  const options = {
    method,
    hostname: `${config.bucket}.${config.endpoint}`,
    path: `/${encodeOssKey(key)}`,
    headers
  };

  return new Promise((resolve, reject) => {
    const request = https.request(options, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const data = Buffer.concat(chunks);
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(data);
          return;
        }
        const error = new Error(`OSS ${method} ${key} failed: ${response.statusCode} ${data.toString("utf8")}`);
        error.statusCode = response.statusCode;
        reject(error);
      });
    });
    request.on("error", reject);
    if (method !== "GET" && method !== "DELETE") request.write(payload);
    request.end();
  });
}

async function readCloudManifest(config, prefix) {
  try {
    const manifestBuffer = await ossRequest(config, "GET", `${prefix}/manifest.json`);
    return JSON.parse(manifestBuffer.toString("utf8"));
  } catch (error) {
    if (error.statusCode === 404) return null;
    throw error;
  }
}

async function deleteUnusedCloudAssets(config, prefix, oldManifest, nextAssetNames) {
  if (!oldManifest || !Array.isArray(oldManifest.assets)) return 0;
  const nextAssets = new Set(nextAssetNames);
  const staleAssets = oldManifest.assets.filter((assetName) => !nextAssets.has(assetName));
  let deleted = 0;

  for (const assetName of staleAssets) {
    const safePath = safeAssetPath(assetName);
    if (!safePath) continue;
    try {
      await ossRequest(config, "DELETE", `${prefix}/${safePath.replaceAll(path.sep, "/")}`);
      deleted += 1;
    } catch (error) {
      if (error.statusCode !== 404) throw error;
    }
  }

  return deleted;
}

function safeAssetPath(assetPath) {
  const normalized = path.normalize(assetPath).replace(/^(\.\.[/\\])+/, "");
  if (!normalized.startsWith(`assets${path.sep}`) && !normalized.startsWith("assets/")) return null;
  return normalized;
}

async function readAssetFiles(assetPaths) {
  const files = [];
  for (const assetPath of assetPaths) {
    const safePath = safeAssetPath(assetPath);
    if (!safePath) continue;
    const source = path.join(ROOT, safePath);
    if (!source.startsWith(ASSET_DIR)) continue;
    try {
      const data = await fs.readFile(source);
      files.push({ name: safePath.replaceAll(path.sep, "/"), data });
    } catch {
      // Missing assets are skipped so one broken reference does not block export.
    }
  }
  return files;
}

async function writeAssetFiles(assetFiles) {
  for (const asset of assetFiles) {
    const safePath = safeAssetPath(asset.name);
    if (!safePath) continue;
    const target = path.join(ROOT, safePath);
    if (!target.startsWith(ASSET_DIR)) continue;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, asset.data);
  }
}

function execFilePromise(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

function htmlWithLocalAssetUrls(html) {
  const assetUrl = `${pathToFileURL(ASSET_DIR).href}/`;
  return html.replace(/(src|href)=["']assets\//g, `$1="${assetUrl}`);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: dosDate };
}

function createZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { time, date } = dosDateTime();

  for (const file of files) {
    const name = Buffer.from(file.name.replace(/\\/g, "/"), "utf8");
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(String(file.content || ""), "utf8");
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, end]);
}

async function handleExport(req, res) {
  const body = await readRequestBody(req);
  const payload = JSON.parse(body.toString("utf8") || "{}");
  const format = payload.format === "zip" ? "zip" : payload.format === "pdf" ? "pdf" : "md";
  const title = safeExportName(payload.title, "mininote");
  const content = String(payload.content || "");
  const html = String(payload.html || "");
  const assetFiles = await readAssetFiles(Array.isArray(payload.assets) ? payload.assets : []);
  const desktop = path.join(os.homedir(), "Desktop");
  await fs.mkdir(desktop, { recursive: true });
  const outputPath = format === "md"
    ? path.join(desktop, title)
    : path.join(desktop, `${title}.${format}`);

  if (format === "md") {
    await fs.mkdir(outputPath, { recursive: true });
    await fs.writeFile(path.join(outputPath, `${title}.md`), content, "utf8");
    for (const asset of assetFiles) {
      const target = path.join(outputPath, asset.name);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, asset.data);
    }
  } else if (format === "zip") {
    const files = Array.isArray(payload.files) ? payload.files : [];
    await fs.writeFile(outputPath, createZip([...files, ...assetFiles]));
  } else {
    const tempInput = path.join(os.tmpdir(), `mininote-${Date.now()}.html`);
    await fs.writeFile(tempInput, htmlWithLocalAssetUrls(html || `<pre>${content}</pre>`), "utf8");
    try {
      await execFilePromise("/usr/bin/swift", [PDF_EXPORTER, tempInput, outputPath]);
    } finally {
      await fs.rm(tempInput, { force: true });
    }
  }

  send(res, 200, JSON.stringify({ path: outputPath }), {
    "Content-Type": "application/json"
  });
}

async function handleCloudUpload(req, res) {
  const body = await readRequestBody(req);
  const payload = JSON.parse(body.toString("utf8") || "{}");
  const ossConfig = ossConfigFromPayload(payload);
  if (!ossConfigured(ossConfig)) {
    sendJson(res, 500, { error: "OSS 未配置，请设置服务端 Bucket / Region / AccessKey ID，并在高级设置填写 OSS Secret。" });
    return;
  }
  const { account, pin } = validateCloudInput(payload);
  const notes = Array.isArray(payload.notes) ? payload.notes : [];
  const activeId = String(payload.activeId || "");
  const assets = Array.isArray(payload.assets) ? payload.assets : [];
  const assetFiles = await readAssetFiles(assets);
  const prefix = cloudPrefix(account);
  const oldManifest = await readCloudManifest(ossConfig, prefix);
  if (oldManifest && oldManifest.keyHash !== pinHash(account, pin)) {
    sendJson(res, 403, { error: "账户名或传输密钥不匹配" });
    return;
  }
  const requestedAssets = assets
    .map((assetName) => safeAssetPath(String(assetName || "")))
    .filter(Boolean)
    .map((assetName) => assetName.replaceAll(path.sep, "/"));
  const nextAssetNames = [...new Set([...requestedAssets, ...assetFiles.map((asset) => asset.name)])];
  const deletedAssets = await deleteUnusedCloudAssets(ossConfig, prefix, oldManifest, nextAssetNames);
  const publicNotes = notes.map((note) => ({
    ...note,
    body: replaceLocalAssetsWithPublicUrls(note.body, ossConfig, prefix, nextAssetNames)
  }));
  const manifest = {
    version: 1,
    account,
    keyHash: pinHash(account, pin),
    uploadedAt: Date.now(),
    activeId,
    notes: publicNotes,
    assets: nextAssetNames
  };

  await ossRequest(ossConfig, "PUT", `${prefix}/manifest.json`, JSON.stringify(manifest, null, 2), "application/json; charset=utf-8");
  for (const asset of assetFiles) {
    await ossRequest(ossConfig, "PUT", `${prefix}/${asset.name}`, asset.data, MIME_TYPES[path.extname(asset.name).toLowerCase()] || "application/octet-stream");
  }

  sendJson(res, 200, { ok: true, uploadedNotes: notes.length, uploadedAssets: assetFiles.length, deletedAssets, updatedNotes: publicNotes });
}

async function handleCloudSync(req, res) {
  const body = await readRequestBody(req);
  const payload = JSON.parse(body.toString("utf8") || "{}");
  const ossConfig = ossConfigFromPayload(payload);
  if (!ossConfigured(ossConfig)) {
    sendJson(res, 500, { error: "OSS 未配置，请设置服务端 Bucket / Region / AccessKey ID，并在高级设置填写 OSS Secret。" });
    return;
  }
  const { account, pin } = validateCloudInput(payload);
  const prefix = cloudPrefix(account);
  const manifest = await readCloudManifest(ossConfig, prefix);
  if (!manifest) {
    sendJson(res, 404, { error: "云端还没有可同步的数据，请先上传。" });
    return;
  }
  if (manifest.keyHash !== pinHash(account, pin)) {
    sendJson(res, 403, { error: "账户名或传输密钥不匹配" });
    return;
  }

  const assetFiles = [];
  for (const assetName of Array.isArray(manifest.assets) ? manifest.assets : []) {
    const safePath = safeAssetPath(assetName);
    if (!safePath) continue;
    try {
      const data = await ossRequest(ossConfig, "GET", `${prefix}/${safePath.replaceAll(path.sep, "/")}`);
      assetFiles.push({ name: safePath, data });
    } catch {
      // Missing cloud assets are skipped; the note body is still synced.
    }
  }
  await writeAssetFiles(assetFiles);

  sendJson(res, 200, {
    ok: true,
    activeId: manifest.activeId || "",
    notes: Array.isArray(manifest.notes) ? manifest.notes : [],
    assets: assetFiles.map((asset) => asset.name)
  });
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
  if (pathname === "/assets" || pathname.startsWith("/assets/")) {
    const assetPath = path.normalize(path.join(ASSET_DIR, pathname.replace(/^\/assets\/?/, "")));
    const bundledAssetPath = path.normalize(path.join(BUNDLED_ASSET_DIR, pathname.replace(/^\/assets\/?/, "")));
    const candidates = [assetPath, bundledAssetPath];

    for (const candidate of candidates) {
      const base = candidate.startsWith(ASSET_DIR) ? ASSET_DIR : BUNDLED_ASSET_DIR;
      if (!candidate.startsWith(base)) continue;
      try {
        const data = await fs.readFile(candidate);
        const type = MIME_TYPES[path.extname(candidate).toLowerCase()] || "application/octet-stream";
        send(res, 200, data, { "Content-Type": type });
        return;
      } catch {
        // Try the next asset location.
      }
    }

    send(res, 404, "Not found");
    return;
  }
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
    if (req.method === "POST" && req.url === "/export") {
      await handleExport(req, res);
      return;
    }
    if (req.method === "POST" && req.url === "/cloud/upload") {
      await handleCloudUpload(req, res);
      return;
    }
    if (req.method === "POST" && req.url === "/cloud/sync") {
      await handleCloudSync(req, res);
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
  console.log(`AIdea running at http://localhost:${PORT}/`);
});
