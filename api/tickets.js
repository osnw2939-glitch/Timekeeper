const { supabaseRequest } = require("./_supabase");
const { requireAdmin } = require("./_auth");

const DEFAULT_CARD_LIMIT = 300;

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

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function listTickets(businessDate) {
  const query = `tickets?business_date=eq.${businessDate}&order=actual_number.asc`;
  return supabaseRequest(query, { method: "GET" });
}

async function getOrCreateSettings(businessDate) {
  const existing = await supabaseRequest(`daily_settings?business_date=eq.${businessDate}`, {
    method: "GET",
  });
  if (existing[0]) return existing[0];

  const [created] = await supabaseRequest("daily_settings", {
    method: "POST",
    body: JSON.stringify({ business_date: businessDate }),
  });
  return created;
}

function normalizeCardNumber(number, cardCount) {
  return ((number - 1) % cardCount) + 1;
}

function nextCardNumber(tickets, settings) {
  const cardCount = settings.card_count || DEFAULT_CARD_LIMIT;
  const skipped = new Set(settings.skipped_card_numbers || []);
  const unavailable = new Set(
    tickets
      .filter((ticket) => ticket.status !== "canceled" && !ticket.card_recovered_at)
      .map((ticket) => ticket.card_number),
  );
  const start = settings.next_card_number || 1;
  for (let offset = 0; offset < cardCount; offset += 1) {
    const number = normalizeCardNumber(start + offset, cardCount);
    if (!unavailable.has(number) && !skipped.has(number)) return number;
  }
  return null;
}

async function issueTicket(businessDate, estimatedReturnAt) {
  const tickets = await listTickets(businessDate);
  const settings = await getOrCreateSettings(businessDate);
  const maxNumber = tickets.reduce((max, ticket) => Math.max(max, ticket.actual_number), 0);
  const cardNumber = nextCardNumber(tickets, settings);
  if (!cardNumber) throw new Error("No reusable card is available");

  const [ticket] = await supabaseRequest("tickets", {
    method: "POST",
    body: JSON.stringify({
      business_date: businessDate,
      actual_number: maxNumber + 1,
      card_number: cardNumber,
      status: "waiting",
      estimated_return_at: estimatedReturnAt || null,
    }),
  });
  await supabaseRequest(`daily_settings?business_date=eq.${businessDate}`, {
    method: "PATCH",
    body: JSON.stringify({
      next_card_number: normalizeCardNumber(cardNumber + 1, settings.card_count || DEFAULT_CARD_LIMIT),
    }),
  });
  return ticket;
}

async function skipCard(businessDate, cardNumber) {
  const settings = await getOrCreateSettings(businessDate);
  const cardCount = settings.card_count || DEFAULT_CARD_LIMIT;
  if (!Number.isInteger(cardNumber) || cardNumber < 1 || cardNumber > cardCount) {
    throw new Error(`cardNumber must be between 1 and ${cardCount}`);
  }
  const skipped = new Set(settings.skipped_card_numbers || []);
  skipped.add(cardNumber);
  const patch = { skipped_card_numbers: [...skipped].sort((a, b) => a - b) };
  if (settings.next_card_number === cardNumber) {
    patch.next_card_number = normalizeCardNumber(cardNumber + 1, cardCount);
  }
  const [updated] = await supabaseRequest(`daily_settings?business_date=eq.${businessDate}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return updated;
}

async function updateTicket(id, patch) {
  const [ticket] = await supabaseRequest(`tickets?id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return ticket;
}

async function resetBusinessDate(businessDate) {
  await supabaseRequest(`tickets?business_date=eq.${businessDate}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  await getOrCreateSettings(businessDate);
  const [settings] = await supabaseRequest(`daily_settings?business_date=eq.${businessDate}`, {
    method: "PATCH",
    body: JSON.stringify({
      next_card_number: 1,
      skipped_card_numbers: [],
    }),
  });
  return settings;
}

module.exports = async function handler(req, res) {
  try {
    const url = new URL(req.url, "http://localhost");
    const businessDate = url.searchParams.get("businessDate") || todayKey();
    requireAdmin(req);

    if (req.method === "GET") {
      return json(res, 200, { tickets: await listTickets(businessDate) });
    }

    if (req.method === "POST") {
      const body = await readJson(req);
      if (body.action === "issue") {
        return json(res, 201, { ticket: await issueTicket(businessDate, body.estimatedReturnAt) });
      }
      if (body.action === "skip_card") {
        return json(res, 200, { settings: await skipCard(businessDate, Number(body.cardNumber)) });
      }
      if (body.action === "reset") {
        return json(res, 200, { settings: await resetBusinessDate(businessDate) });
      }
      if (body.action === "admit") {
        return json(res, 200, {
          ticket: await updateTicket(body.id, {
            status: "admitted",
            admitted_at: new Date().toISOString(),
            card_recovered_at: new Date().toISOString(),
          }),
        });
      }
      if (body.action === "no_show") {
        return json(res, 200, {
          ticket: await updateTicket(body.id, {
            status: "no_show",
            no_show_at: new Date().toISOString(),
          }),
        });
      }
      if (body.action === "cancel") {
        return json(res, 200, {
          ticket: await updateTicket(body.id, {
            status: "canceled",
            canceled_at: new Date().toISOString(),
            card_recovered_at: new Date().toISOString(),
          }),
        });
      }
      return json(res, 400, { error: "Unknown action" });
    }

    return json(res, 405, { error: "Method not allowed" });
  } catch (error) {
    return json(res, error.statusCode || 500, { error: error.message });
  }
};
