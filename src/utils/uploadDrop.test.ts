import { describe, expect, it } from "vitest";
import { getAcceptedImageFile, hasAcceptedImageDrag } from "./uploadDrop";

function file(name: string, type: string) {
  return { name, type } as File;
}

function dragTransfer(items: Array<{ kind: string; type: string }>) {
  return { items } as unknown as DataTransfer;
}

describe("upload drop helpers", () => {
  it("selects the first accepted image file", () => {
    const files = [
      file("notes.txt", "text/plain"),
      file("sprite.webp", "image/webp"),
      file("photo.jpg", "image/jpeg"),
    ];

    expect(getAcceptedImageFile(files)?.name).toBe("sprite.webp");
  });

  it("accepts common image extensions when browser type is empty", () => {
    expect(getAcceptedImageFile([file("asset.PNG", "")])?.name).toBe("asset.PNG");
  });

  it("rejects non-image drops", () => {
    expect(getAcceptedImageFile([file("archive.zip", "application/zip")])).toBeNull();
    expect(hasAcceptedImageDrag(dragTransfer([{ kind: "file", type: "application/zip" }]))).toBe(
      false,
    );
  });

  it("recognizes image drag items before files are dropped", () => {
    expect(hasAcceptedImageDrag(dragTransfer([{ kind: "file", type: "image/png" }]))).toBe(true);
  });
});
