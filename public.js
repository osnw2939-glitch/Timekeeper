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

async function loadStatus() {
  if (loading) return;
  loading = true;

  try {
    const response = await fetch("/api/public-status");
    if (!response.ok) throw new Error("status api failed");
    const data = await response.json();

    elements.currentNumber.textContent = data.currentNumber ?? "--";
    elements.message.textContent = data.currentNumber
      ? `現在、実番${data.currentNumber}付近まで進んでいます。`
      : "まだ案内は始まっていません。";
    elements.waitingCount.textContent = `${data.waitingCount ?? 0}組`;
    elements.tailWait.textContent = `約${data.tailWaitMinutes ?? 0}分`;
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
