const OPEN_REFRESH_INTERVAL_MS = 180000;
const BEFORE_OPEN_REFRESH_INTERVAL_MS = 300000;
const ERROR_REFRESH_INTERVAL_MS = 300000;

const elements = {
  currentNumber: document.querySelector("#currentNumber"),
  message: document.querySelector("#message"),
  waitingCount: document.querySelector("#waitingCount"),
  tailWait: document.querySelector("#tailWait"),
  averagePace: document.querySelector("#averagePace"),
  updatedAt: document.querySelector("#updatedAt"),
};

let refreshTimer = null;
let loading = false;

function formatUpdatedAt() {
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
}

function formatTime(value) {
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function stopAutoRefresh() {
  if (!refreshTimer) return;
  window.clearTimeout(refreshTimer);
  refreshTimer = null;
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
    const data = await response.json();

    elements.currentNumber.textContent = data.currentNumber ?? "--";
    elements.message.textContent = data.isAfterClosing
      ? "本日の受付は終了しました。"
      : data.isBeforeOpening
        ? "9:00開店後に順番にご案内します。"
        : data.currentNumber
          ? `現在、整理券${data.currentNumber}番付近まで進んでいます。`
          : "まだご案内は始まっていません。";
    elements.waitingCount.textContent = `${data.waitingCount ?? 0}組`;
    elements.tailWait.textContent = data.isAfterClosing
      ? "受付終了"
      : data.isBeforeOpening && data.tailReturnAt
        ? `${formatTime(data.tailReturnAt)}ごろ`
        : `約${data.tailWaitMinutes ?? 0}分`;
    elements.averagePace.textContent = `約${Number(data.averageIntervalMinutes ?? 1).toFixed(1)}分/組`;
    elements.updatedAt.textContent = data.isAfterClosing
      ? `${formatUpdatedAt()} 更新・自動更新停止`
      : `${formatUpdatedAt()} 更新`;
    scheduleNextRefresh(data);
  } catch {
    elements.currentNumber.textContent = "--";
    elements.message.textContent = "ただいま表示準備中です。店頭スタッフへご確認ください。";
    elements.waitingCount.textContent = "--";
    elements.tailWait.textContent = "--";
    elements.averagePace.textContent = "--";
    elements.updatedAt.textContent = "接続待ち";
    scheduleNextRefresh(null, ERROR_REFRESH_INTERVAL_MS);
  } finally {
    loading = false;
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopAutoRefresh();
    return;
  }

  loadStatus();
});

loadStatus();
