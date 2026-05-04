type OpenCvRuntime = Record<string, any> & {
  onRuntimeInitialized?: () => void;
};

declare global {
  interface Window {
    cv?: OpenCvRuntime;
  }
}

let openCvPromise: Promise<OpenCvRuntime> | null = null;

export async function loadOpenCv(): Promise<OpenCvRuntime> {
  if (!openCvPromise) openCvPromise = injectOpenCvScript();
  return openCvPromise;
}

async function injectOpenCvScript(): Promise<OpenCvRuntime> {
  if (window.cv?.Mat) return window.cv;

  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-opencv-js]");
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("opencv.js script failed to load")), {
        once: true,
      });
      return;
    }

    const script = document.createElement("script");
    script.src = `${import.meta.env.BASE_URL}opencv.js`;
    script.async = true;
    script.dataset.opencvJs = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("opencv.js asset is missing"));
    document.head.appendChild(script);
  });

  const cv = window.cv;
  if (!cv) throw new Error("OpenCV runtime did not register window.cv");
  return waitForRuntime(cv);
}

async function waitForRuntime(cv: OpenCvRuntime): Promise<OpenCvRuntime> {
  if (cv.Mat && cv.matFromImageData) return cv;

  await new Promise<void>((resolve) => {
    const previous = cv.onRuntimeInitialized;
    cv.onRuntimeInitialized = () => {
      previous?.();
      resolve();
    };
    window.setTimeout(resolve, 8000);
  });

  if (!cv.Mat || !cv.matFromImageData) {
    throw new Error("OpenCV runtime was not initialized");
  }

  return cv;
}
