const OPEN_REFRESH_INTERVAL_MS = 180000;
const BEFORE_OPEN_REFRESH_INTERVAL_MS = 300000;
const ERROR_REFRESH_INTERVAL_MS = 300000;
const LOCAL_COUNTDOWN_INTERVAL_MS = 60000;

const logic = window.PublicStatusLogic;
const elements = {
  currentNumber: document.querySelector("#currentNumber"),
  message: document.querySelector("#message"),
  waitingCount: document.querySelector("#waitingCount"),
  averagePace: document.querySelector("#averagePace"),
  updatedAt: document.querySelector("#updatedAt"),
  personalStatus: document.querySelector("#personalStatus"),
  personalCardNumber: document.querySelector("#personalCardNumber"),
  promisedReturnTime: document.querySelector("#promisedReturnTime"),
  remainingEstimate: document.querySelector("#remainingEstimate"),
  personalMessage: document.querySelector("#personalMessage"),
};

let refreshTimer = null;
let countdownTimer = null;
let loading = false;
let latestData = null;
let serverClock = null;

function formatTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return `${new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)}ごろ`;
}

function formatUpdatedAt() {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
}

function selectedCardNumber() {
  return logic.cardNumberFromHash(window.location.hash);
}

function hasCardFragment() {
  return window.location.hash.length > 1;
}

function renderPersonalStatus() {
  const hasSelection = hasCardFragment();
  elements.personalStatus.hidden = !hasSelection;
  if (!hasSelection) return;

  const cardNumber = selectedCardNumber();
  elements.personalCardNumber.textContent = cardNumber ?? "--";

  if (!cardNumber) {
    elements.promisedReturnTime.textContent = "--";
    elements.remainingEstimate.textContent = "確認できません";
    elements.personalMessage.textContent = "整理券番号を確認できません。QRコードをもう一度読み取ってください。";
    return;
  }

  if (!latestData) {
    elements.promisedReturnTime.textContent = "--";
    elements.remainingEstimate.textContent = "確認中";
    elements.personalMessage.textContent = "現在の状況を確認しています。";
    return;
  }

  const ticket = latestData.ticketsByCard?.[String(cardNumber)];
  elements.promisedReturnTime.textContent = formatTime(ticket?.promisedReturnAt);

  if (latestData.isAfterClosing) {
    elements.remainingEstimate.textContent = "本日は終了";
    elements.personalMessage.textContent = "本日の受付は終了しました。";
    return;
  }

  if (!ticket) {
    elements.remainingEstimate.textContent = "受付でご確認ください";
    elements.personalMessage.textContent =
      "この整理券は現在の待機一覧にありません。整理券をお持ちの場合は受付へお声がけください。";
    return;
  }

  if (ticket.status === "no_show") {
    elements.remainingEstimate.textContent = "お呼び出し済み";
    elements.personalMessage.textContent = "整理券を持って受付へお越しください。順番にご案内します。";
    return;
  }

  const currentTime = logic.currentServerTime(serverClock);
  const remainingMinutes = logic.roundedRemainingMinutes(
    ticket.estimatedReadyAt,
    currentTime,
    5,
  );
  const promisedTime = ticket.promisedReturnAt ? new Date(ticket.promisedReturnAt).getTime() : null;
  const estimatedTime = ticket.estimatedReadyAt ? new Date(ticket.estimatedReadyAt).getTime() : null;

  if (remainingMinutes === null) {
    elements.remainingEstimate.textContent = "受付でご確認ください";
    elements.personalMessage.textContent = "現在の見込みを計算できません。受付へお声がけください。";
    return;
  }

  if (remainingMinutes === 0) {
    elements.remainingEstimate.textContent = "受付へお越しください";
    elements.personalMessage.textContent =
      promisedTime && currentTime >= promisedTime
        ? "お伝えした時刻を過ぎています。整理券を持って受付へお越しください。"
        : "ご案内できる見込みです。整理券を持って受付へお越しください。";
    return;
  }

  elements.remainingEstimate.textContent = `あと約${remainingMinutes}分`;

  if (latestData.isBeforeOpening) {
    elements.personalMessage.textContent = "9:00から順番にご案内します。表示時間を目安にお戻りください。";
  } else if (promisedTime && currentTime >= promisedTime) {
    elements.personalMessage.textContent =
      "お伝えした時刻を過ぎています。整理券を持って受付へお越しください。表示時間は現在の進行による目安です。";
  } else if (promisedTime && estimatedTime && estimatedTime < promisedTime) {
    elements.personalMessage.textContent =
      "予定より進行が早まっています。早めにご案内できる可能性があります。";
  } else {
    elements.personalMessage.textContent = "現在の進行から計算した目安です。表示時間を目安にお戻りください。";
  }
}

function renderGeneralStatus(data) {
  elements.currentNumber.textContent = data.currentNumber ?? "--";
  elements.message.textContent = data.isAfterClosing
    ? "本日の受付は終了しました。"
    : data.isBeforeOpening
      ? "9:00開店後に順番にご案内します。"
      : data.currentNumber
        ? `現在、整理券${data.currentNumber}番付近まで進んでいます。`
        : "まだご案内は始まっていません。";
  elements.waitingCount.textContent = `${data.waitingCount ?? 0}組`;
  elements.averagePace.textContent = `約${Number(data.averageIntervalMinutes ?? 1).toFixed(1)}分/組`;
  elements.updatedAt.textContent = data.isAfterClosing
    ? `${formatUpdatedAt()} 更新・自動更新停止`
    : `${formatUpdatedAt()} 更新`;
}

function stopAutoRefresh() {
  if (!refreshTimer) return;
  window.clearTimeout(refreshTimer);
  refreshTimer = null;
}

function stopLocalCountdown() {
  if (!countdownTimer) return;
  window.clearInterval(countdownTimer);
  countdownTimer = null;
}

function startLocalCountdown(data) {
  stopLocalCountdown();
  if (document.hidden || data?.isAfterClosing || !hasCardFragment()) return;
  countdownTimer = window.setInterval(renderPersonalStatus, LOCAL_COUNTDOWN_INTERVAL_MS);
}

function scheduleNextRefresh(data, fallbackDelay = OPEN_REFRESH_INTERVAL_MS) {
  stopAutoRefresh();
  if (document.hidden || data?.isAfterClosing) return;

  const delay = data?.isBeforeOpening ? BEFORE_OPEN_REFRESH_INTERVAL_MS : fallbackDelay;
  refreshTimer = window.setTimeout(loadStatus, delay);
}

async function loadStatus() {
  if (loading) return;
  loading = true;

  try {
    const response = await fetch("/api/public-status");
    if (!response.ok) throw new Error("status api failed");
    const responseAgeSeconds = Number(response.headers.get("Age") || 0);
    const data = await response.json();

    latestData = data;
    serverClock = logic.createServerClock(data.serverTime || data.updatedAt, responseAgeSeconds);
    renderGeneralStatus(data);
    renderPersonalStatus();
    startLocalCountdown(data);
    scheduleNextRefresh(data);
  } catch {
    if (!latestData) {
      elements.currentNumber.textContent = "--";
      elements.message.textContent = "ただいま表示準備中です。店頭スタッフへご確認ください。";
      elements.waitingCount.textContent = "--";
      elements.averagePace.textContent = "--";
      renderPersonalStatus();
    }
    elements.updatedAt.textContent = "接続待ち";
    scheduleNextRefresh(null, ERROR_REFRESH_INTERVAL_MS);
  } finally {
    loading = false;
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopAutoRefresh();
    stopLocalCountdown();
    return;
  }

  loadStatus();
});

window.addEventListener("hashchange", () => {
  renderPersonalStatus();
  startLocalCountdown(latestData);
});

renderPersonalStatus();
loadStatus();
