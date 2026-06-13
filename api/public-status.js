const { supabaseRequest } = require("./_supabase");

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
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=120, stale-while-revalidate=300");
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

module.exports = async function handler(req, res) {
  try {
    const url = new URL(req.url, "http://localhost");
    const businessDate = url.searchParams.get("businessDate") || todayKey();
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
        updatedAt: now.toISOString(),
      });
    }

    const [tickets, settingsRows] = await Promise.all([
      supabaseRequest(
        `tickets?business_date=eq.${businessDate}&select=actual_number,card_number,status,admitted_at&order=actual_number.asc`,
        { method: "GET" },
      ),
      supabaseRequest(
        `daily_settings?business_date=eq.${businessDate}&select=bootstrap_interval_minutes`,
        { method: "GET" },
      ),
    ]);
    const [settings] = settingsRows;
    const admitted = tickets.filter((ticket) => ticket.status === "admitted");
    const waiting = tickets.filter((ticket) => ticket.status === "waiting");
    const latestAdmitted = admitted
      .filter((ticket) => ticket.admitted_at)
      .sort((a, b) => new Date(b.admitted_at) - new Date(a.admitted_at))[0];
    const average = averageIntervalMinutes(tickets, settings);
    const tailReturnAt = estimateTailReturnDate(tickets, settings);
    const tailWaitMinutes = Math.max(0, Math.ceil((tailReturnAt.getTime() - Date.now()) / 60000));

    return json(res, 200, {
      businessDate,
      currentNumber: beforeOpening || afterClosing ? null : latestAdmitted?.card_number || null,
      isBeforeOpening: beforeOpening,
      isAfterClosing: afterClosing,
      waitingCount: waiting.length,
      tailWaitMinutes,
      tailReturnAt: tailReturnAt.toISOString(),
      averageIntervalMinutes: average,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return json(res, 500, { error: error.message });
  }
};
