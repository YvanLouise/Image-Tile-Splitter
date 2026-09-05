import { describe, expect, it } from "vitest";
import { getVersionMetadataUrl, getVersionedReloadUrl } from "./appUpdate";

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
});