const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function assertSupabaseEnv() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }
}

function supabaseRestUrl() {
  const baseUrl = SUPABASE_URL.replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  return `${baseUrl}/rest/v1`;
}

async function supabaseRequest(path, options = {}) {
  assertSupabaseEnv();
  const response = await fetch(`${supabaseRestUrl()}/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: text.slice(0, 500) };
    }
  }
  if (!response.ok) {
    const message = body?.message || body?.hint || response.statusText;
    const error = new Error(message);
    error.statusCode = response.status >= 400 && response.status < 500 ? response.status : 502;
    throw error;
  }
  return body;
}

async function supabaseRpc(functionName, payload = {}) {
  return supabaseRequest(`rpc/${functionName}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

module.exports = { supabaseRequest, supabaseRpc };
