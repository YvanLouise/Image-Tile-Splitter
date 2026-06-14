const DEFAULT_ALLOWED_METHODS = "GET,POST,OPTIONS";
const DEFAULT_ALLOWED_HEADERS = "Content-Type";

export default {
  async fetch(request, env) {
    const corsHeaders = buildCorsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "GET" && request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, corsHeaders);
    }

    if (!env.DB) {
      return json({ error: "D1 binding DB is missing" }, 500, corsHeaders);
    }

    const ip = getClientIp(request);
    if (!ip) {
      return json({ error: "Client IP unavailable" }, 400, corsHeaders);
    }

    const salt = env.VISIT_COUNTER_SALT || "change-this-salt";
    const ipHash = await sha256(`${salt}:${ip}`);

    await env.DB.prepare(
      "INSERT OR IGNORE INTO unique_visits (ip_hash, first_seen) VALUES (?, datetime('now'))",
    )
      .bind(ipHash)
      .run();

    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS uniqueVisitors FROM unique_visits",
    ).first();

    return json(
      {
        uniqueVisitors: Number(row?.uniqueVisitors ?? 0),
      },
      200,
      corsHeaders,
    );
  },
};

function getClientIp(request) {
  const cfIp = request.headers.get("CF-Connecting-IP");
  if (cfIp) return cfIp;
  const forwarded = request.headers.get("X-Forwarded-For");
  return forwarded?.split(",")[0]?.trim() || "";
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function buildCorsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowedOrigin = env.ALLOWED_ORIGIN || origin || "*";
  const responseOrigin = allowedOrigin === "*" ? "*" : allowedOrigin;

  return {
    "Access-Control-Allow-Origin": responseOrigin,
    "Access-Control-Allow-Methods": DEFAULT_ALLOWED_METHODS,
    "Access-Control-Allow-Headers": DEFAULT_ALLOWED_HEADERS,
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  };
}

function json(payload, status, headers) {
  return new Response(JSON.stringify(payload), {
    status,
    headers,
  });
}
