const ui = {
  analyze: document.getElementById("analyze"),
  status: document.getElementById("status"),
  pageLabel: document.getElementById("pageLabel"),
  result: document.getElementById("result"),
  rElements: document.getElementById("rElements"),
  rComponents: document.getElementById("rComponents"),
  rTokens: document.getElementById("rTokens"),
  rBreakpoints: document.getElementById("rBreakpoints"),
  resultFile: document.getElementById("resultFile"),
  download: document.getElementById("download"),
  openDownloads: document.getElementById("openDownloads")
};

// Holds the most recent report in memory. Nothing touches disk until the
// user clicks Download.
let report = null;

const ANALYZE_ICON =
  '<svg fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.5" y2="16.5"></line></svg>';
const DOWNLOAD_ICON =
  '<svg fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>';

function queryActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0] || null));
  });
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      resolve(error ? { ok: false, error: error.message } : response || { ok: false, error: "No response" });
    });
  });
}

function setStatus(text, kind) {
  ui.status.textContent = text;
  ui.status.className = `status${kind ? ` ${kind}` : ""}`;
}

function setBusy(busy) {
  ui.analyze.disabled = busy;
  ui.analyze.innerHTML = busy ? '<span class="spinner"></span> Analyzing...' : `${ANALYZE_ICON} Analyze UI/UX`;
}

function resetDownloadButton() {
  ui.download.disabled = false;
  ui.download.className = "download-btn";
  ui.download.innerHTML = `${DOWNLOAD_ICON} Download .md report`;
  ui.openDownloads.classList.remove("show");
}

function countComponents(c) {
  if (!c) return 0;
  const headingTotal = Object.values(c.headings || {}).reduce((a, b) => a + b, 0);
  return (
    (c.links || 0) +
    (c.buttons || 0) +
    (c.inputs || 0) +
    (c.images || 0) +
    (c.svgs || 0) +
    (c.tables || 0) +
    (c.lists || 0) +
    headingTotal
  );
}

async function analyze() {
  setBusy(true);
  setStatus("Scanning the page...");
  ui.result.classList.remove("show");
  report = null;

  const response = await sendMessage({ action: "analyze" });

  setBusy(false);

  if (!response.ok) {
    setStatus(response.error || "Analysis failed", "error");
    return;
  }

  report = { markdown: response.markdown, filename: response.filename };

  const s = response.summary;
  setStatus("Report ready — click Download to save", "done");
  ui.rElements.textContent = String(s.elementCount || 0);
  ui.rComponents.textContent = String(countComponents(s.components));
  ui.rTokens.textContent = String(s.tokens || 0);
  ui.rBreakpoints.textContent = String(s.breakpoints || 0);
  ui.resultFile.textContent = s.filename || "";
  resetDownloadButton();
  ui.result.classList.add("show");
}

async function downloadReport() {
  if (!report) return;

  ui.download.disabled = true;
  setStatus("Saving report...");

  const response = await sendMessage({
    action: "download",
    markdown: report.markdown,
    filename: report.filename
  });

  if (!response.ok) {
    ui.download.disabled = false;
    setStatus(response.error || "Download failed", "error");
    return;
  }

  ui.download.className = "download-btn saved";
  ui.download.innerHTML = "✓ Saved to Downloads/UXRay/";
  ui.openDownloads.classList.add("show");
  setStatus("Saved", "done");
}

async function init() {
  const tab = await queryActiveTab();
  if (tab && /^https?:/i.test(tab.url || "")) {
    try {
      ui.pageLabel.textContent = new URL(tab.url).hostname;
      ui.pageLabel.title = tab.title || tab.url;
    } catch {
      ui.pageLabel.textContent = "Active tab";
    }
  } else {
    ui.pageLabel.textContent = "Open an http/https page to analyze";
    ui.analyze.disabled = true;
  }

  ui.analyze.addEventListener("click", analyze);
  ui.download.addEventListener("click", downloadReport);
  ui.openDownloads.addEventListener("click", () => chrome.downloads.showDefaultFolder());
}

init();
