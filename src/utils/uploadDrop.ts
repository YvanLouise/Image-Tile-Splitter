const acceptedImageTypes = new Set(["image/png", "image/webp", "image/jpeg"]);

export function getAcceptedImageFile(files: FileList | File[]): File | null {
  return Array.from(files).find(isAcceptedImageFile) ?? null;
}

export function hasAcceptedImageDrag(dataTransfer: DataTransfer) {
  const items = Array.from(dataTransfer.items);
  if (items.length === 0) return true;
  return items.some((item) => {
    if (item.kind !== "file") return false;
    return item.type === "" || acceptedImageTypes.has(item.type);
  });
}

function isAcceptedImageFile(file: File) {
  if (acceptedImageTypes.has(file.type)) return true;
  return /\.(png|webp|jpe?g)$/i.test(file.name);
}
