const { supabaseRequest } = require("./_supabase");
const { filterValue, requireBusinessDate } = require("./_validation");

const BOOTSTRAP_ADMITTED_COUNT = 15;
const BOOTSTRAP_INTERVAL_MINUTES = 1;
const OPEN_HOUR = 9;
const OPEN_MINUTE = 0;
const CLOSE_HOUR = 17;
const CLOSE_MINUTE = 0;
const OPENING_BATCH_SIZE = 7;
const FIRST_AFTER_OPEN_WAIT_MINUTES = 15;

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
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60");
  res.end(JSON.stringify(body));
}

function bootstrapIntervalMinutes(settings) {
  const interval = Number(settings?.bootstrap_interval_minutes || BOOTSTRAP_INTERVAL_MINUTES);
  return Number.isFinite(interval) && interval > 0 ? interval : BOOTSTRAP_INTERVAL_MINUTES;
}

function averageIntervalMinutes(tickets, settings) {
  const admitted = tickets
    .filter((ticket) => ticket.status === "admitted" && ticket.admitted_at)
    .sort((a, b) => new Date(a.admitted_at) - new Date(b.admitted_at));

  if (admitted.length < BOOTSTRAP_ADMITTED_COUNT) return bootstrapIntervalMinutes(settings);

  const recent = admitted.slice(-30);
  const intervals = [];
  for (let index = 1; index < recent.length; index += 1) {
    const previous = new Date(recent[index - 1].admitted_at).getTime();
    const current = new Date(recent[index].admitted_at).getTime();
    const minutes = (current - previous) / 60000;
    if (minutes > 0 && minutes <= 20) intervals.push(minutes);
  }
  if (intervals.length === 0) return bootstrapIntervalMinutes(settings);
  return intervals.reduce((sum, minutes) => sum + minutes, 0) / intervals.length;
}

function openDate(base = new Date()) {
  return new Date(`${todayKey(base)}T${String(OPEN_HOUR).padStart(2, "0")}:${String(OPEN_MINUTE).padStart(2, "0")}:00+09:00`);
}

function closeDate(base = new Date()) {
  return new Date(`${todayKey(base)}T${String(CLOSE_HOUR).padStart(2, "0")}:${String(CLOSE_MINUTE).padStart(2, "0")}:00+09:00`);
}

function isBeforeOpening(now = new Date()) {
  return now < openDate(now);
}

function isAfterClosing(now = new Date()) {
  return now >= closeDate(now);
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

function estimateTailReturnDate(tickets, settings, now = new Date()) {
  const waitingCount = tickets.filter((ticket) => ticket.status === "waiting").length;
  const admittedCount = tickets.filter((ticket) => ticket.status === "admitted" && ticket.admitted_at).length;
  const position = waitingCount + 1;
  const opening = openDate(now);
  const bootstrapInterval = bootstrapIntervalMinutes(settings);

  if (now < opening) {
    if (position <= OPENING_BATCH_SIZE) return opening;
    return addMinutes(opening, FIRST_AFTER_OPEN_WAIT_MINUTES + (position - OPENING_BATCH_SIZE - 1) * bootstrapInterval);
  }

  if (admittedCount < BOOTSTRAP_ADMITTED_COUNT) {
    const openSlots = Math.max(0, OPENING_BATCH_SIZE - admittedCount);
    if (position <= openSlots) return now;
    if (admittedCount < OPENING_BATCH_SIZE) {
      const afterOpeningPosition = position - openSlots;
      return addMinutes(now, FIRST_AFTER_OPEN_WAIT_MINUTES + Math.max(0, afterOpeningPosition - 1) * bootstrapInterval);
    }
    const firstPostOpeningSlot = addMinutes(opening, FIRST_AFTER_OPEN_WAIT_MINUTES);
    const base = now > firstPostOpeningSlot ? now : firstPostOpeningSlot;
    return addMinutes(base, Math.max(0, position - 1) * bootstrapInterval);
  }

  return addMinutes(now, position * averageIntervalMinutes(tickets, settings));
}

function currentProgressTicket(tickets) {
  return tickets
    .filter((ticket) => ["admitted", "no_show"].includes(ticket.status))
    .reduce((latest, ticket) => {
      if (!latest) return ticket;
      return Number(ticket.actual_number) > Number(latest.actual_number) ? ticket : latest;
    }, null);
}

function validDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function ticketStatusesByCard(tickets, settings, now = new Date()) {
  const sortedTickets = [...tickets].sort(
    (a, b) => Number(a.actual_number) - Number(b.actual_number),
  );
  const activeTickets = sortedTickets.filter((ticket) =>
    ["waiting", "no_show"].includes(ticket.status),
  );
  const waitingTickets = activeTickets.filter((ticket) => ticket.status === "waiting");
  const queueTickets = sortedTickets.filter((ticket) => ticket.status !== "canceled");
  const openingBatch = queueTickets.slice(0, OPENING_BATCH_SIZE);
  const openingBatchEnd = openingBatch.at(-1)?.actual_number ?? null;
  const progress = currentProgressTicket(sortedTickets);
  const progressNumber = progress ? Number(progress.actual_number) : null;
  const average = averageIntervalMinutes(sortedTickets, settings);
  const opening = openDate(now);
  const beforeOpening = now < opening;

  function openingReadyAt(actualNumber) {
    if (openingBatchEnd === null || actualNumber <= Number(openingBatchEnd)) return opening;
    const postOpeningPosition = waitingTickets.filter(
      (candidate) =>
        Number(candidate.actual_number) > Number(openingBatchEnd) &&
        Number(candidate.actual_number) <= actualNumber,
    ).length;
    return addMinutes(
      opening,
      FIRST_AFTER_OPEN_WAIT_MINUTES +
        Math.max(0, postOpeningPosition - 1) * bootstrapIntervalMinutes(settings),
    );
  }

  return Object.fromEntries(
    activeTickets.map((ticket) => {
      const actualNumber = Number(ticket.actual_number);
      const promisedAt = validDate(ticket.estimated_return_at);
      let estimatedReadyAt = null;

      if (ticket.status === "waiting") {
        if (beforeOpening) {
          estimatedReadyAt = promisedAt || openingReadyAt(actualNumber);
        } else if (progressNumber !== null && actualNumber <= progressNumber) {
          estimatedReadyAt = now;
        } else if (
          openingBatchEnd !== null &&
          (progressNumber === null || progressNumber < Number(openingBatchEnd))
        ) {
          if (actualNumber <= Number(openingBatchEnd)) {
            estimatedReadyAt = now;
          } else {
            estimatedReadyAt = openingReadyAt(actualNumber);
          }
        } else {
          const groupsUntilReady = waitingTickets.filter(
            (candidate) =>
              Number(candidate.actual_number) > (progressNumber ?? 0) &&
              Number(candidate.actual_number) <= actualNumber,
          ).length;
          estimatedReadyAt = addMinutes(now, groupsUntilReady * average);
        }
      }

      return [
        String(ticket.card_number),
        {
          status: ticket.status,
          promisedReturnAt: promisedAt?.toISOString() || null,
          estimatedReadyAt: estimatedReadyAt?.toISOString() || null,
        },
      ];
    }),
  );
}

module.exports = async function handler(req, res) {
  try {
    const url = new URL(req.url, "http://localhost");
    const businessDate = requireBusinessDate(url.searchParams.get("businessDate") || todayKey());
    const dateFilter = filterValue(businessDate);
    const now = new Date();
    const beforeOpening = isBeforeOpening(now);
    const afterClosing = isAfterClosing(now);

    if (afterClosing) {
      return json(res, 200, {
        businessDate,
        currentNumber: null,
        isBeforeOpening: false,
        isAfterClosing: true,
        waitingCount: 0,
        tailWaitMinutes: 0,
        tailReturnAt: closeDate(now).toISOString(),
        averageIntervalMinutes: BOOTSTRAP_INTERVAL_MINUTES,
        ticketsByCard: {},
        serverTime: now.toISOString(),
        updatedAt: now.toISOString(),
      });
    }

    const [tickets, settingsRows] = await Promise.all([
      supabaseRequest(
        `tickets?business_date=eq.${dateFilter}&select=actual_number,card_number,status,estimated_return_at,admitted_at&order=actual_number.asc`,
        { method: "GET" },
      ),
      supabaseRequest(
        `daily_settings?business_date=eq.${dateFilter}&select=bootstrap_interval_minutes`,
        { method: "GET" },
      ),
    ]);
    const [settings] = settingsRows;
    const waiting = tickets.filter((ticket) => ticket.status === "waiting");
    const currentProgress = currentProgressTicket(tickets);
    const average = averageIntervalMinutes(tickets, settings);
    const tailReturnAt = estimateTailReturnDate(tickets, settings);
    const tailWaitMinutes = Math.max(0, Math.ceil((tailReturnAt.getTime() - Date.now()) / 60000));
    const updatedAt = new Date();

    return json(res, 200, {
      businessDate,
      currentNumber: beforeOpening || afterClosing ? null : currentProgress?.card_number || null,
      isBeforeOpening: beforeOpening,
      isAfterClosing: afterClosing,
      waitingCount: waiting.length,
      tailWaitMinutes,
      tailReturnAt: tailReturnAt.toISOString(),
      averageIntervalMinutes: average,
      ticketsByCard: ticketStatusesByCard(tickets, settings, updatedAt),
      serverTime: updatedAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
    });
  } catch (error) {
    if (!error.statusCode || error.statusCode >= 500) console.error(error);
    return json(res, error.statusCode || 500, {
      error: error.statusCode && error.statusCode < 500 ? error.message : "Status is temporarily unavailable",
    });
  }
};

module.exports.currentProgressTicket = currentProgressTicket;
module.exports.ticketStatusesByCard = ticketStatusesByCard;
