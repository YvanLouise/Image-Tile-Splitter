import { createReadStream, existsSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_BRANCH = "main";
const DEFAULT_MESSAGE = "Update image tile splitter app";
const START_PORT = 4280;
const END_PORT = 4299;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "../..");
const shouldOpen = process.argv.includes("--open");

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
]);

const runs = new Map();
let activeRunId = null;
let nextRunId = 1;
let browserOpened = false;

const server = createServer((request, response) => {
  void handleRequest(request, response).catch((error) => {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : "Unexpected server error",
    });
  });
});

const existingConsoleUrl = shouldOpen ? await findExistingConsoleUrl() : null;
if (existingConsoleUrl) {
  console.log(`GitHub push console is already running at ${existingConsoleUrl}`);
  openBrowserOnce(existingConsoleUrl);
  process.exit(0);
}

listenWithFallback(START_PORT);

async function handleRequest(request, response) {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (request.method === "GET" && url.pathname === "/api/repo") {
    sendJson(response, 200, await getRepoInfo());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, {
      app: "image-splitter-push-console",
      ok: true,
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/runs") {
    if (activeRunId) {
      sendJson(response, 409, { error: "A push task is already running." });
      return;
    }
    const body = await readJsonBody(request);
    const run = createRun(body.commitMessage);
    activeRunId = run.id;
    runs.set(run.id, run);
    sendJson(response, 201, snapshotRun(run));
    queueMicrotask(() => {
      void runPreflight(run);
    });
    return;
  }

  const runSnapshotMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (request.method === "GET" && runSnapshotMatch) {
    const run = runs.get(runSnapshotMatch[1]);
    if (!run) {
      sendJson(response, 404, { error: "Run not found." });
      return;
    }
    sendJson(response, 200, snapshotRun(run));
    return;
  }

  const runEventMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
  if (request.method === "GET" && runEventMatch) {
    const run = runs.get(runEventMatch[1]);
    if (!run) {
      sendJson(response, 404, { error: "Run not found." });
      return;
    }
    attachEventStream(run, response);
    request.on("close", () => {
      run.clients.delete(response);
    });
    return;
  }

  const runActionMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/(confirm|cancel)$/);
  if (request.method === "POST" && runActionMatch) {
    const run = runs.get(runActionMatch[1]);
    if (!run) {
      sendJson(response, 404, { error: "Run not found." });
      return;
    }
    if (run.status !== "awaiting_confirmation" || !run.confirmation) {
      sendJson(response, 409, { error: "Run is not waiting for confirmation." });
      return;
    }
    run.confirmation(runActionMatch[2] === "confirm");
    run.confirmation = null;
    sendJson(response, 200, snapshotRun(run));
    return;
  }

  if (request.method === "GET") {
    serveStatic(url.pathname, response);
    return;
  }

  sendJson(response, 405, { error: "Method not allowed." });
}

function createRun(commitMessage) {
  const message = typeof commitMessage === "string" && commitMessage.trim()
    ? commitMessage.trim()
    : DEFAULT_MESSAGE;
  return {
    id: String(nextRunId++),
    status: "running",
    commitMessage: message,
    branch: DEFAULT_BRANCH,
    remote: "",
    logs: [],
    errors: [],
    changes: [],
    clients: new Set(),
    confirmation: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
  };
}

async function runPreflight(run) {
  try {
    publishState(run, "running");
    log(run, "开始 GitHub 推送检查。");

    await execute(run, "git", ["--version"], { label: "检查 Git" });

    if (!existsSync(join(projectRoot, ".git"))) {
      await execute(run, "git", ["init"], { label: "初始化 Git 仓库" });
    }
    assertGitMetadataWritable();

    const branchResult = await execute(run, "git", ["branch", "--show-current"], {
      label: "读取当前分支",
      allowFailure: true,
      quietCommand: true,
    });
    const currentBranch = branchResult.stdout.trim();
    run.branch = currentBranch || DEFAULT_BRANCH;
    emit(run, "state", snapshotRun(run));

    if (currentBranch) {
      log(run, `当前分支: ${run.branch}`);
    } else {
      await execute(run, "git", ["checkout", "-B", run.branch], {
        label: `创建分支 ${run.branch}`,
      });
    }

    const remoteResult = await execute(run, "git", ["remote", "get-url", "origin"], {
      label: "检查 origin 远程仓库",
    });
    run.remote = remoteResult.stdout.trim();
    log(run, `Repository: ${run.remote}`);
    log(run, `Branch: ${run.branch}`);
    log(run, `Commit message: ${run.commitMessage}`);
    emit(run, "state", snapshotRun(run));

    if (!existsSync(join(projectRoot, "node_modules"))) {
      await execute(run, "npm", ["install"], { label: "安装依赖" });
    }

    await execute(run, "npm", ["test", "--", "--run", "--cache=false"], {
      label: "运行测试",
    });
    await execute(run, "npm", ["run", "build"], { label: "运行构建检查" });

    const status = await execute(run, "git", ["status", "--short"], {
      label: "列出待上传文件",
      allowFailure: false,
      quietCommand: true,
    });
    run.changes = status.stdout.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean);
    emit(run, "changes", { changes: run.changes });

    if (run.changes.length > 0) {
      log(run, "检测到本地变更，等待网页确认后再提交并推送。");
      publishState(run, "awaiting_confirmation");
      const confirmed = await waitForConfirmation(run);
      if (!confirmed) {
        errorLog(run, "已取消：未执行 git add、git commit 或 git push。");
        publishState(run, "failed");
        return;
      }
      publishState(run, "running");
      await stageAndCommit(run);
    } else {
      log(run, "没有本地文件变更，跳过提交步骤。");
    }

    await pushToRemote(run);
    log(run, "Push complete. GitHub Pages will deploy from Actions if configured.");
    publishState(run, "success");
  } catch (error) {
    errorLog(run, error instanceof Error ? error.message : String(error));
    publishState(run, "failed");
  } finally {
    if (activeRunId === run.id) activeRunId = null;
  }
}

async function stageAndCommit(run) {
  assertGitMetadataWritable();
  await execute(run, "git", ["add", "--all", "--", "."], { label: "暂存文件" });
  const diff = await execute(run, "git", ["diff", "--cached", "--quiet"], {
    label: "检查暂存区",
    allowFailure: true,
    quietCommand: true,
  });
  if (diff.code === 0) {
    log(run, "暂存区没有需要提交的文件。");
    return;
  }
  await commitWithMessageFile(run);
}

function assertGitMetadataWritable() {
  const gitDir = join(projectRoot, ".git");
  const indexLock = join(gitDir, "index.lock");
  if (existsSync(indexLock)) {
    throw new Error(
      [
        "检测到 .git/index.lock，Git 当前被另一个进程锁定或上次操作异常退出。",
        "请关闭其他 Git/推送窗口后删除 .git/index.lock，再重新运行 push-github.cmd。",
      ].join("\n"),
    );
  }

  const probeFile = join(gitDir, `codex-push-write-test-${process.pid}.tmp`);
  try {
    writeFileSync(probeFile, "write-test", "utf8");
  } catch {
    throw new Error(
      [
        "当前推送服务没有权限写入 .git 目录，因此无法执行 git add / git commit。",
        "请关闭当前推送窗口后，直接双击项目里的 push-github.cmd 重新启动；不要从受限沙盒或只读环境启动。",
        "如果仍然失败，请检查 Windows 安全软件/受控文件夹访问，或右键以管理员身份运行 push-github.cmd。",
      ].join("\n"),
    );
  } finally {
    try {
      unlinkSync(probeFile);
    } catch {
      // Probe cleanup is best-effort.
    }
  }
}

async function commitWithMessageFile(run) {
  const messageFile = join(tmpdir(), `image-splitter-commit-${process.pid}-${run.id}.txt`);
  writeFileSync(messageFile, `${run.commitMessage}\n`, "utf8");
  try {
    await execute(run, "git", ["commit", "-F", messageFile], {
      label: "创建提交",
    });
  } finally {
    try {
      unlinkSync(messageFile);
    } catch {
      // Temporary commit message cleanup is best-effort.
    }
  }
}

async function pushToRemote(run) {
  log(run, "检查远端分支状态。");
  const fetch = await execute(run, "git", ["fetch", "origin", run.branch], {
    label: "获取远端分支",
    allowFailure: true,
    quietCommand: true,
  });

  if (fetch.code === 0) {
    const revList = await execute(
      run,
      "git",
      ["rev-list", "--left-right", "--count", `origin/${run.branch}...HEAD`],
      { label: "比较本地和远端提交", quietCommand: true },
    );
    const [remoteOnly = "0"] = revList.stdout.trim().split(/\s+/);
    if (Number(remoteOnly) > 0) {
      throw new Error(
        `远端分支有 ${remoteOnly} 个本地没有的提交。请先运行 git pull --rebase origin ${run.branch} 并解决冲突后再重试。`,
      );
    }
  } else {
    log(run, `远端分支 origin/${run.branch} 不存在，将在推送时创建。`);
  }

  const push = await execute(run, "git", ["push", "-u", "origin", run.branch], {
    label: "推送到 GitHub",
    allowFailure: true,
  });
  if (push.code !== 0) {
    throw new Error(
      "Push failed. If this is an authentication issue, sign in through Git Credential Manager or use a GitHub Personal Access Token, then run this page again.",
    );
  }
}

function waitForConfirmation(run) {
  return new Promise((resolveConfirm) => {
    run.confirmation = resolveConfirm;
  });
}

function execute(run, command, args, options = {}) {
  const label = options.label ?? [command, ...args].join(" ");
  log(run, `== ${label} ==`);
  if (!options.quietCommand) log(run, `> ${formatCommand(command, args)}`);

  return new Promise((resolveExecute, rejectExecute) => {
    const executable = resolveExecutable(command, args);
    const child = spawn(executable.command, executable.args, {
      cwd: projectRoot,
      shell: executable.shell,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      text.split(/\r?\n/).filter(Boolean).forEach((line) => log(run, line));
    });

    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      text.split(/\r?\n/).filter(Boolean).forEach((line) => {
        if (/^warning:/i.test(line)) log(run, line);
        else errorLog(run, line);
      });
    });

    child.on("error", (error) => {
      rejectExecute(error);
    });

    child.on("close", (code) => {
      const result = { code: code ?? 1, stdout, stderr };
      if (result.code !== 0 && !options.allowFailure) {
        rejectExecute(new Error(`${label} failed with exit code ${result.code}.`));
        return;
      }
      resolveExecute(result);
    });
  });
}

async function getRepoInfo() {
  const [branch, remote, status] = await Promise.all([
    collect("git", ["branch", "--show-current"], true),
    collect("git", ["remote", "get-url", "origin"], true),
    collect("git", ["status", "--short"], true),
  ]);
  return {
    defaultCommitMessage: DEFAULT_MESSAGE,
    branch: branch.stdout.trim() || DEFAULT_BRANCH,
    remote: remote.code === 0 ? remote.stdout.trim() : "",
    status: status.stdout.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean),
    activeRunId,
  };
}

function collect(command, args, allowFailure = false) {
  return new Promise((resolveCollect, rejectCollect) => {
    const executable = resolveExecutable(command, args);
    const child = spawn(executable.command, executable.args, {
      cwd: projectRoot,
      shell: executable.shell,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", rejectCollect);
    child.on("close", (code) => {
      const result = { code: code ?? 1, stdout, stderr };
      if (result.code !== 0 && !allowFailure) rejectCollect(new Error(stderr || stdout));
      else resolveCollect(result);
    });
  });
}

function publishState(run, status) {
  run.status = status;
  if (status === "success" || status === "failed") {
    run.finishedAt = new Date().toISOString();
  }
  emit(run, "state", snapshotRun(run));
  if (status === "success" || status === "failed") {
    emit(run, "done", snapshotRun(run));
  }
}

function log(run, message) {
  const entry = formatLogLine(message);
  run.logs.push(entry);
  emit(run, "log", { message: entry });
}

function errorLog(run, message) {
  const entry = formatLogLine(message);
  run.errors.push(entry);
  emit(run, "error-log", { message: entry });
}

function formatLogLine(message) {
  return `[${new Date().toLocaleTimeString("zh-CN", { hour12: false })}] ${message}`;
}

function emit(run, event, payload) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of run.clients) client.write(frame);
}

function attachEventStream(run, response) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  run.clients.add(response);
  response.write(`event: snapshot\ndata: ${JSON.stringify(snapshotRun(run))}\n\n`);
}

function snapshotRun(run) {
  return {
    id: run.id,
    status: run.status,
    commitMessage: run.commitMessage,
    branch: run.branch,
    remote: run.remote,
    logs: run.logs,
    errors: run.errors,
    changes: run.changes,
    createdAt: run.createdAt,
    finishedAt: run.finishedAt,
  };
}

function serveStatic(pathname, response) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const relativePath = safePath.replace(/^\/+/, "");
  const filePath = resolve(join(scriptDir, relativePath));
  if (!filePath.startsWith(scriptDir) || !existsSync(filePath)) {
    sendJson(response, 404, { error: "Not found." });
    return;
  }
  response.writeHead(200, {
    "Content-Type": contentTypes.get(extname(filePath)) ?? "application/octet-stream",
    "Cache-Control": "no-store",
  });
  createReadStream(filePath).pipe(response);
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function readJsonBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk.toString();
      if (raw.length > 10_000) {
        rejectBody(new Error("Request body is too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!raw.trim()) {
        resolveBody({});
        return;
      }
      try {
        resolveBody(JSON.parse(raw));
      } catch {
        rejectBody(new Error("Invalid JSON body."));
      }
    });
  });
}

function listenWithFallback(port) {
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && port < END_PORT) {
      listenWithFallback(port + 1);
      return;
    }
    throw error;
  });
  server.listen(port, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${port}/`;
    console.log(`GitHub push console running at ${url}`);
    console.log("Close this window to stop the local push server.");
    if (shouldOpen) openBrowserOnce(url);
  });
}

async function findExistingConsoleUrl() {
  for (let port = START_PORT; port <= END_PORT; port += 1) {
    const url = `http://127.0.0.1:${port}`;
    try {
      const response = await fetch(`${url}/api/health`, {
        signal: AbortSignal.timeout(300),
      });
      if (response.ok && (await response.json()).app === "image-splitter-push-console") {
        return `${url}/`;
      }
    } catch {
      // Fall back to probing the page for older push console servers.
    }

    try {
      const response = await fetch(`${url}/`, {
        signal: AbortSignal.timeout(300),
      });
      if (!response.ok) continue;
      const html = await response.text();
      if (html.includes("<title>GitHub 推送控制台</title>")) {
        return `${url}/`;
      }
    } catch {
      // Port is unused or belongs to another service.
    }
  }
  return null;
}

function openBrowserOnce(url) {
  if (browserOpened) return;
  browserOpened = true;
  openBrowser(url);
}

function openBrowser(url) {
  const opener = process.platform === "win32"
    ? spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" })
    : process.platform === "darwin"
      ? spawn("open", [url], { detached: true, stdio: "ignore" })
      : spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
  opener.unref();
}

function resolveExecutable(command, args) {
  if (process.platform !== "win32") {
    return { command, args, shell: false };
  }

  const lowerCommand = command.toLowerCase();
  if (lowerCommand === "git") {
    return { command: "git.exe", args, shell: false };
  }

  if (lowerCommand === "npm" || lowerCommand === "npx") {
    const npmCli = join(
      dirname(process.execPath),
      "node_modules",
      "npm",
      "bin",
      lowerCommand === "npm" ? "npm-cli.js" : "npx-cli.js",
    );
    if (existsSync(npmCli)) {
      return { command: process.execPath, args: [npmCli, ...args], shell: false };
    }
    return { command: `${command}.cmd`, args, shell: true };
  }

  return { command, args, shell: false };
}

function formatCommand(command, args) {
  return [command, ...args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg))].join(" ");
}
