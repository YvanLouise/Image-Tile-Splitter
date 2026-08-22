declare namespace JSX {
  interface IntrinsicElements {
    [elementName: string]: any;
  }
}

declare namespace React {
  interface PointerEvent<T = Element> {
    button: number;
    clientX: number;
    clientY: number;
    ctrlKey: boolean;
    metaKey: boolean;
    pointerId: number;
    pointerType: string;
    currentTarget: T;
    preventDefault(): void;
  }

  interface DragEvent<T = Element> {
    preventDefault(): void;
    stopPropagation(): void;
    dataTransfer: DataTransfer;
    currentTarget: T;
  }
}

declare module "react" {
  export type ComponentType<P = Record<string, unknown>> = (props: P) => any;

  export function useEffect(
    effect: () => void | (() => void),
    deps?: readonly unknown[],
  ): void;

  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;

  export function useRef<T>(initialValue: T): { current: T };

  export function useReducer<R extends (state: any, action: any) => any, I>(
    reducer: R,
    initialArg: I,
  ): [I, (action: Parameters<R>[1]) => void];

  export function useState<T>(
    initialValue: T | (() => T),
  ): [T, (value: T | ((previous: T) => T)) => void];

  export const StrictMode: ComponentType<{ children?: any }>;
}

declare module "react-dom/client" {
  export function createRoot(container: Element): {
    render(children: any): void;
  };
}

declare module "react/jsx-runtime" {
  export const Fragment: any;
  export const jsx: any;
  export const jsxs: any;
}

declare module "opencv.js" {
  const cv: any;
  export default cv;
}
