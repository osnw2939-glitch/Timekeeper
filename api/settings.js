const { supabaseRequest } = require("./_supabase");
const { requireAdmin } = require("./_auth");
const { filterValue, readJson, requireBusinessDate } = require("./_validation");

function todayKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  try {
    const url = new URL(req.url, "http://localhost");
    requireAdmin(req);
    const businessDate = requireBusinessDate(url.searchParams.get("businessDate") || todayKey());
    const dateFilter = filterValue(businessDate);

    if (req.method === "GET") {
      const settings = await supabaseRequest(`daily_settings?business_date=eq.${dateFilter}`, {
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

      if (
        patch.card_count !== undefined &&
        (!Number.isInteger(patch.card_count) || patch.card_count < 1 || patch.card_count > 9999)
      ) {
        return json(res, 400, { error: "cardCount must be an integer between 1 and 9999" });
      }
      if (
        patch.bootstrap_interval_minutes !== undefined &&
        (!Number.isFinite(patch.bootstrap_interval_minutes) ||
          patch.bootstrap_interval_minutes < 0.1 ||
          patch.bootstrap_interval_minutes > 20)
      ) {
        return json(res, 400, { error: "initialPaceMinutes must be between 0.1 and 20" });
      }

      const [settings] = await supabaseRequest("daily_settings?on_conflict=business_date", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({ business_date: businessDate, ...patch }),
      });
      return json(res, 200, { settings });
    }

    return json(res, 405, { error: "Method not allowed" });
  } catch (error) {
    return json(res, error.statusCode || 500, { error: error.message });
  }
};
