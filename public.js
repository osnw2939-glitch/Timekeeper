const REFRESH_INTERVAL_MS = 60000;

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
    elements.updatedAt.textContent = `${formatUpdatedAt()} 更新`;
  } catch {
    elements.currentNumber.textContent = "--";
    elements.message.textContent = "ただいま表示準備中です。店頭スタッフへご確認ください。";
    elements.waitingCount.textContent = "--";
    elements.tailWait.textContent = "--";
    elements.averagePace.textContent = "--";
    elements.updatedAt.textContent = "接続待ち";
  } finally {
    loading = false;
  }
}

function startAutoRefresh() {
  if (refreshTimer || document.hidden) return;
  refreshTimer = window.setInterval(loadStatus, REFRESH_INTERVAL_MS);
}

function stopAutoRefresh() {
  if (!refreshTimer) return;
  window.clearInterval(refreshTimer);
  refreshTimer = null;
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopAutoRefresh();
    return;
  }

  loadStatus();
  startAutoRefresh();
});

loadStatus();
startAutoRefresh();
