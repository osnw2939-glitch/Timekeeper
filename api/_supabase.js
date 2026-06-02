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
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = body?.message || body?.hint || response.statusText;
    throw new Error(message);
  }
  return body;
}

module.exports = { supabaseRequest };
