import { describe, expect, it, vi } from "vitest";
import {
  fetchDeployedVersion,
  getVersionMetadataUrl,
  getVersionedReloadUrl,
} from "./appUpdate";

describe("app update URLs", () => {
  it("keeps the GitHub Pages repository path and bypasses metadata caches", () => {
    expect(
      getVersionMetadataUrl(
        "https://example.github.io/Image-Tile-Splitter/?version=old",
        123,
      ),
    ).toBe("https://example.github.io/Image-Tile-Splitter/version.json?_=123");
  });

  it("does not reload when the deployed version is unchanged or invalid", () => {
    expect(getVersionedReloadUrl("https://example.test/app/", "abc", "abc")).toBeNull();
    expect(getVersionedReloadUrl("https://example.test/app/", "abc", null)).toBeNull();
  });

  it("adds a bounded cache-busting version to the current page URL", () => {
    expect(
      getVersionedReloadUrl(
        "https://example.github.io/Image-Tile-Splitter/?language=zh",
        "old",
        "1234567890abcdef",
      ),
    ).toBe(
      "https://example.github.io/Image-Tile-Splitter/?language=zh&version=1234567890ab",
    );
  });

  it("bypasses browser and intermediary caches when fetching the deployed version", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ version: " next-version " }), { status: 200 }),
    );

    await expect(
      fetchDeployedVersion("https://example.test/app/", fetcher, 456),
    ).resolves.toBe("next-version");
    expect(fetcher).toHaveBeenCalledWith(
      "https://example.test/app/version.json?_=456",
      expect.objectContaining({
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("aborts a stuck version request so later checks are not blocked", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("The operation was aborted", "AbortError")),
        );
      }),
    );

    const request = fetchDeployedVersion(
      "https://example.test/app/",
      fetcher,
      789,
      50,
    );
    const rejection = expect(request).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(50);
    await rejection;
    vi.useRealTimers();
  });
});
