const { supabaseRequest } = require("./_supabase");

function todayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

module.exports = async function handler(req, res) {
  try {
    const url = new URL(req.url, "http://localhost");
    const businessDate = url.searchParams.get("businessDate") || todayKey();

    if (req.method === "GET") {
      const settings = await supabaseRequest(`daily_settings?business_date=eq.${businessDate}`, {
        method: "GET",
      });
      return json(res, 200, { settings: settings[0] || null });
    }

    if (req.method === "POST") {
      const body = await readJson(req);
      const patch = {};
      if (body.cardCount !== undefined) patch.card_count = Number(body.cardCount);
      if (body.initialPaceMinutes !== undefined) {
        patch.bootstrap_interval_minutes = Number(body.initialPaceMinutes);
      }

      if (patch.card_count !== undefined && (!Number.isInteger(patch.card_count) || patch.card_count < 1)) {
        return json(res, 400, { error: "cardCount must be a positive integer" });
      }
      if (
        patch.bootstrap_interval_minutes !== undefined &&
        (!Number.isFinite(patch.bootstrap_interval_minutes) || patch.bootstrap_interval_minutes <= 0)
      ) {
        return json(res, 400, { error: "initialPaceMinutes must be positive" });
      }

      const existing = await supabaseRequest(`daily_settings?business_date=eq.${businessDate}`, {
        method: "GET",
      });
      if (existing[0]) {
        const [settings] = await supabaseRequest(`daily_settings?business_date=eq.${businessDate}`, {
          method: "PATCH",
          body: JSON.stringify(patch),
        });
        return json(res, 200, { settings });
      }

      const [settings] = await supabaseRequest("daily_settings", {
        method: "POST",
        body: JSON.stringify({ business_date: businessDate, ...patch }),
      });
      return json(res, 201, { settings });
    }

    return json(res, 405, { error: "Method not allowed" });
  } catch (error) {
    return json(res, 500, { error: error.message });
  }
};
