import { buildSliceItem } from "./imageSegmentation";
import { defaultChromaKeyParams } from "./chromaKey";
import type { SegmentationState } from "../state/segmentationReducer";
import type {
  AppMode,
  ChromaKeyParams,
  ComicDetectionParams,
  LoadedImage,
  SegmentParams,
  SliceItem,
  ToolMode,
} from "../types";
import { blobToLoadedImage } from "../utils/canvas";

const DATABASE_NAME = "image-splitter-workspace";
const STORE_NAME = "sessions";
const SESSION_KEY = "current";
const VERSION = 1;

interface StoredImage {
  fileName: string;
  size: number;
  blob: Blob;
}

type StoredSliceItem = Omit<SliceItem, "previewUrl" | "exportUrl">;

interface StoredSession {
  version: 1;
  mode: AppMode;
  tool: ToolMode;
  params: SegmentParams;
  comicParams: ComicDetectionParams;
  chromaParams: ChromaKeyParams;
  zoom: number;
  pan: { x: number; y: number };
  includeMetadata: boolean;
  exportScope: "selected" | "all";
  segmentation: {
    source: StoredImage | null;
    originalMask: Uint8Array | null;
    edits: Int8Array | null;
    items: StoredSliceItem[];
    selectedIds: number[];
    status: string;
  };
  chromaSource: StoredImage | null;
}

export interface WorkspaceSnapshot {
  mode: AppMode;
  tool: ToolMode;
  params: SegmentParams;
  comicParams: ComicDetectionParams;
  chromaParams: ChromaKeyParams;
  zoom: number;
  pan: { x: number; y: number };
  includeMetadata: boolean;
  exportScope: "selected" | "all";
  segmentationState: SegmentationState;
  chromaSource: LoadedImage | null;
}

export interface RestoredWorkspace
  extends Omit<WorkspaceSnapshot, "segmentationState"> {
  segmentationState: Omit<SegmentationState, "undoStack" | "redoStack">;
}

export async function saveWorkspaceSnapshot(snapshot: WorkspaceSnapshot) {
  if (!("indexedDB" in globalThis)) return;
  const record: StoredSession = {
    version: VERSION,
    mode: snapshot.mode,
    tool: snapshot.tool,
    params: snapshot.params,
    comicParams: snapshot.comicParams,
    chromaParams: snapshot.chromaParams,
    zoom: snapshot.zoom,
    pan: snapshot.pan,
    includeMetadata: snapshot.includeMetadata,
    exportScope: snapshot.exportScope,
    segmentation: {
      source: storeImage(snapshot.segmentationState.source),
      originalMask: snapshot.segmentationState.originalMask,
      edits: snapshot.segmentationState.edits,
      items: snapshot.segmentationState.items.map(stripItemUrls),
      selectedIds: snapshot.segmentationState.selectedIds,
      status: snapshot.segmentationState.status,
    },
    chromaSource: storeImage(snapshot.chromaSource),
  };
  const database = await openDatabase();
  await requestToPromise(
    database
      .transaction(STORE_NAME, "readwrite")
      .objectStore(STORE_NAME)
      .put(record, SESSION_KEY),
  );
  database.close();
}

export async function loadWorkspaceSnapshot(): Promise<RestoredWorkspace | null> {
  if (!("indexedDB" in globalThis)) return null;
  try {
    const database = await openDatabase();
    const record = await requestToPromise<StoredSession | undefined>(
      database
        .transaction(STORE_NAME, "readonly")
        .objectStore(STORE_NAME)
        .get(SESSION_KEY),
    );
    database.close();
    if (!record || record.version !== VERSION) return null;

    const [source, chromaSource] = await Promise.all([
      restoreImage(record.segmentation.source),
      restoreImage(record.chromaSource),
    ]);
    const items = source
      ? record.segmentation.items.map((item) =>
          buildSliceItem(
            source.imageData,
            item.boundingBox,
            new Uint8Array(item.mask),
            item.pixelCount,
            {
              id: item.id,
              order: item.order,
              type: item.type,
              polygon: item.polygon,
              confidence: item.confidence,
              source: item.source,
            },
          ),
        )
      : [];

    return {
      mode: record.mode,
      tool: record.tool,
      params: record.params,
      comicParams: record.comicParams,
      chromaParams: normalizeStoredChromaParams(record.chromaParams),
      zoom: record.zoom,
      pan: record.pan,
      includeMetadata: record.includeMetadata,
      exportScope: record.exportScope,
      chromaSource,
      segmentationState: {
        source,
        originalMask: record.segmentation.originalMask
          ? new Uint8Array(record.segmentation.originalMask)
          : null,
        edits: record.segmentation.edits
          ? new Int8Array(record.segmentation.edits)
          : null,
        items,
        selectedIds: record.segmentation.selectedIds.filter((id) =>
          items.some((item) => item.id === id),
        ),
        status: record.segmentation.status,
      },
    };
  } catch {
    return null;
  }
}

function storeImage(source: LoadedImage | null): StoredImage | null {
  if (!source) return null;
  return {
    fileName: source.fileName,
    size: source.size,
    blob: source.blob,
  };
}

async function restoreImage(source: StoredImage | null) {
  if (!source) return null;
  return blobToLoadedImage(source.blob, source.fileName, source.size);
}

function stripItemUrls(item: SliceItem): StoredSliceItem {
  const { previewUrl: _previewUrl, exportUrl: _exportUrl, ...stored } = item;
  return stored;
}

function normalizeStoredChromaParams(params: Partial<ChromaKeyParams>): ChromaKeyParams {
  return {
    ...defaultChromaKeyParams,
    ...params,
    outerOnly: params.outerOnly ?? defaultChromaKeyParams.outerOnly,
    outerMode: params.outerMode ?? defaultChromaKeyParams.outerMode,
    samplePoint: params.samplePoint,
  };
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise<T = IDBValidKey>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
