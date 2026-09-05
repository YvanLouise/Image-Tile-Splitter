const UPDATE_CHECK_INTERVAL_MS = 10_000;
const UPDATE_REQUEST_TIMEOUT_MS = 8_000;

interface VersionPayload {
  version?: unknown;
}

export function startAppUpdateMonitor() {
  const currentVersion = import.meta.env.VITE_APP_VERSION as string | undefined;
  if (!import.meta.env.PROD || !currentVersion || currentVersion === "local") return;
  const buildVersion = currentVersion;

  let checking = false;
  let stopped = false;
  let timeout: number | undefined;

  const scheduleNextCheck = () => {
    if (stopped) return;
    timeout = window.setTimeout(async () => {
      await checkForUpdate();
      scheduleNextCheck();
    }, UPDATE_CHECK_INTERVAL_MS);
  };

  async function checkForUpdate() {
    if (checking || stopped || document.visibilityState === "hidden") return;
    checking = true;
    try {
      const nextVersion = await fetchDeployedVersion(window.location.href);
      const nextUrl = getVersionedReloadUrl(
        window.location.href,
        buildVersion,
        nextVersion,
      );
      if (nextUrl) {
        stopped = true;
        if (timeout !== undefined) window.clearTimeout(timeout);
        window.location.replace(nextUrl);
      }
    } catch {
      // A failed update check must not affect the offline-first editor.
    } finally {
      checking = false;
    }
  }

  const checkWhenActive = () => {
    if (document.visibilityState === "visible") void checkForUpdate();
  };
  document.addEventListener("visibilitychange", checkWhenActive);
  window.addEventListener("focus", checkWhenActive);
  window.addEventListener("online", checkWhenActive);
  window.addEventListener("pageshow", checkWhenActive);
  void checkForUpdate().finally(scheduleNextCheck);

  return () => {
    stopped = true;
    if (timeout !== undefined) window.clearTimeout(timeout);
    document.removeEventListener("visibilitychange", checkWhenActive);
    window.removeEventListener("focus", checkWhenActive);
    window.removeEventListener("online", checkWhenActive);
    window.removeEventListener("pageshow", checkWhenActive);
  };
}

export async function fetchDeployedVersion(
  pageUrl: string,
  fetcher: typeof fetch = fetch,
  cacheBust = Date.now(),
  requestTimeoutMs = UPDATE_REQUEST_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetcher(getVersionMetadataUrl(pageUrl, cacheBust), {
      cache: "no-store",
      headers: {
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as VersionPayload;
    return typeof payload.version === "string" ? payload.version.trim() : null;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export function getVersionMetadataUrl(pageUrl: string, cacheBust = Date.now()) {
  const versionUrl = new URL("./version.json", pageUrl);
  versionUrl.searchParams.set("_", cacheBust.toString());
  return versionUrl.href;
}

export function getVersionedReloadUrl(
  pageUrl: string,
  currentVersion: string,
  nextVersion: unknown,
) {
  if (typeof nextVersion !== "string" || nextVersion === currentVersion) return null;
  const nextUrl = new URL(pageUrl);
  nextUrl.searchParams.set("version", nextVersion.slice(0, 12));
  return nextUrl.href;
}
