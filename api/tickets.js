const { supabaseRequest, supabaseRpc } = require("./_supabase");
const { requireAdmin } = require("./_auth");
const { randomUUID } = require("node:crypto");
const {
  filterValue,
  httpError,
  optionalTimestamp,
  readJson,
  requireBusinessDate,
  requireUuid,
} = require("./_validation");

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

async function listTickets(businessDate) {
  const query = `tickets?business_date=eq.${filterValue(businessDate)}&order=actual_number.asc`;
  return supabaseRequest(query, { method: "GET" });
}

async function getOrCreateSettings(businessDate) {
  const dateFilter = filterValue(businessDate);
  const existing = await supabaseRequest(`daily_settings?business_date=eq.${dateFilter}`, {
    method: "GET",
  });
  if (existing[0]) return existing[0];

  const [created] = await supabaseRequest("daily_settings", {
    method: "POST",
    body: JSON.stringify({ business_date: businessDate }),
  });
  return created;
}

async function issueTicket(businessDate, estimatedReturnAt, ticketId) {
  try {
    return await supabaseRpc("issue_ticket_v2", {
      p_business_date: businessDate,
      p_estimated_return_at: estimatedReturnAt || null,
      p_ticket_id: ticketId,
    });
  } catch (error) {
    // Keep deployments working until the v2 RPC has been applied in Supabase.
    if (error.statusCode !== 404) throw error;
    return supabaseRpc("issue_ticket", {
      p_business_date: businessDate,
      p_estimated_return_at: estimatedReturnAt || null,
    });
  }
}

async function skipCard(businessDate, cardNumber) {
  const settings = await getOrCreateSettings(businessDate);
  const cardCount = settings.card_count || 300;
  if (!Number.isInteger(cardNumber) || cardNumber < 1 || cardNumber > cardCount) {
    throw httpError(400, `cardNumber must be between 1 and ${cardCount}`);
  }
  const skipped = new Set(settings.skipped_card_numbers || []);
  skipped.add(cardNumber);
  const patch = { skipped_card_numbers: [...skipped].sort((a, b) => a - b) };
  if (settings.next_card_number === cardNumber) {
    patch.next_card_number = ((cardNumber) % cardCount) + 1;
  }
  const [updated] = await supabaseRequest(`daily_settings?business_date=eq.${filterValue(businessDate)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return updated;
}

async function updateTicket(id, businessDate, allowedStatuses, patch) {
  const statusFilter = allowedStatuses.join(",");
  const [ticket] = await supabaseRequest(
    `tickets?id=eq.${filterValue(id)}&business_date=eq.${filterValue(businessDate)}&status=in.(${statusFilter})`,
    {
    method: "PATCH",
    body: JSON.stringify(patch),
    },
  );
  if (!ticket) {
    throw httpError(409, "This ticket was already changed. Refresh and try again.");
  }
  return ticket;
}

async function resetBusinessDate(businessDate) {
  const closedAt = new Date().toISOString();
  await supabaseRequest(
    `tickets?business_date=eq.${filterValue(businessDate)}&status=in.(waiting,no_show)`,
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        status: "canceled",
        canceled_at: closedAt,
      }),
    },
  );
  await getOrCreateSettings(businessDate);
  const [settings] = await supabaseRequest(`daily_settings?business_date=eq.${filterValue(businessDate)}`, {
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
    requireAdmin(req);
    const businessDate = requireBusinessDate(url.searchParams.get("businessDate") || todayKey());

    if (req.method === "GET") {
      return json(res, 200, { tickets: await listTickets(businessDate) });
    }

    if (req.method === "POST") {
      const body = await readJson(req);
      if (body.action === "issue") {
        const estimatedReturnAt = optionalTimestamp(body.estimatedReturnAt, "estimatedReturnAt");
        const ticketId = requireUuid(body.requestId || randomUUID(), "requestId");
        return json(res, 201, await issueTicket(businessDate, estimatedReturnAt, ticketId));
      }
      if (body.action === "skip_card") {
        return json(res, 200, { settings: await skipCard(businessDate, Number(body.cardNumber)) });
      }
      if (body.action === "reset") {
        return json(res, 200, { settings: await resetBusinessDate(businessDate) });
      }
      if (body.action === "admit") {
        const id = requireUuid(body.id);
        return json(res, 200, {
          ticket: await updateTicket(id, businessDate, ["waiting", "no_show"], {
            status: "admitted",
            admitted_at: new Date().toISOString(),
            card_recovered_at: new Date().toISOString(),
          }),
        });
      }
      if (body.action === "no_show") {
        const id = requireUuid(body.id);
        return json(res, 200, {
          ticket: await updateTicket(id, businessDate, ["waiting"], {
            status: "no_show",
            no_show_at: new Date().toISOString(),
          }),
        });
      }
      if (body.action === "cancel") {
        const id = requireUuid(body.id);
        return json(res, 200, {
          ticket: await updateTicket(id, businessDate, ["waiting", "no_show"], {
            status: "canceled",
            canceled_at: new Date().toISOString(),
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
