const CDP_VERSION = "1.3";
const ROOT_FOLDER = "PageVault";
const EXTENSION_VERSION = "1.2.0";

const DEFAULT_FILTERS = {
  documents: true,
  styles: true,
  scripts: true,
  images: true,
  fonts: true,
  data: true,
  media: false,
  maps: true,
  other: false
};

const DEFAULT_OPTIONS = {
  filters: DEFAULT_FILTERS,
  includeClone: true,
  includeIndex: true,
  includeManifest: true
};

let activeJob = null;

function attach(tabId) {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, CDP_VERSION, () => {
      const error = chrome.runtime.lastError;
      error ? reject(new Error(error.message)) : resolve();
    });
  });
}

function detach(tabId) {
  return new Promise((resolve) => {
    chrome.debugger.detach({ tabId }, () => resolve());
  });
}

function send(tabId, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      const error = chrome.runtime.lastError;
      error ? reject(new Error(error.message)) : resolve(result);
    });
  });
}

function download(filename, url) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      { url, filename, conflictAction: "overwrite", saveAs: false },
      (id) => {
        const error = chrome.runtime.lastError;
        error ? reject(new Error(error.message)) : resolve(id);
      }
    );
  });
}

function notify(job, type, patch = {}) {
  const payload = {
    type,
    jobId: job.id,
    folder: job.folder,
    pageUrl: job.pageUrl,
    ...job.state,
    ...patch
  };

  chrome.runtime.sendMessage(payload, () => {
    void chrome.runtime.lastError;
  });
}

function setJobState(job, patch) {
  job.state = { ...job.state, ...patch };
}

function snapshot(job) {
  return {
    active: true,
    jobId: job.id,
    folder: job.folder,
    pageUrl: job.pageUrl,
    ...job.state
  };
}

function normalizeOptions(options = {}) {
  const filters = { ...DEFAULT_FILTERS, ...(options.filters || {}) };

  return {
    filters,
    includeClone: options.includeClone !== false,
    includeIndex: options.includeIndex !== false,
    includeManifest: options.includeManifest !== false
  };
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function timestamp() {
  const d = new Date();
  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate())
  ].join("-") + "_" + [pad(d.getHours()), pad(d.getMinutes()), pad(d.getSeconds())].join("-");
}

function defaultFolderFromUrl(rawUrl) {
  try {
    const host = new URL(rawUrl).hostname || "page";
    return sanitizeFolder(`${host}_${timestamp()}`);
  } catch {
    return `page_${timestamp()}`;
  }
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function sanitizeSegment(segment) {
  const cleaned = safeDecode(String(segment))
    .replace(/[<>:"\\|?*\x00-\x1f]/g, "_")
    .replace(/\//g, "_")
    .trim();

  return (cleaned || "_").slice(0, 120);
}

function sanitizeFolder(name) {
  return sanitizeSegment(name)
    .replace(/[. ]+$/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 80) || `page_${timestamp()}`;
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function hasExtension(filename) {
  return /\.[a-z0-9]{1,12}$/i.test(filename);
}

function appendBeforeExtension(filename, suffix) {
  const dot = filename.lastIndexOf(".");
  if (dot > 0 && dot < filename.length - 1) {
    return `${filename.slice(0, dot)}${suffix}${filename.slice(dot)}`;
  }
  return `${filename}${suffix}`;
}

function extensionForMime(mimeType, type) {
  const mime = String(mimeType || "").split(";")[0].trim().toLowerCase();
  const byMime = {
    "application/javascript": "js",
    "application/json": "json",
    "application/manifest+json": "json",
    "application/pdf": "pdf",
    "application/wasm": "wasm",
    "application/xml": "xml",
    "font/otf": "otf",
    "font/ttf": "ttf",
    "font/woff": "woff",
    "font/woff2": "woff2",
    "image/avif": "avif",
    "image/gif": "gif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/svg+xml": "svg",
    "image/webp": "webp",
    "text/css": "css",
    "text/html": "html",
    "text/javascript": "js",
    "text/plain": "txt",
    "text/xml": "xml",
    "video/mp4": "mp4",
    "video/webm": "webm"
  };

  if (byMime[mime]) return byMime[mime];
  if (type === "Document") return "html";
  if (type === "Stylesheet") return "css";
  if (type === "Script") return "js";
  if (type === "Image") return "img";
  if (type === "Font") return "font";
  if (type === "Media") return "media";
  return "bin";
}

function guessMime(path) {
  const ext = path.split(".").pop().toLowerCase();
  const map = {
    avif: "image/avif",
    bin: "application/octet-stream",
    css: "text/css",
    gif: "image/gif",
    html: "text/html",
    htm: "text/html",
    ico: "image/x-icon",
    img: "application/octet-stream",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    js: "application/javascript",
    json: "application/json",
    map: "application/json",
    mjs: "application/javascript",
    mp4: "video/mp4",
    otf: "font/otf",
    pdf: "application/pdf",
    png: "image/png",
    svg: "image/svg+xml",
    ttf: "font/ttf",
    txt: "text/plain",
    wasm: "application/wasm",
    webm: "video/webm",
    webp: "image/webp",
    woff: "font/woff",
    woff2: "font/woff2",
    xml: "application/xml"
  };
  return map[ext] || "application/octet-stream";
}

function isHtmlLike(resource) {
  return resource.type === "Document" || String(resource.mimeType || "").toLowerCase().includes("text/html");
}

function urlToPath(rawUrl, resource) {
  const url = new URL(rawUrl);
  const host = sanitizeSegment(url.hostname);
  const pathname = safeDecode(url.pathname || "/");
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length === 0 || pathname.endsWith("/")) {
    segments.push("index.html");
  } else if (!hasExtension(segments[segments.length - 1])) {
    if (isHtmlLike(resource)) {
      segments.push("index.html");
    } else {
      segments[segments.length - 1] += `.${extensionForMime(resource.mimeType, resource.type)}`;
    }
  }

  if (url.search) {
    const last = segments.pop() || "resource";
    segments.push(appendBeforeExtension(last, `__q_${hashString(url.search)}`));
  }

  return [host, ...segments.map(sanitizeSegment)].join("/");
}

function normalizeUrlForLookup(rawUrl) {
  try {
    return new URL(rawUrl).href;
  } catch {
    return "";
  }
}

function addResourceLookup(lookup, rawUrl, path) {
  const href = normalizeUrlForLookup(rawUrl);
  if (!href || !path) return;

  lookup[href] = path;
  lookup[href.split("#")[0]] = path;
}

function buildResourceLookup(items) {
  const lookup = {};
  items.forEach((item) => {
    if (!item.error) addResourceLookup(lookup, item.url, item.path);
  });
  return lookup;
}

function resolveAssetPath(value, baseUrl, lookup) {
  const raw = String(value || "").trim();
  if (!raw || /^#/.test(raw) || /^(data|blob|mailto|tel|javascript|about|chrome):/i.test(raw)) {
    return "";
  }

  try {
    const href = new URL(raw, baseUrl).href;
    return lookup[href] || lookup[href.split("#")[0]] || "";
  } catch {
    return "";
  }
}

function dirname(path) {
  const index = path.lastIndexOf("/");
  return index >= 0 ? path.slice(0, index + 1) : "";
}

function relativePath(fromFilePath, toFilePath) {
  const fromParts = dirname(fromFilePath).split("/").filter(Boolean);
  const toParts = String(toFilePath || "").split("/").filter(Boolean);
  let shared = 0;

  while (shared < fromParts.length && shared < toParts.length && fromParts[shared] === toParts[shared]) {
    shared += 1;
  }

  const up = new Array(fromParts.length - shared).fill("..");
  const down = toParts.slice(shared);
  return [...up, ...down].join("/") || "./";
}

function escapeCssUrl(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function rewriteCssUrls(cssText, baseUrl, lookup, fromFilePath) {
  if (!cssText || !lookup) return cssText;

  const rewriteTarget = (rawValue) => {
    const targetPath = resolveAssetPath(rawValue, baseUrl, lookup);
    return targetPath ? relativePath(fromFilePath, targetPath) : "";
  };

  return String(cssText)
    .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (match, _quote, rawValue) => {
      const replacement = rewriteTarget(rawValue);
      return replacement ? `url("${escapeCssUrl(replacement)}")` : match;
    })
    .replace(/@import\s+(["'])(.*?)\1/gi, (match, quote, rawValue) => {
      const replacement = rewriteTarget(rawValue);
      return replacement ? `@import ${quote}${escapeCssUrl(replacement)}${quote}` : match;
    });
}

function strToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ByteLength(base64) {
  const cleaned = String(base64 || "").replace(/\s/g, "");
  const padding = cleaned.endsWith("==") ? 2 : cleaned.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((cleaned.length * 3) / 4) - padding);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]
  ));
}

function fmtBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(2)} MB`;
}

function categoryForResource(resource) {
  const url = resource.url || "";
  const mime = String(resource.mimeType || "").toLowerCase();

  if (/\.map(?:$|[?#])/i.test(url)) return "maps";
  if (resource.type === "Document") return "documents";
  if (resource.type === "Stylesheet" || mime.includes("text/css")) return "styles";
  if (resource.type === "Script" || mime.includes("javascript")) return "scripts";
  if (resource.type === "Image" || mime.startsWith("image/")) return "images";
  if (resource.type === "Font" || mime.startsWith("font/")) return "fonts";
  if (resource.type === "Media" || mime.startsWith("video/") || mime.startsWith("audio/")) return "media";
  if (resource.type === "XHR" || resource.type === "Fetch" || mime.includes("json") || mime.includes("xml")) {
    return "data";
  }
  return "other";
}

function flattenResources(frameTree) {
  const resources = [];
  const seen = new Set();

  function push(url, frameId, type, mimeType) {
    if (!/^https?:/i.test(url || "")) return;

    const key = url;
    if (seen.has(key)) return;
    seen.add(key);

    const resource = { url, frameId, type, mimeType: mimeType || "" };
    resources.push({ ...resource, category: categoryForResource(resource) });
  }

  function walk(node) {
    if (!node || !node.frame) return;

    push(node.frame.url, node.frame.id, "Document", "text/html");
    (node.resources || []).forEach((resource) => {
      push(resource.url, node.frame.id, resource.type, resource.mimeType);
    });
    (node.childFrames || []).forEach(walk);
  }

  walk(frameTree);
  return resources;
}

async function captureCloneHtml(job, lookup) {
  const expression = `(${function pageVaultClone(assetLookup, sourceUrl) {
    const absoluteBase = document.baseURI || sourceUrl || location.href;
    const skipProtocol = /^(data|blob|mailto|tel|javascript|about|chrome):/i;

    function findAsset(value, baseUrl) {
      const raw = String(value || "").trim();
      if (!raw || raw.startsWith("#") || skipProtocol.test(raw)) return "";

      try {
        const href = new URL(raw, baseUrl || absoluteBase).href;
        return assetLookup[href] || assetLookup[href.split("#")[0]] || "";
      } catch {
        return "";
      }
    }

    function rewriteAttr(element, attrName, baseUrl) {
      if (!element.hasAttribute(attrName)) return;

      const current = element.getAttribute(attrName);
      const localPath = findAsset(current, baseUrl);
      if (localPath) {
        element.setAttribute(attrName, localPath);
        element.setAttribute(`data-pagevault-original-${attrName}`, current);
      }
    }

    function rewriteSrcset(value, baseUrl) {
      return String(value || "")
        .split(",")
        .map((entry) => {
          const parts = entry.trim().split(/\s+/);
          if (!parts[0]) return entry;

          const localPath = findAsset(parts[0], baseUrl);
          if (!localPath) return entry.trim();

          return [localPath, ...parts.slice(1)].join(" ");
        })
        .join(", ");
    }

    function rewriteCssText(cssText, baseUrl) {
      return String(cssText || "").replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (match, _quote, rawValue) => {
        const localPath = findAsset(rawValue, baseUrl);
        return localPath ? `url("${localPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}")` : match;
      });
    }

    const clone = document.documentElement.cloneNode(true);

    clone.querySelectorAll("base").forEach((node) => node.remove());
    clone.querySelectorAll('meta[http-equiv]').forEach((node) => {
      if (/content-security-policy/i.test(node.getAttribute("http-equiv") || "")) node.remove();
    });

    const liveMedia = Array.from(document.querySelectorAll("img, source, video"));
    const clonedMedia = Array.from(clone.querySelectorAll("img, source, video"));
    liveMedia.forEach((liveNode, index) => {
      const cloneNode = clonedMedia[index];
      if (!cloneNode) return;

      const currentSource = liveNode.currentSrc || liveNode.src || "";
      const localPath = findAsset(currentSource, liveNode.baseURI);
      if (localPath && cloneNode.hasAttribute("src")) cloneNode.setAttribute("src", localPath);
      if (localPath && cloneNode.hasAttribute("srcset")) cloneNode.setAttribute("srcset", localPath);
    });

    clone.querySelectorAll("[src]").forEach((node) => rewriteAttr(node, "src", node.baseURI));
    clone.querySelectorAll("[href]").forEach((node) => rewriteAttr(node, "href", node.baseURI));
    clone.querySelectorAll("[poster]").forEach((node) => rewriteAttr(node, "poster", node.baseURI));
    clone.querySelectorAll("[data-src]").forEach((node) => rewriteAttr(node, "data-src", node.baseURI));
    clone.querySelectorAll("[data-href]").forEach((node) => rewriteAttr(node, "data-href", node.baseURI));
    clone.querySelectorAll("[srcset]").forEach((node) => {
      const current = node.getAttribute("srcset");
      const rewritten = rewriteSrcset(current, node.baseURI);
      if (rewritten !== current) {
        node.setAttribute("srcset", rewritten);
        node.setAttribute("data-pagevault-original-srcset", current);
      }
    });
    clone.querySelectorAll("[style]").forEach((node) => {
      const current = node.getAttribute("style");
      const rewritten = rewriteCssText(current, node.baseURI);
      if (rewritten !== current) node.setAttribute("style", rewritten);
    });
    clone.querySelectorAll("style").forEach((node) => {
      node.textContent = rewriteCssText(node.textContent, absoluteBase);
    });
    clone.querySelectorAll("script").forEach((node) => {
      node.setAttribute("type", "application/pagevault-disabled-script");
      node.setAttribute("data-pagevault-disabled", "true");
    });

    const head = clone.querySelector("head");
    if (head) {
      const meta = document.createElement("meta");
      meta.setAttribute("name", "pagevault-source");
      meta.setAttribute("content", sourceUrl || location.href);
      head.prepend(meta);

      const note = document.createComment(
        " PageVault static UI clone. Scripts are disabled so the captured DOM stays stable when opened locally. "
      );
      head.prepend(note);
    }

    return clone.outerHTML;
  }}(${JSON.stringify(lookup)}, ${JSON.stringify(job.pageUrl)})`;

  const result = await send(job.tabId, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });

  if (result.exceptionDetails) {
    const details = result.exceptionDetails.exception || {};
    throw new Error(details.description || details.value || "Could not build clone snapshot.");
  }

  const html = result.result && typeof result.result.value === "string" ? result.result.value : "";
  if (!html) throw new Error("The page returned an empty clone snapshot.");

  return `<!doctype html>\n${html}`;
}

async function saveCloneKit(job, records) {
  if (!job.options.includeClone) return;

  const lookup = buildResourceLookup(records);
  const generated = [];

  setJobState(job, { phase: "cloning", currentUrl: "" });
  notify(job, "progress");

  try {
    const cloneHtml = await captureCloneHtml(job, lookup);
    await download(
      `${ROOT_FOLDER}/${job.folder}/_clone.html`,
      `data:text/html;base64,${strToBase64(cloneHtml)}`
    );
    generated.push({
      kind: "clone",
      path: "_clone.html",
      bytes: new TextEncoder().encode(cloneHtml).length
    });
  } catch (error) {
    generated.push({
      kind: "clone",
      path: "_clone.html",
      error: error.message
    });
  }

  setJobState(job, { phase: "screenshot", currentUrl: "" });
  notify(job, "progress");

  try {
    const { data } = await send(job.tabId, "Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true
    });
    await download(`${ROOT_FOLDER}/${job.folder}/_reference.png`, `data:image/png;base64,${data}`);
    generated.push({
      kind: "reference",
      path: "_reference.png",
      bytes: base64ByteLength(data)
    });
  } catch (error) {
    generated.push({
      kind: "reference",
      path: "_reference.png",
      error: error.message
    });
  }

  job.generatedFiles = generated;
}

function buildIndexHtml(records, job) {
  const ok = records.filter((record) => !record.error);
  const failed = records.filter((record) => record.error);
  const totalBytes = ok.reduce((sum, record) => sum + record.bytes, 0);
  const generatedFiles = job.generatedFiles || [];
  const quickLinks = generatedFiles
    .filter((file) => !file.error)
    .map((file) => {
      const label = file.kind === "clone" ? "Open UI clone" : "Open reference screenshot";
      return `<a class="quicklink" href="${escapeHtml(file.path)}">${label}</a>`;
    })
    .join("");
  const categoryOrder = ["all", "documents", "styles", "scripts", "images", "fonts", "data", "media", "maps", "other", "errors"];
  const categoryLabels = {
    all: "All",
    data: "Data",
    documents: "Documents",
    errors: "Errors",
    fonts: "Fonts",
    images: "Images",
    maps: "Maps",
    media: "Media",
    other: "Other",
    scripts: "Scripts",
    styles: "Styles"
  };
  const counts = records.reduce((acc, record) => {
    acc[record.category] = (acc[record.category] || 0) + 1;
    return acc;
  }, { all: records.length, errors: failed.length });

  const buttons = categoryOrder
    .filter((key) => key === "all" || key === "errors" || counts[key])
    .map((key) => (
      `<button class="filter${key === "all" ? " active" : ""}" data-filter="${key}">${categoryLabels[key]} <span>${counts[key] || 0}</span></button>`
    ))
    .join("");

  const rows = records
    .map((record) => {
      const status = record.error ? "error" : "ok";
      const pathCell = record.error
        ? `<span class="muted">${escapeHtml(record.path || "not saved")}</span>`
        : `<a href="${record.path.split("/").map(encodeURIComponent).join("/")}">${escapeHtml(record.path)}</a>`;
      const detail = record.error ? escapeHtml(record.error) : escapeHtml(record.url);

      return `<tr data-category="${escapeHtml(record.category)}" data-status="${status}">
  <td><span class="pill ${escapeHtml(record.category)}">${escapeHtml(categoryLabels[record.category] || record.category)}</span></td>
  <td>${pathCell}</td>
  <td class="size">${record.error ? "-" : fmtBytes(record.bytes)}</td>
  <td class="source">${detail}</td>
</tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PageVault - ${escapeHtml(job.folder)}</title>
<style>
  :root {
    --bg: #f7f5ef;
    --panel: #fffdf8;
    --ink: #161b1f;
    --muted: #667085;
    --line: #d9d5ca;
    --soft: #ece7dc;
    --teal: #0f766e;
    --teal-soft: #dff3ef;
    --blue: #2563eb;
    --blue-soft: #e6eefc;
    --orange: #b45309;
    --orange-soft: #f9ead7;
    --red: #b42318;
    --red-soft: #fde8e7;
    --mono: ui-monospace, "SFMono-Regular", Consolas, Menlo, monospace;
    --sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font: 14px/1.45 var(--sans);
  }
  .wrap {
    max-width: 1180px;
    margin: 0 auto;
    padding: 34px 22px 46px;
  }
  header {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 18px;
    align-items: end;
    border-bottom: 1px solid var(--line);
    padding-bottom: 18px;
    margin-bottom: 18px;
  }
  h1 {
    margin: 0 0 6px;
    font-size: 28px;
    line-height: 1.1;
    font-weight: 720;
  }
  .sub {
    margin: 0;
    color: var(--muted);
    font: 12px/1.5 var(--mono);
    overflow-wrap: anywhere;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(3, minmax(118px, 1fr));
    gap: 8px;
    min-width: 390px;
  }
  .stat {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 10px 12px;
  }
  .stat b {
    display: block;
    font-size: 18px;
    line-height: 1.1;
  }
  .stat span {
    color: var(--muted);
    font-size: 12px;
  }
  .toolbar {
    display: grid;
    grid-template-columns: minmax(220px, 1fr) auto;
    gap: 10px;
    margin: 18px 0 12px;
  }
  .quicklinks {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 0 0 16px;
  }
  .quicklink {
    display: inline-flex;
    align-items: center;
    min-height: 36px;
    border: 1px solid var(--teal);
    border-radius: 8px;
    background: var(--teal-soft);
    color: #064e4b;
    padding: 0 12px;
    font: 13px var(--sans);
  }
  input {
    width: 100%;
    height: 38px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--panel);
    color: var(--ink);
    padding: 0 12px;
    font: 13px var(--mono);
    outline: 0;
  }
  input:focus {
    border-color: var(--teal);
    box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.13);
  }
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
    justify-content: flex-end;
  }
  button {
    height: 38px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--panel);
    color: var(--ink);
    cursor: pointer;
    padding: 0 11px;
    font: 12px var(--sans);
  }
  button:hover { border-color: #a9a397; }
  button.active {
    border-color: var(--teal);
    background: var(--teal-soft);
    color: #064e4b;
  }
  button span {
    color: var(--muted);
    font: 11px var(--mono);
    margin-left: 4px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
    overflow: hidden;
  }
  th, td {
    padding: 10px 12px;
    border-bottom: 1px solid var(--line);
    text-align: left;
    vertical-align: top;
  }
  th {
    background: #f0ece3;
    color: var(--muted);
    font-size: 12px;
    font-weight: 680;
  }
  tr:last-child td { border-bottom: 0; }
  tr[hidden] { display: none; }
  a {
    color: var(--teal);
    text-decoration: none;
    font: 12px/1.4 var(--mono);
    overflow-wrap: anywhere;
  }
  a:hover { text-decoration: underline; }
  .pill {
    display: inline-flex;
    align-items: center;
    min-height: 24px;
    border-radius: 8px;
    padding: 2px 8px;
    background: var(--soft);
    color: var(--ink);
    font-size: 12px;
    white-space: nowrap;
  }
  .documents, .styles { background: var(--blue-soft); color: #1d4ed8; }
  .scripts, .data, .maps { background: var(--teal-soft); color: #0f766e; }
  .images, .fonts, .media { background: var(--orange-soft); color: #92400e; }
  .other { background: var(--soft); color: #475467; }
  tr[data-status="error"] .pill { background: var(--red-soft); color: var(--red); }
  .size {
    color: var(--muted);
    font: 12px var(--mono);
    text-align: right;
    white-space: nowrap;
  }
  .source {
    color: var(--muted);
    font: 12px/1.4 var(--mono);
    max-width: 420px;
    overflow-wrap: anywhere;
  }
  .muted { color: var(--muted); font: 12px var(--mono); }
  footer {
    margin-top: 16px;
    color: var(--muted);
    font: 12px var(--mono);
  }
  @media (max-width: 760px) {
    header, .toolbar { grid-template-columns: 1fr; }
    .stats { min-width: 0; grid-template-columns: 1fr; }
    .filters { justify-content: flex-start; }
    table { font-size: 12px; }
    th:nth-child(4), td:nth-child(4) { display: none; }
  }
</style>
</head>
<body>
<main class="wrap">
  <header>
    <div>
      <h1>PageVault archive</h1>
      <p class="sub">${escapeHtml(job.pageUrl)}</p>
    </div>
    <div class="stats">
      <div class="stat"><b>${ok.length}</b><span>files saved</span></div>
      <div class="stat"><b>${fmtBytes(totalBytes)}</b><span>total size</span></div>
      <div class="stat"><b>${failed.length}</b><span>failed</span></div>
    </div>
  </header>
  ${quickLinks ? `<nav class="quicklinks">${quickLinks}</nav>` : ""}
  <div class="toolbar">
    <input id="search" type="search" placeholder="Search paths and URLs" autocomplete="off">
    <div class="filters">${buttons}</div>
  </div>
  <table>
    <thead>
      <tr><th>Type</th><th>Local path</th><th>Size</th><th>Source or error</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <footer>Generated ${escapeHtml(new Date().toLocaleString())} by PageVault ${EXTENSION_VERSION}. Server-side code is not included because browsers never receive it.</footer>
</main>
<script>
  const rows = Array.from(document.querySelectorAll("tbody tr"));
  const search = document.querySelector("#search");
  const filters = Array.from(document.querySelectorAll(".filter"));
  let activeFilter = "all";

  function applyFilter() {
    const query = search.value.trim().toLowerCase();
    rows.forEach((row) => {
      const categoryMatch = activeFilter === "all"
        || (activeFilter === "errors" ? row.dataset.status === "error" : row.dataset.category === activeFilter);
      const textMatch = !query || row.textContent.toLowerCase().includes(query);
      row.hidden = !(categoryMatch && textMatch);
    });
  }

  search.addEventListener("input", applyFilter);
  filters.forEach((button) => {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.filter;
      filters.forEach((item) => item.classList.toggle("active", item === button));
      applyFilter();
    });
  });
</script>
</body>
</html>`;
}

function buildManifestJson(records, job) {
  const saved = records.filter((record) => !record.error);
  const failed = records.filter((record) => record.error);

  return JSON.stringify({
    generatedAt: new Date().toISOString(),
    tool: "PageVault",
    version: EXTENSION_VERSION,
    page: {
      url: job.pageUrl,
      title: job.pageTitle
    },
    folder: `${ROOT_FOLDER}/${job.folder}`,
    totals: {
      discovered: records.length,
      saved: saved.length,
      failed: failed.length,
      bytes: saved.reduce((sum, record) => sum + record.bytes, 0)
    },
    options: job.options,
    generatedFiles: job.generatedFiles || [],
    files: records
  }, null, 2);
}

async function capturePage(job) {
  await attach(job.tabId);

  try {
    await send(job.tabId, "Page.enable");
    const { frameTree } = await send(job.tabId, "Page.getResourceTree");
    const resources = flattenResources(frameTree)
      .filter((resource) => job.options.filters[resource.category])
      .map((resource) => ({ ...resource, path: urlToPath(resource.url, resource) }));
    const plannedLookup = buildResourceLookup(resources);
    const records = [];

    if (!resources.length && !job.options.includeClone) {
      setJobState(job, { running: false, phase: "empty", total: 0, current: 0 });
      notify(job, "error", { message: "No loaded resources matched the selected filters." });
      return;
    }

    setJobState(job, {
      running: true,
      phase: "capturing",
      total: resources.length,
      current: 0,
      saved: 0,
      failed: 0,
      bytes: 0,
      currentUrl: ""
    });
    notify(job, "started");

    for (let i = 0; i < resources.length; i += 1) {
      if (job.cancelRequested) break;

      const resource = resources[i];
      const path = resource.path;

      setJobState(job, {
        current: i + 1,
        currentUrl: resource.url,
        phase: "capturing"
      });
      notify(job, "progress");

      try {
        const { content, base64Encoded } = await send(job.tabId, "Page.getResourceContent", {
          frameId: resource.frameId,
          url: resource.url
        });
        const mime = resource.mimeType || guessMime(path);
        const shouldRewriteCss = job.options.includeClone && resource.category === "styles" && !base64Encoded;
        const finalContent = shouldRewriteCss ? rewriteCssUrls(content, resource.url, plannedLookup, path) : content;
        const dataUrl = base64Encoded
          ? `data:${mime};base64,${content}`
          : `data:${mime};base64,${strToBase64(finalContent)}`;
        const bytes = base64Encoded ? base64ByteLength(content) : new TextEncoder().encode(finalContent).length;

        await download(`${ROOT_FOLDER}/${job.folder}/${path}`, dataUrl);
        records.push({
          url: resource.url,
          path,
          type: resource.type,
          category: resource.category,
          mime,
          bytes
        });

        setJobState(job, {
          saved: job.state.saved + 1,
          bytes: job.state.bytes + bytes
        });
      } catch (error) {
        records.push({
          url: resource.url,
          path,
          type: resource.type,
          category: resource.category,
          mime: resource.mimeType || "",
          bytes: 0,
          error: error.message
        });
        setJobState(job, { failed: job.state.failed + 1 });
      }
    }

    job.records = records;

    if (job.cancelRequested) {
      setJobState(job, { running: false, phase: "cancelled", currentUrl: "" });
      notify(job, "cancelled");
      return;
    }

    await saveCloneKit(job, records);

    if (job.cancelRequested) {
      setJobState(job, { running: false, phase: "cancelled", currentUrl: "" });
      notify(job, "cancelled");
      return;
    }

    setJobState(job, { phase: "indexing", currentUrl: "" });
    notify(job, "progress");

    if (job.options.includeManifest) {
      const manifestJson = buildManifestJson(records, job);
      await download(
        `${ROOT_FOLDER}/${job.folder}/_archive.json`,
        `data:application/json;base64,${strToBase64(manifestJson)}`
      );
    }

    if (job.options.includeIndex) {
      const indexHtml = buildIndexHtml(records, job);
      await download(
        `${ROOT_FOLDER}/${job.folder}/_index.html`,
        `data:text/html;base64,${strToBase64(indexHtml)}`
      );
    }

    setJobState(job, { running: false, phase: "done", currentUrl: "" });
    notify(job, "done");
  } finally {
    await detach(job.tabId);
  }
}

function startCapture(message, sendResponse) {
  if (activeJob && activeJob.state.running) {
    sendResponse({ ok: false, error: "A capture is already running." });
    return;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];

    if (!tab || !/^https?:/i.test(tab.url || "")) {
      sendResponse({ ok: false, error: "Open a normal http or https page first." });
      return;
    }

    const options = normalizeOptions(message.options);
    const folder = sanitizeFolder(message.folder || defaultFolderFromUrl(tab.url));
    const job = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      tabId: tab.id,
      pageUrl: tab.url,
      pageTitle: tab.title || "",
      folder,
      options,
      cancelRequested: false,
      records: [],
      generatedFiles: [],
      state: {
        running: true,
        phase: "starting",
        total: 0,
        current: 0,
        saved: 0,
        failed: 0,
        bytes: 0,
        currentUrl: ""
      }
    };

    activeJob = job;

    capturePage(job)
      .catch((error) => {
        setJobState(job, { running: false, phase: "error", currentUrl: "" });
        notify(job, "error", { message: error.message });
      })
      .finally(() => {
        if (activeJob && activeJob.id === job.id) activeJob = null;
      });

    sendResponse({ ok: true, started: true, jobId: job.id, folder });
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.action) return false;

  if (message.action === "capture") {
    startCapture(message, sendResponse);
    return true;
  }

  if (message.action === "cancel") {
    if (!activeJob) {
      sendResponse({ ok: false, error: "No capture is running." });
      return false;
    }

    activeJob.cancelRequested = true;
    notify(activeJob, "progress", { phase: "cancelling" });
    sendResponse({ ok: true });
    return false;
  }

  if (message.action === "getState") {
    sendResponse({ ok: true, active: Boolean(activeJob), state: activeJob ? snapshot(activeJob) : null });
    return false;
  }

  return false;
});
