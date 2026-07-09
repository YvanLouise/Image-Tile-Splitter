const statusBadge = document.querySelector("#statusBadge");
const remoteValue = document.querySelector("#remoteValue");
const branchValue = document.querySelector("#branchValue");
const statusCount = document.querySelector("#statusCount");
const commitMessage = document.querySelector("#commitMessage");
const startButton = document.querySelector("#startButton");
const refreshButton = document.querySelector("#refreshButton");
const confirmPanel = document.querySelector("#confirmPanel");
const confirmButton = document.querySelector("#confirmButton");
const cancelButton = document.querySelector("#cancelButton");
const changesOutput = document.querySelector("#changesOutput");
const normalLog = document.querySelector("#normalLog");
const errorLog = document.querySelector("#errorLog");
const copyErrorButton = document.querySelector("#copyErrorButton");
const clearNormalButton = document.querySelector("#clearNormalButton");

let currentRunId = null;
let eventSource = null;
let normalLines = [];
let errorLines = [];
let changes = [];

const labels = {
  idle: "idle",
  running: "running",
  awaiting_confirmation: "waiting confirm",
  success: "success",
  failed: "failed",
};

startButton.addEventListener("click", () => {
  void startRun();
});

refreshButton.addEventListener("click", () => {
  void loadRepo();
});

confirmButton.addEventListener("click", () => {
  void postRunAction("confirm");
});

cancelButton.addEventListener("click", () => {
  void postRunAction("cancel");
});

copyErrorButton.addEventListener("click", () => {
  void copyErrorLog();
});

clearNormalButton.addEventListener("click", () => {
  normalLines = [];
  renderLogs();
});

void loadRepo();

async function loadRepo() {
  try {
    const repo = await requestJson("/api/repo");
    remoteValue.textContent = repo.remote || "未配置 origin";
    branchValue.textContent = repo.branch || "main";
    statusCount.textContent = `${repo.status.length} 个文件`;
    commitMessage.value = commitMessage.value || repo.defaultCommitMessage;
    changes = repo.status;
    renderChanges();
    if (repo.activeRunId && repo.activeRunId !== currentRunId) {
      attachEvents(repo.activeRunId);
    }
  } catch (error) {
    setStatus("failed");
    errorLines.push(formatClientError(error));
    renderLogs();
  }
}

async function startRun() {
  resetRunView();
  setStatus("running");
  startButton.disabled = true;
  refreshButton.disabled = true;

  try {
    const run = await requestJson("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commitMessage: commitMessage.value }),
    });
    attachEvents(run.id);
  } catch (error) {
    setStatus("failed");
    errorLines.push(formatClientError(error));
    renderLogs();
    startButton.disabled = false;
    refreshButton.disabled = false;
  }
}

function attachEvents(runId) {
  currentRunId = runId;
  if (eventSource) eventSource.close();
  eventSource = new EventSource(`/api/runs/${runId}/events`);

  eventSource.addEventListener("snapshot", (event) => {
    applySnapshot(JSON.parse(event.data));
  });
  eventSource.addEventListener("state", (event) => {
    applyState(JSON.parse(event.data));
  });
  eventSource.addEventListener("changes", (event) => {
    changes = JSON.parse(event.data).changes ?? [];
    renderChanges();
  });
  eventSource.addEventListener("log", (event) => {
    normalLines.push(JSON.parse(event.data).message);
    renderLogs();
  });
  eventSource.addEventListener("error-log", (event) => {
    errorLines.push(JSON.parse(event.data).message);
    renderLogs();
  });
  eventSource.addEventListener("done", (event) => {
    applyState(JSON.parse(event.data));
    eventSource.close();
    eventSource = null;
  });
  eventSource.onerror = () => {
    if (statusBadge.dataset.status === "success" || statusBadge.dataset.status === "failed") {
      return;
    }
    errorLines.push("[client] 日志连接已断开，可刷新页面重新连接。");
    renderLogs();
  };
}

function applySnapshot(run) {
  normalLines = [...run.logs];
  errorLines = [...run.errors];
  changes = [...run.changes];
  applyState(run);
  renderChanges();
  renderLogs();
}

function applyState(run) {
  setStatus(run.status);
  remoteValue.textContent = run.remote || remoteValue.textContent;
  branchValue.textContent = run.branch || branchValue.textContent;
  statusCount.textContent = `${(run.changes ?? changes).length} 个文件`;
  const waiting = run.status === "awaiting_confirmation";
  confirmPanel.classList.toggle("hidden", !waiting);
  startButton.disabled = run.status === "running" || waiting;
  refreshButton.disabled = run.status === "running" || waiting;
  confirmButton.disabled = !waiting;
  cancelButton.disabled = !waiting;
  if (run.status === "success" || run.status === "failed") {
    startButton.disabled = false;
    refreshButton.disabled = false;
  }
}

async function postRunAction(action) {
  if (!currentRunId) return;
  confirmButton.disabled = true;
  cancelButton.disabled = true;
  try {
    await requestJson(`/api/runs/${currentRunId}/${action}`, { method: "POST" });
    confirmPanel.classList.add("hidden");
  } catch (error) {
    errorLines.push(formatClientError(error));
    renderLogs();
  }
}

async function copyErrorLog() {
  const text = errorLines.join("\n");
  try {
    await navigator.clipboard.writeText(text);
    copyErrorButton.textContent = "已复制";
    window.setTimeout(() => {
      copyErrorButton.textContent = "复制错误日志";
    }, 1200);
  } catch {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(errorLog);
    selection?.removeAllRanges();
    selection?.addRange(range);
    copyErrorButton.textContent = "已选中";
  }
}

function resetRunView() {
  normalLines = [];
  errorLines = [];
  changes = [];
  renderChanges();
  renderLogs();
  confirmPanel.classList.add("hidden");
}

function renderChanges() {
  changesOutput.textContent = changes.length ? changes.join("\n") : "暂无变更";
  statusCount.textContent = `${changes.length} 个文件`;
}

function renderLogs() {
  normalLog.textContent = normalLines.length ? normalLines.join("\n") : "等待运行";
  errorLog.textContent = errorLines.length ? errorLines.join("\n") : "暂无错误";
  normalLog.scrollTop = normalLog.scrollHeight;
  errorLog.scrollTop = errorLog.scrollHeight;
}

function setStatus(status) {
  statusBadge.dataset.status = status;
  statusBadge.className = `badge ${status}`;
  statusBadge.textContent = labels[status] ?? status;
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return payload;
}

function formatClientError(error) {
  return `[client] ${error instanceof Error ? error.message : String(error)}`;
}
