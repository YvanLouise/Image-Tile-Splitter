export type VisitCounterState =
  | { status: "loading" }
  | { status: "disabled" }
  | { status: "ready"; uniqueVisitors: number }
  | { status: "error" };

interface VisitCounterResponse {
  uniqueVisitors?: number;
}

export async function registerVisit(): Promise<VisitCounterState> {
  const endpoint = import.meta.env.VITE_VISIT_COUNTER_ENDPOINT as string | undefined;
  if (!endpoint) return { status: "disabled" };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "visit" }),
      credentials: "omit",
    });
    if (!response.ok) return { status: "error" };

    const payload = (await response.json()) as VisitCounterResponse;
    if (typeof payload.uniqueVisitors !== "number") return { status: "error" };

    return {
      status: "ready",
      uniqueVisitors: payload.uniqueVisitors,
    };
  } catch {
    return { status: "error" };
  }
}
