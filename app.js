const DEFAULT_CARD_LIMIT = 300;
const OPEN_HOUR = 9;
const OPEN_MINUTE = 0;
const CLOSE_HOUR = 17;
const CLOSE_MINUTE = 0;
const OPENING_BATCH_SIZE = 7;
const FIRST_AFTER_OPEN_WAIT_MINUTES = 15;
const BOOTSTRAP_ADMITTED_COUNT = 15;
const DEFAULT_BOOTSTRAP_INTERVAL_MINUTES = 1;
const STORAGE_KEY = "ticket-board-v5";
const ADMIN_TOKEN_STORAGE_KEY = "ticket-board-admin-token";
const PENDING_ISSUE_STORAGE_KEY = "ticket-board-pending-issue";

let selectedTicketId = null;
let usingRemoteApi = false;
let adminLocked = false;
let operationBusy = false;

const initialState = () => ({
  businessDate: todayKey(),
  nextActualNumber: 1,
  nextCardNumber: 1,
  skippedCardNumbers: [],
  settings: {
    cardCount: DEFAULT_CARD_LIMIT,
    bootstrapIntervalMinutes: DEFAULT_BOOTSTRAP_INTERVAL_MINUTES,
  },
  tickets: [],
  lastIssuedId: null,
});

let state = canUseRemoteApi() ? initialState() : loadLocalState();

const elements = {
  todayLabel: document.querySelector("#todayLabel"),
  issueButton: document.querySelector("#issueButton"),
  nextActualLabel: document.querySelector("#nextActualLabel"),
  nextCardLabel: document.querySelector("#nextCardLabel"),
  tailWaitLabel: document.querySelector("#tailWaitLabel"),
  tailReturnLabel: document.querySelector("#tailReturnLabel"),
  noShowCountLabel: document.querySelector("#noShowCountLabel"),
  waitingCountLabel: document.querySelector("#waitingCountLabel"),
  averageIntervalLabel: document.querySelector("#averageIntervalLabel"),
  issuedCountLabel: document.querySelector("#issuedCountLabel"),
  lastIssuedPanel: document.querySelector("#lastIssuedPanel"),
  contentCard: document.querySelector("#contentCard"),
  tabButtons: document.querySelectorAll(".tab-button"),
  sideLinks: document.querySelectorAll("[data-nav]"),
  waitingView: document.querySelector("#waitingView"),
  noShowView: document.querySelector("#noShowView"),
  settingsView: document.querySelector("#settingsView"),
  waitingTableBody: document.querySelector("#waitingTableBody"),
  noShowTableBody: document.querySelector("#noShowTableBody"),
  actionPanel: document.querySelector("#actionPanel"),
  settingsForm: document.querySelector("#settingsForm"),
  cardCountInput: document.querySelector("#cardCountInput"),
  initialPaceInput: document.querySelector("#initialPaceInput"),
  resetButton: document.querySelector("#resetButton"),
  skipCardButton: document.querySelector("#skipCardButton"),
  resetDialog: document.querySelector("#resetDialog"),
  confirmResetButton: document.querySelector("#confirmResetButton"),
};

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

function loadLocalState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return initialState();

  try {
    const saved = JSON.parse(raw);
    if (saved.businessDate !== todayKey()) return initialState();
    const merged = { ...initialState(), ...saved };
    merged.settings = { ...initialState().settings, ...(saved.settings || {}) };
    if (!Array.isArray(saved.skippedCardNumbers)) merged.skippedCardNumbers = [];
    return merged;
  } catch {
    return initialState();
  }
}

function saveLocalState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function pendingIssueRequestId() {
  try {
    const pending = JSON.parse(localStorage.getItem(PENDING_ISSUE_STORAGE_KEY) || "null");
    if (pending?.businessDate === state.businessDate && pending?.requestId) return pending.requestId;
  } catch {
    // A damaged pending value is replaced below.
  }

  const requestId = crypto.randomUUID();
  localStorage.setItem(
    PENDING_ISSUE_STORAGE_KEY,
    JSON.stringify({ businessDate: state.businessDate, requestId }),
  );
  return requestId;
}

function clearPendingIssueRequest() {
  localStorage.removeItem(PENDING_ISSUE_STORAGE_KEY);
}

function canUseRemoteApi() {
  return window.location.protocol !== "file:";
}

function adminToken() {
  return localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) || "";
}

function ensureAdminToken(message = "管理用パスコードを入力してください") {
  if (adminToken()) return true;
  const token = window.prompt(message);
  if (!token) return false;
  localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token.trim());
  return true;
}

async function apiRequest(path, options = {}, retryAuth = true) {
  const token = adminToken();
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "X-Admin-Token": token } : {}),
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));

  if (response.status === 401 && retryAuth) {
    localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    if (ensureAdminToken("管理用パスコードが違います。もう一度入力してください")) {
      return apiRequest(path, options, false);
    }
  }

  if (response.status === 401) {
    localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    setAdminLocked(true, "管理用パスコードが違います。");
    throw new Error("管理用パスコードが違います。");
  }

  if (response.status === 503 && body.error === "ADMIN_TOKEN is required") {
    throw new Error("Vercelの環境変数 ADMIN_TOKEN が未設定です。");
  }

  if (!response.ok) {
    const error = new Error(body.error || "API request failed");
    error.statusCode = response.status;
    throw error;
  }
  return body;
}

async function syncFromApi() {
  if (!canUseRemoteApi()) throw new Error("file protocol");
  if (!ensureAdminToken()) throw new Error("管理用パスコードが未入力です。");

  const [ticketsResult, settingsResult] = await Promise.all([
    apiRequest(`/api/tickets?businessDate=${state.businessDate}`),
    apiRequest(`/api/settings?businessDate=${state.businessDate}`),
  ]);
  const tickets = (ticketsResult.tickets || []).map(fromDbTicket);
  const settings = fromDbSettings(settingsResult.settings);

  state = {
    ...state,
    businessDate: todayKey(),
    tickets,
    settings,
    skippedCardNumbers: settings.skippedCardNumbers,
    nextCardNumber: settings.nextCardNumber,
    nextActualNumber: tickets.reduce((max, ticket) => Math.max(max, ticket.actualNumber), 0) + 1,
  };
  setAdminLocked(false);
  saveLocalState();
}

async function handleOperationError(error) {
  if (error.statusCode === 409 && usingRemoteApi) {
    try {
      await syncFromApi();
      render();
      setNotice("ほかの操作で状態が変わったため、最新の表示に更新しました。", "warning");
      return;
    } catch {
      // Show the original conflict if refreshing also fails.
    }
  }
  setNotice(error.message, "warning");
}

function setAdminLocked(locked, message = "") {
  adminLocked = locked;
  [
    elements.issueButton,
    elements.skipCardButton,
    elements.resetButton,
    elements.confirmResetButton,
    elements.cardCountInput,
    elements.initialPaceInput,
  ].forEach((element) => {
    if (element) element.disabled = locked || operationBusy;
  });

  const submitButton = elements.settingsForm?.querySelector("button[type='submit']");
  if (submitButton) submitButton.disabled = locked || operationBusy;

  if (locked) {
    selectedTicketId = null;
    if (canUseRemoteApi()) {
      state = initialState();
      saveLocalState();
    }
    elements.actionPanel.innerHTML = `
      <div class="panel-empty">
        <strong>管理画面をロック中</strong>
        <span>${escapeHtml(message || "管理用パスコードを確認してください。")}</span>
      </div>
    `;
  }
}

function operationButtons() {
  return [
    elements.issueButton,
    elements.skipCardButton,
    elements.resetButton,
    elements.confirmResetButton,
    elements.settingsForm?.querySelector("button[type='submit']"),
    ...document.querySelectorAll(".row-action, .panel-action"),
  ].filter(Boolean);
}

function setOperationDisabled(disabled) {
  operationButtons().forEach((button) => {
    button.disabled = disabled || adminLocked;
  });
}

async function runOperation(button, task) {
  if (operationBusy || adminLocked) return;
  operationBusy = true;
  button?.classList.add("is-loading");
  button?.setAttribute("aria-busy", "true");
  setOperationDisabled(true);

  try {
    await task();
  } finally {
    operationBusy = false;
    button?.classList.remove("is-loading");
    button?.removeAttribute("aria-busy");
    setOperationDisabled(false);
    if (adminLocked) setAdminLocked(true);
  }
}

function fromDbTicket(ticket) {
  return {
    id: ticket.id,
    actualNumber: ticket.actual_number,
    cardNumber: ticket.card_number,
    status: ticket.status,
    issuedAt: ticket.issued_at,
    estimatedReturnAt: ticket.estimated_return_at,
    admittedAt: ticket.admitted_at,
    noShowAt: ticket.no_show_at,
    canceledAt: ticket.canceled_at,
    cardRecoveredAt: ticket.card_recovered_at,
  };
}

function fromDbSettings(settings) {
  return {
    cardCount: settings?.card_count || DEFAULT_CARD_LIMIT,
    bootstrapIntervalMinutes: Number(settings?.bootstrap_interval_minutes || DEFAULT_BOOTSTRAP_INTERVAL_MINUTES),
    nextCardNumber: settings?.next_card_number || 1,
    skippedCardNumbers: settings?.skipped_card_numbers || [],
  };
}

function recalculateNextActualNumber() {
  state.nextActualNumber = state.tickets.reduce((max, ticket) => Math.max(max, ticket.actualNumber), 0) + 1;
}

function upsertTicketFromDb(dbTicket) {
  const ticket = fromDbTicket(dbTicket);
  const index = state.tickets.findIndex((item) => item.id === ticket.id);
  if (index >= 0) {
    state.tickets[index] = ticket;
  } else {
    state.tickets.push(ticket);
  }
  state.tickets.sort((a, b) => a.actualNumber - b.actualNumber);
  recalculateNextActualNumber();
  return ticket;
}

function applySettingsFromDb(dbSettings) {
  if (!dbSettings) return;
  const settings = fromDbSettings(dbSettings);
  state.settings = settings;
  state.skippedCardNumbers = settings.skippedCardNumbers;
  state.nextCardNumber = settings.nextCardNumber;
}

function cardLimit() {
  return Math.max(1, Number(state.settings?.cardCount || DEFAULT_CARD_LIMIT));
}

function bootstrapIntervalMinutes() {
  return Math.max(0.1, Number(state.settings?.bootstrapIntervalMinutes || DEFAULT_BOOTSTRAP_INTERVAL_MINUTES));
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

function activeTickets() {
  return state.tickets.filter((ticket) => ticket.status !== "canceled");
}

function ticketsByStatus(status) {
  return state.tickets
    .filter((ticket) => ticket.status === status)
    .sort((a, b) => a.actualNumber - b.actualNumber);
}

function normalizeCardNumber(number, limit = cardLimit()) {
  return ((number - 1) % limit) + 1;
}

function findNextIssueCardNumber(start = state.nextCardNumber || 1) {
  const unavailable = new Set(
    activeTickets()
      .filter((ticket) => !ticket.cardRecoveredAt)
      .map((ticket) => ticket.cardNumber),
  );
  const skipped = new Set(state.skippedCardNumbers || []);

  for (let offset = 0; offset < cardLimit(); offset += 1) {
    const number = normalizeCardNumber(start + offset);
    if (!unavailable.has(number) && !skipped.has(number)) return number;
  }
  return null;
}

function peekNextCardNumber() {
  return findNextIssueCardNumber();
}

function takeNextCardNumber() {
  const cardNumber = findNextIssueCardNumber();
  if (!cardNumber) return null;
  state.nextCardNumber = normalizeCardNumber(cardNumber + 1);
  return cardNumber;
}

function admittedTickets() {
  return state.tickets
    .filter((ticket) => ticket.status === "admitted" && ticket.admittedAt)
    .sort((a, b) => new Date(a.admittedAt) - new Date(b.admittedAt));
}

function averageIntervalMinutes() {
  const admitted = admittedTickets();
  if (admitted.length < BOOTSTRAP_ADMITTED_COUNT) return bootstrapIntervalMinutes();

  const recent = admitted.slice(-30);
  const intervals = [];
  for (let index = 1; index < recent.length; index += 1) {
    const previous = new Date(recent[index - 1].admittedAt).getTime();
    const current = new Date(recent[index].admittedAt).getTime();
    const minutes = (current - previous) / 60000;
    if (minutes > 0 && minutes <= 20) intervals.push(minutes);
  }

  if (intervals.length === 0) return bootstrapIntervalMinutes();
  return Math.max(0.5, intervals.reduce((sum, minutes) => sum + minutes, 0) / intervals.length);
}

function sortedWaitingWith(ticket) {
  const waiting = ticketsByStatus("waiting");
  if (ticket && !waiting.some((item) => item.id === ticket.id)) waiting.push(ticket);
  return waiting.sort((a, b) => a.actualNumber - b.actualNumber);
}

function queuePosition(ticket) {
  return sortedWaitingWith(ticket).findIndex((item) => item.id === ticket.id) + 1;
}

function bootstrapReturnDate(position, now = new Date()) {
  const opening = openDate(now);
  if (position <= OPENING_BATCH_SIZE) return opening;
  return addMinutes(opening, FIRST_AFTER_OPEN_WAIT_MINUTES + (position - OPENING_BATCH_SIZE - 1) * bootstrapIntervalMinutes());
}

function estimateReturnDateForTicket(ticket, now = new Date()) {
  const admittedCount = admittedTickets().length;
  const position = Math.max(1, queuePosition(ticket));
  const opening = openDate(now);

  if (now < opening) return bootstrapReturnDate(position, now);

  if (admittedCount < BOOTSTRAP_ADMITTED_COUNT) {
    const openSlots = Math.max(0, OPENING_BATCH_SIZE - admittedCount);
    if (position <= openSlots) return now;

    if (admittedCount < OPENING_BATCH_SIZE) {
      const afterOpeningPosition = position - openSlots;
      return addMinutes(now, FIRST_AFTER_OPEN_WAIT_MINUTES + Math.max(0, afterOpeningPosition - 1) * bootstrapIntervalMinutes());
    }

    const firstPostOpeningSlot = addMinutes(opening, FIRST_AFTER_OPEN_WAIT_MINUTES);
    const base = now > firstPostOpeningSlot ? now : firstPostOpeningSlot;
    return addMinutes(base, Math.max(0, position - 1) * bootstrapIntervalMinutes());
  }

  return addMinutes(now, position * averageIntervalMinutes());
}

function estimateMinutesForTicket(ticket) {
  const minutes = (estimateReturnDateForTicket(ticket).getTime() - Date.now()) / 60000;
  return Math.max(0, Math.ceil(minutes));
}

function tailTicket() {
  return {
    id: "__tail__",
    actualNumber: state.nextActualNumber,
    cardNumber: peekNextCardNumber(),
    status: "waiting",
    issuedAt: new Date().toISOString(),
  };
}

function estimateTailReturnDate() {
  return estimateReturnDateForTicket(tailTicket());
}

function promisedReturnDate(ticket) {
  if (!ticket?.estimatedReturnAt) return null;
  const promised = new Date(ticket.estimatedReturnAt);
  return Number.isNaN(promised.getTime()) ? null : promised;
}

function latestPromisedReturnDate() {
  return state.tickets
    .filter((ticket) => ["waiting", "no_show"].includes(ticket.status))
    .reduce((latest, ticket) => {
      const promised = promisedReturnDate(ticket);
      return promised && (!latest || promised > latest) ? promised : latest;
    }, null);
}

function estimateNextIssueReturnDate() {
  const estimated = roundToFiveMinutes(estimateTailReturnDate());
  const previous = latestPromisedReturnDate();
  return previous && previous > estimated ? new Date(previous) : estimated;
}

function estimateTailMinutes() {
  const minutes = (estimateNextIssueReturnDate().getTime() - Date.now()) / 60000;
  return Math.max(0, Math.ceil(minutes));
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

function roundToFiveMinutes(date) {
  const rounded = new Date(date);
  const next = Math.ceil(rounded.getMinutes() / 5) * 5;
  rounded.setMinutes(next, 0, 0);
  return rounded;
}

function formatTime(value) {
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function returnTimeLabelForTicket(ticket) {
  return formatTime(promisedReturnDate(ticket) || roundToFiveMinutes(estimateReturnDateForTicket(ticket)));
}

function ticketTitle(ticket) {
  return `整理券${ticket.cardNumber}`;
}

async function issueTicket() {
  if (usingRemoteApi) {
    const estimatedReturnAt = estimateNextIssueReturnDate().toISOString();
    const requestId = pendingIssueRequestId();
    const result = await apiRequest(`/api/tickets?businessDate=${state.businessDate}`, {
      method: "POST",
      body: JSON.stringify({ action: "issue", estimatedReturnAt, requestId }),
    });
    if (!result.ticket || !result.settings) throw new Error("発券結果を確認できませんでした。もう一度お試しください。");
    const ticket = upsertTicketFromDb(result.ticket);
    applySettingsFromDb(result.settings);
    clearPendingIssueRequest();
    state.lastIssuedId = ticket.id;
    saveLocalState();
    render();
    setActiveView("waiting");
    return;
  }

  const cardNumber = takeNextCardNumber();
  if (!cardNumber) {
    setNotice("利用できるカード番号がありません。カード番号の飛ばし設定や未回収カードを確認してください。", "warning");
    return;
  }

  const ticket = {
    id: crypto.randomUUID(),
    actualNumber: state.nextActualNumber,
    cardNumber,
    status: "waiting",
    issuedAt: new Date().toISOString(),
  };
  ticket.estimatedReturnAt = estimateNextIssueReturnDate().toISOString();

  state.tickets.push(ticket);
  state.nextActualNumber += 1;
  state.lastIssuedId = ticket.id;
  saveLocalState();
  render();
  setActiveView("waiting");
}

async function admitTicket(id) {
  if (usingRemoteApi) {
    const result = await apiRequest(`/api/tickets?businessDate=${state.businessDate}`, {
      method: "POST",
      body: JSON.stringify({ action: "admit", id }),
    });
    upsertTicketFromDb(result.ticket);
    selectedTicketId = null;
    saveLocalState();
    render();
    return;
  }

  const ticket = findTicket(id);
  if (!ticket || !["waiting", "no_show"].includes(ticket.status)) return;
  ticket.status = "admitted";
  ticket.admittedAt = new Date().toISOString();
  ticket.cardRecoveredAt = new Date().toISOString();
  selectedTicketId = null;
  saveLocalState();
  render();
}

async function markNoShow(id) {
  const currentTicket = findTicket(id);
  if (!currentTicket || currentTicket.status !== "waiting") return;
  const promised = promisedReturnDate(currentTicket);
  if (promised && promised > new Date()) {
    setNotice(
      `整理券${currentTicket.cardNumber}には${formatTime(promised)}ごろと案内しています。その時刻までは不在にできません。`,
      "warning",
    );
    return;
  }

  if (usingRemoteApi) {
    const result = await apiRequest(`/api/tickets?businessDate=${state.businessDate}`, {
      method: "POST",
      body: JSON.stringify({ action: "no_show", id }),
    });
    upsertTicketFromDb(result.ticket);
    selectedTicketId = null;
    saveLocalState();
    render();
    return;
  }

  const ticket = findTicket(id);
  if (!ticket || ticket.status !== "waiting") return;
  ticket.status = "no_show";
  ticket.noShowAt = new Date().toISOString();
  selectedTicketId = null;
  saveLocalState();
  render();
}

async function cancelTicket(id) {
  const currentTicket = findTicket(id);
  if (!currentTicket || currentTicket.status === "admitted") return;
  const confirmed = window.confirm(
    `整理券${currentTicket.cardNumber}の呼び出しを取り消します。カードは回収済み扱いにならず、同じ営業日には再発券されません。よろしいですか？`,
  );
  if (!confirmed) return;

  if (usingRemoteApi) {
    const result = await apiRequest(`/api/tickets?businessDate=${state.businessDate}`, {
      method: "POST",
      body: JSON.stringify({ action: "cancel", id }),
    });
    upsertTicketFromDb(result.ticket);
    selectedTicketId = null;
    saveLocalState();
    render();
    return;
  }

  const ticket = findTicket(id);
  if (!ticket || ticket.status === "admitted") return;
  ticket.status = "canceled";
  ticket.canceledAt = new Date().toISOString();
  selectedTicketId = null;
  saveLocalState();
  render();
}

function findTicket(id) {
  return state.tickets.find((ticket) => ticket.id === id);
}

async function resetDay() {
  if (usingRemoteApi) {
    const result = await apiRequest(`/api/tickets?businessDate=${state.businessDate}`, {
      method: "POST",
      body: JSON.stringify({ action: "reset" }),
    });
    const canceledAt = new Date().toISOString();
    state.tickets = state.tickets.map((ticket) =>
      ["waiting", "no_show"].includes(ticket.status)
        ? { ...ticket, status: "canceled", canceledAt }
        : ticket,
    );
    applySettingsFromDb(result.settings);
    selectedTicketId = null;
    saveLocalState();
    render();
    return;
  }

  state = initialState();
  selectedTicketId = null;
  saveLocalState();
  render();
}

async function skipCardNumber() {
  const value = window.prompt("飛ばす整理券番号を入力してください");
  if (!value) return;

  const cardNumber = Number(value);
  if (!Number.isInteger(cardNumber) || cardNumber < 1 || cardNumber > cardLimit()) {
    setNotice(`1から${cardLimit()}までの整理券番号を入力してください。`, "warning");
    return;
  }

  if (usingRemoteApi) {
    const result = await apiRequest(`/api/tickets?businessDate=${state.businessDate}`, {
      method: "POST",
      body: JSON.stringify({ action: "skip_card", cardNumber }),
    });
    applySettingsFromDb(result.settings);
    saveLocalState();
    setNotice(`整理券${cardNumber}を発券対象から外しました。`);
    render();
    return;
  }

  const skipped = new Set(state.skippedCardNumbers || []);
  skipped.add(cardNumber);
  state.skippedCardNumbers = [...skipped].sort((a, b) => a - b);
  if (state.nextCardNumber === cardNumber) state.nextCardNumber = normalizeCardNumber(cardNumber + 1);
  saveLocalState();
  setNotice(`整理券${cardNumber}を発券対象から外しました。`);
  render();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setNotice(text, level = "normal") {
  elements.lastIssuedPanel.className = `notice-card ${level}`;
  elements.lastIssuedPanel.innerHTML = `
    <div class="notice-icon">i</div>
    <div>
      <span>お知らせ</span>
      <strong>${escapeHtml(text)}</strong>
    </div>
  `;
}

function render() {
  renderSummary();
  renderLastIssued();
  renderTables();
  renderActionPanel();
  renderSettingsForm();
}

function renderSummary() {
  const nextCard = peekNextCardNumber();
  const tailMinutes = estimateTailMinutes();
  const tailReturn = estimateNextIssueReturnDate();
  const noShows = ticketsByStatus("no_show");
  const waiting = ticketsByStatus("waiting");
  const average = averageIntervalMinutes();

  elements.todayLabel.textContent = new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "full",
  }).format(new Date());
  if (elements.nextActualLabel) elements.nextActualLabel.textContent = state.nextActualNumber;
  elements.nextCardLabel.textContent = nextCard ?? "--";
  elements.tailWaitLabel.textContent = isAfterClosing() ? "受付終了" : `${formatTime(tailReturn)}ごろ`;
  elements.tailReturnLabel.textContent = isAfterClosing()
    ? "本日の発券は終了"
    : isBeforeOpening()
      ? `開店後・整理券${nextCard ?? "--"}へ案内予定`
      : `あと約${tailMinutes}分・整理券${nextCard ?? "--"}へ案内予定`;
  elements.noShowCountLabel.textContent = `${noShows.length}件`;
  elements.waitingCountLabel.textContent = `${waiting.length}組`;
  elements.averageIntervalLabel.textContent =
    admittedTickets().length < BOOTSTRAP_ADMITTED_COUNT
      ? `初期 ${bootstrapIntervalMinutes().toFixed(1)}分/組`
      : `${average.toFixed(1)}分/組`;
  elements.issuedCountLabel.textContent = `${state.nextActualNumber - 1}枚`;
}

function renderLastIssued() {
  const ticket = findTicket(state.lastIssuedId);
  if (!ticket) return;

  const returnAt = ticket.estimatedReturnAt ? formatTime(ticket.estimatedReturnAt) : returnTimeLabelForTicket(ticket);
  elements.lastIssuedPanel.className = "notice-card";
  elements.lastIssuedPanel.innerHTML = `
    <div class="notice-icon">i</div>
    <div>
      <span>ひとつ前のご案内</span>
      <strong>${ticketTitle(ticket)}</strong>
      <em>お客さまには「${returnAt}ごろにお戻りください」と案内</em>
    </div>
  `;
}

function renderTables() {
  renderTicketRows(elements.waitingTableBody, ticketsByStatus("waiting"), "waiting");
  renderTicketRows(elements.noShowTableBody, ticketsByStatus("no_show"), "no_show");
}

function renderTicketRows(container, tickets, type) {
  if (tickets.length === 0) {
    const text = type === "waiting" ? "現在、待機中の番号はありません。" : "不在者はいません。";
    container.innerHTML = `<tr><td class="empty-row" colspan="5">${text}</td></tr>`;
    return;
  }

  container.innerHTML = tickets.map((ticket) => {
    const timeLabel = type === "waiting" ? `${returnTimeLabelForTicket(ticket)}ごろ` : formatTime(ticket.noShowAt);
    const statusLabel = type === "waiting" ? "待機中" : "不在";
    const subStatus = type === "waiting" ? "案内前" : "戻り待ち";
    const elapsed = elapsedMinutes(ticket.issuedAt);
    const selected = ticket.id === selectedTicketId ? "selected" : "";

    return `
      <tr class="${selected}">
        <td><span class="number-badge">${ticket.cardNumber}</span></td>
        <td><span class="time-cell">${timeLabel}</span></td>
        <td>
          <span class="status-pill ${type}">${statusLabel}</span>
          <span class="sub-status">${subStatus}</span>
        </td>
        <td>約${elapsed}分</td>
        <td>
          <button class="row-action ${selected ? "active" : ""}" data-ticket="${ticket.id}" type="button">
            ${selected ? "選択中" : "処理を選択"}
          </button>
        </td>
      </tr>
    `;
  }).join("");

  container.querySelectorAll("[data-ticket]").forEach((button) => {
    button.addEventListener("click", () => selectTicket(button.dataset.ticket));
  });
}

function elapsedMinutes(value) {
  return Math.max(0, Math.ceil((Date.now() - new Date(value).getTime()) / 60000));
}

function selectTicket(id) {
  const ticket = findTicket(id);
  if (!ticket) return;
  selectedTicketId = selectedTicketId === id ? null : id;
  renderTables();
  renderActionPanel();
}

function renderActionPanel() {
  if (adminLocked) {
    elements.actionPanel.innerHTML = `
      <div class="panel-empty">
        <strong>管理画面をロック中</strong>
        <span>管理用パスコードが正しく入力されるまで操作できません。</span>
      </div>
    `;
    return;
  }

  const ticket = findTicket(selectedTicketId);
  if (!ticket || !["waiting", "no_show"].includes(ticket.status)) {
    elements.actionPanel.innerHTML = `
      <div class="panel-empty">
        <strong>番号を選択</strong>
        <span>行の「処理を選択」から操作を選べます。</span>
      </div>
    `;
    return;
  }

  const isNoShow = ticket.status === "no_show";
  const promised = promisedReturnDate(ticket);
  const beforePromisedReturn = !isNoShow && promised && promised > new Date();
  elements.actionPanel.innerHTML = `
    <div class="panel-head">
      <span>選択中：整理券${ticket.cardNumber}</span>
      <strong>${isNoShow ? "不在者の処理" : "待機番号の処理"}</strong>
      <p>押し間違いを防ぐため、主要操作は右側に分離しています。</p>
    </div>
    <div class="panel-actions">
      <button class="panel-action positive" data-panel-action="admit" type="button">
        <span class="panel-action-icon">✓</span>
        <strong>来店として処理</strong>
        <small>${isNoShow ? "不在者タブから外します" : "待機一覧から外します"}</small>
      </button>
      ${
        isNoShow
          ? ""
          : `<button class="panel-action" data-panel-action="noshow" type="button">
              <span class="panel-action-icon">?</span>
              <strong>不在にする</strong>
              <small>${beforePromisedReturn ? `${formatTime(promised)}までは不在にできません` : "不在者タブへ移動"}</small>
            </button>`
      }
    </div>
    <div class="danger-zone">
      <button class="panel-action danger" data-panel-action="cancel" type="button">
        <span class="panel-action-icon">×</span>
        <strong>呼び出しを取り消す</strong>
        <small>この番号を取り消します</small>
      </button>
    </div>
  `;

  elements.actionPanel.querySelectorAll("[data-panel-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.panelAction;
      if (action === "admit") {
        runOperation(button, () => admitTicket(ticket.id).catch(handleOperationError));
      }
      if (action === "noshow") {
        runOperation(button, () => markNoShow(ticket.id).catch(handleOperationError));
      }
      if (action === "cancel") {
        runOperation(button, () => cancelTicket(ticket.id).catch(handleOperationError));
      }
    });
  });
}

function setActiveView(view) {
  selectedTicketId = null;
  elements.tabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  elements.sideLinks.forEach((button) => {
    button.classList.toggle("active", button.dataset.nav === view);
  });
  elements.waitingView.classList.toggle("active", view === "waiting");
  elements.noShowView.classList.toggle("active", view === "noshow");
  elements.settingsView.classList.toggle("active", view === "settings");
  elements.contentCard.classList.toggle("settings-mode", view === "settings");
  renderTables();
  renderActionPanel();
}

function renderSettingsForm() {
  elements.cardCountInput.value = cardLimit();
  elements.initialPaceInput.value = bootstrapIntervalMinutes();
}

async function saveSettings(event) {
  event.preventDefault();
  if (adminLocked) {
    setNotice("管理用パスコードが正しく入力されるまで操作できません。", "warning");
    return;
  }

  const cardCount = Number(elements.cardCountInput.value);
  const bootstrapInterval = Number(elements.initialPaceInput.value);

  if (!Number.isInteger(cardCount) || cardCount < 1) {
    setNotice("カード総枚数は1以上の整数で入力してください。", "warning");
    return;
  }
  if (!Number.isFinite(bootstrapInterval) || bootstrapInterval <= 0) {
    setNotice("初期進行ペースは0より大きい数値で入力してください。", "warning");
    return;
  }

  if (usingRemoteApi) {
    const result = await apiRequest(`/api/settings?businessDate=${state.businessDate}`, {
      method: "POST",
      body: JSON.stringify({ cardCount, initialPaceMinutes: bootstrapInterval }),
    });
    applySettingsFromDb(result.settings);
    saveLocalState();
  } else {
    state.settings.cardCount = cardCount;
    state.settings.bootstrapIntervalMinutes = bootstrapInterval;
    state.nextCardNumber = normalizeCardNumber(state.nextCardNumber);
    state.skippedCardNumbers = (state.skippedCardNumbers || []).filter((number) => number <= cardCount);
    saveLocalState();
  }

  setNotice("設定を保存しました。以降の発券と待ち時間計算に反映します。");
  render();
}

async function init() {
  if (canUseRemoteApi()) {
    usingRemoteApi = true;
    state = initialState();
    render();
    try {
      await syncFromApi();
      setNotice("API接続中です。操作内容はSupabaseへ保存されます。");
    } catch (error) {
      setAdminLocked(true, error.message);
      setNotice(`${error.message} 正しい管理用パスコードを入力するまで操作できません。`, "warning");
    }
  } else {
    render();
  }
  render();
  if (adminLocked) setAdminLocked(true);
}

elements.issueButton.addEventListener("click", () => {
  runOperation(elements.issueButton, () => issueTicket().catch(handleOperationError));
});
elements.skipCardButton.addEventListener("click", () => {
  runOperation(elements.skipCardButton, () => skipCardNumber().catch(handleOperationError));
});
elements.resetButton.addEventListener("click", () => elements.resetDialog.showModal());
elements.confirmResetButton.addEventListener("click", () => {
  runOperation(elements.confirmResetButton, () => resetDay().catch(handleOperationError));
});
elements.settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const submitButton = elements.settingsForm.querySelector("button[type='submit']");
  runOperation(submitButton, () => saveSettings(event).catch(handleOperationError));
});
elements.tabButtons.forEach((button) => {
  button.addEventListener("click", () => setActiveView(button.dataset.view));
});
elements.sideLinks.forEach((button) => {
  button.addEventListener("click", () => setActiveView(button.dataset.nav));
});

init();
