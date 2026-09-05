const UPDATE_CHECK_INTERVAL_MS = 30_000;

interface VersionPayload {
  version?: unknown;
}

export function startAppUpdateMonitor() {
  const currentVersion = import.meta.env.VITE_APP_VERSION as string | undefined;
  if (!import.meta.env.PROD || !currentVersion || currentVersion === "local") return;
  const buildVersion = currentVersion;

  let checking = false;
  let stopped = false;

  async function checkForUpdate() {
    if (checking || stopped || document.visibilityState === "hidden") return;
    checking = true;
    try {
      const versionUrl = getVersionMetadataUrl(window.location.href);
      const response = await fetch(versionUrl, { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as VersionPayload;
      const nextUrl = getVersionedReloadUrl(
        window.location.href,
        buildVersion,
        payload.version,
      );
      if (nextUrl) window.location.replace(nextUrl);
    } catch {
      // A failed update check must not affect the offline-first editor.
    } finally {
      checking = false;
    }
  }

  const interval = window.setInterval(() => void checkForUpdate(), UPDATE_CHECK_INTERVAL_MS);
  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible") void checkForUpdate();
  };
  document.addEventListener("visibilitychange", handleVisibilityChange);
  void checkForUpdate();

  return () => {
    stopped = true;
    window.clearInterval(interval);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  };
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
