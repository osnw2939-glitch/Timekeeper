const DEFAULT_CARD_LIMIT = 300;
const OPEN_HOUR = 9;
const OPEN_MINUTE = 0;
const OPENING_BATCH_SIZE = 7;
const FIRST_AFTER_OPEN_WAIT_MINUTES = 15;
const BOOTSTRAP_ADMITTED_COUNT = 30;
const DEFAULT_BOOTSTRAP_INTERVAL_MINUTES = 1;
const STORAGE_KEY = "ticket-board-v5";

let selectedTicketId = null;
let usingRemoteApi = false;

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

let state = loadLocalState();

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
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
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

function canUseRemoteApi() {
  return window.location.protocol !== "file:";
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "API request failed");
  return body;
}

async function syncFromApi() {
  if (!canUseRemoteApi()) throw new Error("file protocol");

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
  saveLocalState();
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

function cardLimit() {
  return Math.max(1, Number(state.settings?.cardCount || DEFAULT_CARD_LIMIT));
}

function bootstrapIntervalMinutes() {
  return Math.max(0.1, Number(state.settings?.bootstrapIntervalMinutes || DEFAULT_BOOTSTRAP_INTERVAL_MINUTES));
}

function openDate(base = new Date()) {
  const date = new Date(base);
  date.setHours(OPEN_HOUR, OPEN_MINUTE, 0, 0);
  return date;
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

function estimateTailMinutes() {
  const minutes = (estimateTailReturnDate().getTime() - Date.now()) / 60000;
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
  return formatTime(roundToFiveMinutes(estimateReturnDateForTicket(ticket)));
}

function ticketTitle(ticket) {
  return `実番${ticket.actualNumber} / カード${ticket.cardNumber}`;
}

async function issueTicket() {
  if (usingRemoteApi) {
    const estimatedReturnAt = roundToFiveMinutes(estimateTailReturnDate()).toISOString();
    const result = await apiRequest(`/api/tickets?businessDate=${state.businessDate}`, {
      method: "POST",
      body: JSON.stringify({ action: "issue", estimatedReturnAt }),
    });
    await syncFromApi();
    state.lastIssuedId = result.ticket?.id || null;
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
  ticket.estimatedReturnAt = roundToFiveMinutes(estimateReturnDateForTicket(ticket)).toISOString();

  state.tickets.push(ticket);
  state.nextActualNumber += 1;
  state.lastIssuedId = ticket.id;
  saveLocalState();
  render();
  setActiveView("waiting");
}

async function admitTicket(id) {
  if (usingRemoteApi) {
    await apiRequest(`/api/tickets?businessDate=${state.businessDate}`, {
      method: "POST",
      body: JSON.stringify({ action: "admit", id }),
    });
    selectedTicketId = null;
    await syncFromApi();
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
  if (usingRemoteApi) {
    await apiRequest(`/api/tickets?businessDate=${state.businessDate}`, {
      method: "POST",
      body: JSON.stringify({ action: "no_show", id }),
    });
    selectedTicketId = null;
    await syncFromApi();
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
  if (usingRemoteApi) {
    await apiRequest(`/api/tickets?businessDate=${state.businessDate}`, {
      method: "POST",
      body: JSON.stringify({ action: "cancel", id }),
    });
    selectedTicketId = null;
    await syncFromApi();
    render();
    return;
  }

  const ticket = findTicket(id);
  if (!ticket || ticket.status === "admitted") return;
  ticket.status = "canceled";
  ticket.canceledAt = new Date().toISOString();
  ticket.cardRecoveredAt = ticket.cardRecoveredAt ?? new Date().toISOString();
  selectedTicketId = null;
  saveLocalState();
  render();
}

function findTicket(id) {
  return state.tickets.find((ticket) => ticket.id === id);
}

async function resetDay() {
  if (usingRemoteApi) {
    await apiRequest(`/api/tickets?businessDate=${state.businessDate}`, {
      method: "POST",
      body: JSON.stringify({ action: "reset" }),
    });
    selectedTicketId = null;
    await syncFromApi();
    render();
    return;
  }

  state = initialState();
  selectedTicketId = null;
  saveLocalState();
  render();
}

async function skipCardNumber() {
  const value = window.prompt("飛ばすカード番号を入力してください");
  if (!value) return;

  const cardNumber = Number(value);
  if (!Number.isInteger(cardNumber) || cardNumber < 1 || cardNumber > cardLimit()) {
    setNotice(`1から${cardLimit()}までのカード番号を入力してください。`, "warning");
    return;
  }

  if (usingRemoteApi) {
    await apiRequest(`/api/tickets?businessDate=${state.businessDate}`, {
      method: "POST",
      body: JSON.stringify({ action: "skip_card", cardNumber }),
    });
    await syncFromApi();
    setNotice(`カード${cardNumber}を発券対象から外しました。`);
    render();
    return;
  }

  const skipped = new Set(state.skippedCardNumbers || []);
  skipped.add(cardNumber);
  state.skippedCardNumbers = [...skipped].sort((a, b) => a - b);
  if (state.nextCardNumber === cardNumber) state.nextCardNumber = normalizeCardNumber(cardNumber + 1);
  saveLocalState();
  setNotice(`カード${cardNumber}を発券対象から外しました。`);
  render();
}

function setNotice(text, level = "normal") {
  elements.lastIssuedPanel.className = `notice-card ${level}`;
  elements.lastIssuedPanel.innerHTML = `
    <div class="notice-icon">i</div>
    <div>
      <span>お知らせ</span>
      <strong>${text}</strong>
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
  const tailReturn = roundToFiveMinutes(estimateTailReturnDate());
  const noShows = ticketsByStatus("no_show");
  const waiting = ticketsByStatus("waiting");
  const average = averageIntervalMinutes();

  elements.todayLabel.textContent = new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "full",
  }).format(new Date());
  elements.nextActualLabel.textContent = state.nextActualNumber;
  elements.nextCardLabel.textContent = nextCard ?? "--";
  elements.tailWaitLabel.textContent = `約${tailMinutes}分`;
  elements.tailReturnLabel.textContent = `${formatTime(tailReturn)}ごろ`;
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
    container.innerHTML = `<tr><td class="empty-row" colspan="6">${text}</td></tr>`;
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
        <td><span class="number-badge">${ticket.actualNumber}</span></td>
        <td><strong>カード${ticket.cardNumber}</strong></td>
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
  elements.actionPanel.innerHTML = `
    <div class="panel-head">
      <span>選択中：カード${ticket.cardNumber} / 実番 ${ticket.actualNumber}</span>
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
              <small>不在者タブへ移動</small>
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
      if (action === "admit") admitTicket(ticket.id);
      if (action === "noshow") markNoShow(ticket.id);
      if (action === "cancel") cancelTicket(ticket.id);
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
    await apiRequest(`/api/settings?businessDate=${state.businessDate}`, {
      method: "POST",
      body: JSON.stringify({ cardCount, initialPaceMinutes: bootstrapInterval }),
    });
    await syncFromApi();
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
  render();
  if (canUseRemoteApi()) {
    try {
      await syncFromApi();
      usingRemoteApi = true;
      setNotice("API接続中です。操作内容はSupabaseへ保存されます。");
    } catch {
      usingRemoteApi = false;
      setNotice("APIに接続できないため、この端末内の保存で動作しています。", "warning");
    }
  }
  render();
}

elements.issueButton.addEventListener("click", () => issueTicket().catch((error) => setNotice(error.message, "warning")));
elements.skipCardButton.addEventListener("click", () => skipCardNumber().catch((error) => setNotice(error.message, "warning")));
elements.resetButton.addEventListener("click", () => elements.resetDialog.showModal());
elements.confirmResetButton.addEventListener("click", () => resetDay().catch((error) => setNotice(error.message, "warning")));
elements.settingsForm.addEventListener("submit", (event) => saveSettings(event).catch((error) => setNotice(error.message, "warning")));
elements.tabButtons.forEach((button) => {
  button.addEventListener("click", () => setActiveView(button.dataset.view));
});
elements.sideLinks.forEach((button) => {
  button.addEventListener("click", () => setActiveView(button.dataset.nav));
});

init();
