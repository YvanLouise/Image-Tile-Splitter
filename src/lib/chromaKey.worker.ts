import { processChromaKey } from "./chromaKey";
import type { ChromaKeyParams } from "../types";

interface ChromaWorkerGlobalScope {
  onmessage: ((event: MessageEvent<ChromaWorkerRequest>) => void) | null;
  postMessage: (message: ChromaWorkerResponse, transfer?: Transferable[]) => void;
}

interface ChromaWorkerRequest {
  id: number;
  width: number;
  height: number;
  data: ArrayBuffer;
  params: ChromaKeyParams;
}

interface ChromaWorkerResponse {
  id: number;
  resultData?: ArrayBuffer;
  maskData?: ArrayBuffer;
  foregroundPixels?: number;
  totalPixels?: number;
  error?: string;
}

const workerScope = self as unknown as ChromaWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<ChromaWorkerRequest>) => {
  const { id, width, height, data, params } = event.data;
  try {
    const processed = processChromaKey(
      {
        width,
        height,
        data: new Uint8ClampedArray(data),
      },
      params,
    );
    const resultBuffer = processed.resultData.buffer as ArrayBuffer;
    const maskBuffer = processed.maskData.buffer as ArrayBuffer;
    const response: ChromaWorkerResponse = {
      id,
      resultData: resultBuffer,
      maskData: maskBuffer,
      foregroundPixels: processed.foregroundPixels,
      totalPixels: processed.totalPixels,
    };
    workerScope.postMessage(response, [resultBuffer, maskBuffer]);
  } catch (error) {
    const response: ChromaWorkerResponse = {
      id,
      error: error instanceof Error ? error.message : String(error),
    };
    workerScope.postMessage(response);
  }
};
