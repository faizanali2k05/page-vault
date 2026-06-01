const STORE_KEY = "pageVaultOptions";

const DEFAULT_OPTIONS = {
  filters: {
    documents: true,
    styles: true,
    scripts: true,
    images: true,
    fonts: true,
    data: true,
    maps: true,
    media: false,
    other: false
  },
  includeClone: true,
  includeIndex: true,
  includeManifest: true
};

const filterIds = ["documents", "styles", "scripts", "images", "fonts", "data", "maps", "media", "other"];

const ui = {
  bar: document.getElementById("bar"),
  bytesCount: document.getElementById("bytesCount"),
  cancel: document.getElementById("cancel"),
  failedCount: document.getElementById("failedCount"),
  folder: document.getElementById("folder"),
  includeClone: document.getElementById("includeClone"),
  includeIndex: document.getElementById("includeIndex"),
  includeManifest: document.getElementById("includeManifest"),
  openDownloads: document.getElementById("openDownloads"),
  pageLabel: document.getElementById("pageLabel"),
  progressPanel: document.getElementById("progressPanel"),
  resetFolder: document.getElementById("resetFolder"),
  savedCount: document.getElementById("savedCount"),
  start: document.getElementById("start"),
  statusCount: document.getElementById("statusCount"),
  statusText: document.getElementById("statusText"),
  version: document.getElementById("version")
};

let activeTab = null;
let activeJobId = null;
let defaultFolder = "page_capture";

function pad(value) {
  return String(value).padStart(2, "0");
}

function makeTimestamp() {
  const d = new Date();
  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate())
  ].join("-") + "_" + [pad(d.getHours()), pad(d.getMinutes()), pad(d.getSeconds())].join("-");
}

function sanitizeFolder(value) {
  return String(value || "page")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 80) || `page_${makeTimestamp()}`;
}

function folderFromUrl(rawUrl) {
  try {
    return sanitizeFolder(`${new URL(rawUrl).hostname}-Custom`);
  } catch {
    return sanitizeFolder(`page-Custom`);
  }
}

function getCleanHostname() {
  if (activeTab && /^https?:/i.test(activeTab.url || "")) {
    try {
      return new URL(activeTab.url).hostname;
    } catch {
      return "page";
    }
  }
  return "page";
}

function fmtBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1048576) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1048576).toFixed(2)} MB`;
}

function leaf(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || url.hostname);
  } catch {
    return rawUrl || "";
  }
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      resolve(error ? { ok: false, error: error.message } : response || { ok: true });
    });
  });
}

function queryActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs[0] || null);
    });
  });
}

// Storage helpers
function storageGet(defaults) {
  return new Promise((resolve) => chrome.storage.local.get(defaults, resolve));
}

function getOptions() {
  const filters = {};
  filterIds.forEach((id) => {
    filters[id] = document.getElementById(id).checked;
  });

  return {
    filters,
    includeClone: ui.includeClone.checked,
    includeIndex: ui.includeIndex.checked,
    includeManifest: ui.includeManifest.checked
  };
}

function applyOptions(options) {
  const merged = {
    ...DEFAULT_OPTIONS,
    ...options,
    filters: { ...DEFAULT_OPTIONS.filters, ...((options && options.filters) || {}) }
  };

  filterIds.forEach((id) => {
    document.getElementById(id).checked = Boolean(merged.filters[id]);
  });
  ui.includeClone.checked = Boolean(merged.includeClone);
  ui.includeIndex.checked = Boolean(merged.includeIndex);
  ui.includeManifest.checked = Boolean(merged.includeManifest);
}

function saveOptions() {
  chrome.storage.local.set({ [STORE_KEY]: getOptions() });
}

function hasAnyFilter(options) {
  return options.includeClone || Object.values(options.filters).some(Boolean);
}

function setRunning(running) {
  activeJobId = running ? activeJobId : null;
  ui.start.disabled = running;
  ui.folder.disabled = running;
  ui.resetFolder.disabled = running;
  ui.includeClone.disabled = running;
  ui.includeIndex.disabled = running;
  ui.includeManifest.disabled = running;
  
  filterIds.forEach((id) => {
    document.getElementById(id).disabled = running;
  });

  // Toggle Kit card button states visually and functionally
  const kitBtns = document.querySelectorAll(".kit-download-btn");
  kitBtns.forEach((btn) => {
    btn.disabled = running;
    btn.style.opacity = running ? "0.3" : "1";
    btn.style.pointerEvents = running ? "none" : "auto";
  });

  if (running) {
    ui.progressPanel.classList.remove("hidden");
  }
}

function setPanelState(kind) {
  ui.progressPanel.classList.remove("is-error", "is-done", "is-cancelled");
  if (kind) ui.progressPanel.classList.add(kind);
}

function updateProgress(message) {
  const total = Number(message.total || 0);
  const current = Number(message.current || 0);
  const saved = Number(message.saved || 0);
  const failed = Number(message.failed || 0);
  const bytes = Number(message.bytes || 0);
  const pct = total ? Math.min(100, Math.round((current / total) * 100)) : 0;

  ui.bar.style.width = `${pct}%`;
  ui.statusCount.textContent = `${current}/${total}`;
  ui.savedCount.textContent = String(saved);
  ui.failedCount.textContent = String(failed);
  ui.bytesCount.textContent = fmtBytes(bytes);

  if (message.phase === "indexing") {
    ui.statusText.textContent = "Building index...";
  } else if (message.phase === "cloning") {
    ui.statusText.textContent = "Building static clone...";
  } else if (message.phase === "screenshot") {
    ui.statusText.textContent = "Taking reference screenshot...";
  } else if (message.phase === "cancelling") {
    ui.statusText.textContent = "Cancelling task...";
  } else if (message.currentUrl) {
    ui.statusText.textContent = `Saving: ${leaf(message.currentUrl)}`;
  } else {
    ui.statusText.textContent = message.phase || "Working...";
  }
}

function showReady() {
  setPanelState("");
  ui.bar.style.width = "0%";
  ui.statusText.textContent = "Ready";
  ui.statusCount.textContent = "0/0";
  ui.savedCount.textContent = "0";
  ui.failedCount.textContent = "0";
  ui.bytesCount.textContent = "0 B";
  ui.progressPanel.classList.add("hidden");
}

async function startCapture() {
  const options = getOptions();
  if (!hasAnyFilter(options)) {
    ui.progressPanel.classList.remove("hidden");
    setPanelState("is-error");
    ui.statusText.textContent = "Enable at least one asset type";
    return;
  }

  saveOptions();
  setPanelState("");
  setRunning(true);
  ui.bar.style.width = "0%";
  ui.statusText.textContent = "Initializing...";
  ui.statusCount.textContent = "0/0";
  ui.savedCount.textContent = "0";
  ui.failedCount.textContent = "0";
  ui.bytesCount.textContent = "0 B";

  const response = await sendMessage({
    action: "capture",
    folder: sanitizeFolder(ui.folder.value || defaultFolder),
    options
  });

  if (!response.ok) {
    setRunning(false);
    ui.progressPanel.classList.remove("hidden");
    setPanelState("is-error");
    ui.statusText.textContent = response.error || "Capture could not start";
    return;
  }

  activeJobId = response.jobId;
  ui.folder.value = response.folder || ui.folder.value;
}

async function triggerKitCapture(kitType) {
  if (activeJobId) return; // Prevent double trigger
  
  const hostname = getCleanHostname();
  const folderName = `${hostname}-${kitType.toUpperCase()}`;
  
  const filters = {
    documents: false,
    styles: false,
    scripts: false,
    images: false,
    fonts: false,
    data: false,
    maps: false,
    media: false,
    other: false
  };
  
  let includeClone = false;
  let includeIndex = true;
  let includeManifest = true;

  if (kitType === "ui") {
    filters.documents = true;
    filters.styles = true;
    filters.scripts = true;
    includeClone = true;
  } else if (kitType === "assets") {
    filters.images = true;
    filters.media = true;
    filters.other = true;
  } else if (kitType === "fonts") {
    filters.fonts = true;
  } else if (kitType === "data") {
    filters.data = true;
    filters.maps = true;
  } else if (kitType === "full") {
    Object.keys(filters).forEach(key => filters[key] = true);
    includeClone = true;
  }

  // Visual feedback: check the filters that correspond to this kit in advanced options
  filterIds.forEach((id) => {
    document.getElementById(id).checked = Boolean(filters[id]);
  });
  ui.includeClone.checked = includeClone;
  ui.includeIndex.checked = includeIndex;
  ui.includeManifest.checked = includeManifest;
  
  ui.folder.value = folderName;

  await startCapture();
}

async function cancelCapture() {
  ui.statusText.textContent = "Cancelling...";
  await sendMessage({ action: "cancel" });
}

function handleRuntimeMessage(message) {
  if (!message || !message.type) return;
  if (activeJobId && message.jobId && message.jobId !== activeJobId) return;
  if (message.jobId) activeJobId = message.jobId;

  if (message.type === "started" || message.type === "progress") {
    setRunning(true);
    setPanelState("");
    updateProgress(message);
    return;
  }

  if (message.type === "done") {
    updateProgress(message);
    ui.bar.style.width = "100%";
    ui.statusText.textContent = `Completed: ${message.saved || 0} saved`;
    setPanelState("is-done");
    setRunning(false);
    return;
  }

  if (message.type === "cancelled") {
    updateProgress(message);
    ui.statusText.textContent = "Job cancelled";
    setPanelState("is-cancelled");
    setRunning(false);
    return;
  }

  if (message.type === "error") {
    updateProgress(message);
    ui.statusText.textContent = message.message || "Capture task failed";
    setPanelState("is-error");
    setRunning(false);
  }
}

async function restoreActiveJob() {
  const response = await sendMessage({ action: "getState" });
  if (!response.ok || !response.active || !response.state) return;

  activeJobId = response.state.jobId;
  ui.folder.value = response.state.folder || ui.folder.value;
  setRunning(true);
  updateProgress(response.state);
}

async function init() {
  ui.version.textContent = `v${chrome.runtime.getManifest().version}`;

  activeTab = await queryActiveTab();
  if (activeTab && /^https?:/i.test(activeTab.url || "")) {
    const url = new URL(activeTab.url);
    ui.pageLabel.textContent = url.hostname;
    ui.pageLabel.title = activeTab.title || activeTab.url;
    defaultFolder = folderFromUrl(activeTab.url);
  } else {
    ui.pageLabel.textContent = "No capturable tab found";
    defaultFolder = folderFromUrl("https://page.local");
  }

  ui.folder.value = defaultFolder;

  const stored = await storageGet({ [STORE_KEY]: DEFAULT_OPTIONS });
  applyOptions(stored[STORE_KEY]);
  showReady();

  // Accordion Toggle
  const accordion = document.getElementById("advancedAccordion");
  const accordionHeader = document.getElementById("accordionHeader");
  accordionHeader.addEventListener("click", () => {
    accordion.classList.toggle("open");
  });

  // Action listeners
  ui.start.addEventListener("click", startCapture);
  ui.cancel.addEventListener("click", cancelCapture);
  ui.resetFolder.addEventListener("click", () => {
    ui.folder.value = defaultFolder;
  });
  ui.openDownloads.addEventListener("click", () => {
    chrome.downloads.showDefaultFolder();
  });
  ui.folder.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !ui.folder.disabled) startCapture();
  });

  // Specialized Kit Buttons
  document.getElementById("btnUiKit").addEventListener("click", () => triggerKitCapture("ui"));
  document.getElementById("btnAssetsKit").addEventListener("click", () => triggerKitCapture("assets"));
  document.getElementById("btnFontsKit").addEventListener("click", () => triggerKitCapture("fonts"));
  document.getElementById("btnDataKit").addEventListener("click", () => triggerKitCapture("data"));
  document.getElementById("btnFullKit").addEventListener("click", () => triggerKitCapture("full"));

  // Checkbox state persistence
  filterIds.forEach((id) => document.getElementById(id).addEventListener("change", saveOptions));
  ui.includeClone.addEventListener("change", saveOptions);
  ui.includeIndex.addEventListener("change", saveOptions);
  ui.includeManifest.addEventListener("change", saveOptions);
  
  chrome.runtime.onMessage.addListener(handleRuntimeMessage);

  await restoreActiveJob();
}

init();
