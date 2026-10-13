// ===== 日历（2000 - 2050） =====
const MIN_YEAR = 2000;
const MAX_YEAR = 2050;
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
const ANNIVERSARIES_STORAGE_KEY = "zine_anniversaries_v1";
const DIARIES_STORAGE_KEY = "zine_diaries_v1";

const now = new Date();
let viewYear = now.getFullYear();
let viewMonth = now.getMonth(); // 0-11
let anniversaries = {};
let diaries = {};
let editingDate = "";

const grid = document.getElementById("calGrid");
const yearSelect = document.getElementById("yearSelect");
const monthSelect = document.getElementById("monthSelect");
const anniversaryDialog = document.getElementById("anniversaryDialog");
const anniversaryForm = document.getElementById("anniversaryForm");
const anniversaryDate = document.getElementById("anniversaryDate");
const anniversaryName = document.getElementById("anniversaryName");
const deleteAnniversaryButton = document.getElementById("deleteAnniversaryBtn");

function loadAnniversaries() {
  try {
    const stored = localStorage.getItem(ANNIVERSARIES_STORAGE_KEY);
    if (stored === null) return {};

    const parsed = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Saved anniversaries must be a date-name object.");
    }
    return Object.fromEntries(Object.entries(parsed).filter(([date, name]) =>
      /^\d{4}-\d{2}-\d{2}$/.test(date) && typeof name === "string"
    ));
  } catch (error) {
    console.error("Unable to load saved anniversaries.", error);
    window.alert("读取纪念日标记失败，请检查浏览器存储。");
    return {};
  }
}

function saveAnniversaries() {
  try {
    localStorage.setItem(ANNIVERSARIES_STORAGE_KEY, JSON.stringify(anniversaries));
    return true;
  } catch (error) {
    console.error("Unable to save anniversaries.", error);
    window.alert("纪念日保存失败，请检查浏览器存储空间和权限。");
    return false;
  }
}

function loadDiaries() {
  try {
    const stored = localStorage.getItem(DIARIES_STORAGE_KEY);
    if (stored === null) return {};
    const parsed = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Saved diaries must be a date-text object.");
    }
    return Object.fromEntries(Object.entries(parsed).filter(([date, text]) =>
      /^\d{4}-\d{2}-\d{2}$/.test(date) && typeof text === "string" && text.length > 0
    ));
  } catch (error) {
    console.error("Unable to load saved diaries.", error);
    window.alert("读取日记标记失败，请检查浏览器存储。");
    return {};
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

anniversaries = loadAnniversaries();
diaries = loadDiaries();

// ===== 填充年/月下拉框 =====
for (let y = MIN_YEAR; y <= MAX_YEAR; y++) {
  const opt = document.createElement("option");
  opt.value = y;
  opt.textContent = y;
  yearSelect.appendChild(opt);
}
for (let m = 1; m <= 12; m++) {
  const opt = document.createElement("option");
  opt.value = m;
  opt.textContent = m;
  monthSelect.appendChild(opt);
}

// ===== 渲染月历 =====
function render() {
  yearSelect.value = viewYear;
  monthSelect.value = viewMonth + 1;

  // 星期表头
  let html = WEEKDAYS.map(
    (w) => `<div class="cal-weekday${w === "日" || w === "六" ? " weekend" : ""}">${w}</div>`
  ).join("");

  // 该月第一天是星期几、该月天数
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  // 前置空白格
  for (let i = 0; i < firstDay; i++) {
    html += `<div class="cal-day-cell empty"></div>`;
  }

  // 日期格
  for (let d = 1; d <= daysInMonth; d++) {
    const isToday =
      d === now.getDate() &&
      viewMonth === now.getMonth() &&
      viewYear === now.getFullYear();
    const weekday = new Date(viewYear, viewMonth, d).getDay();
    const isWeekend = weekday === 0 || weekday === 6;
    const dateKey = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const anniversary = anniversaries[dateKey];
    const hasDiary = Boolean(diaries[dateKey]);
    html += `
      <div class="cal-day-cell${isToday ? " today" : ""}">
        <a class="cal-day${isToday ? " today" : ""}${isWeekend ? " weekend" : ""}"
           href="day.html?date=${dateKey}">
          ${anniversary ? `<span class="anniversary-icon" aria-hidden="true">♥</span>` : ""}
          ${hasDiary ? `<span class="diary-icon" aria-hidden="true">✎</span>` : ""}
          <span>${d}</span>
          ${anniversary ? `<span class="anniversary-name">${escapeHtml(anniversary)}</span>` : ""}
        </a>
        <button class="anniversary-edit" type="button" data-action="edit-anniversary" data-date="${dateKey}"
          aria-label="${anniversary ? "编辑" : "添加"}${escapeHtml(dateKey)}纪念日"
          title="${anniversary ? "编辑纪念日" : "添加纪念日"}">${anniversary ? "✎" : "+"}</button>
      </div>`;
  }

  // 末尾补齐空白格，保证最后一行完整、横竖线连接
  const total = firstDay + daysInMonth;
  const trailing = (7 - (total % 7)) % 7;
  for (let i = 0; i < trailing; i++) {
    html += `<div class="cal-day-cell empty"></div>`;
  }

  grid.innerHTML = html;
  updateArrows();
}

function openAnniversaryDialog(date) {
  editingDate = date;
  anniversaryDate.textContent = date.replaceAll("-", "年").replace(/年(\d{2})$/, "月$1日");
  anniversaryName.value = anniversaries[date] || "";
  deleteAnniversaryButton.hidden = !anniversaries[date];
  anniversaryDialog.showModal();
  anniversaryName.focus();
}

grid.addEventListener("click", (event) => {
  const button = event.target.closest('[data-action="edit-anniversary"]');
  if (!button) return;
  event.preventDefault();
  openAnniversaryDialog(button.dataset.date);
});

anniversaryForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = anniversaryName.value.trim();
  if (!name) {
    anniversaryName.focus();
    return;
  }
  const previousName = anniversaries[editingDate];
  anniversaries[editingDate] = name;
  if (!saveAnniversaries()) {
    if (previousName === undefined) delete anniversaries[editingDate];
    else anniversaries[editingDate] = previousName;
    return;
  }
  anniversaryDialog.close();
  render();
});

deleteAnniversaryButton.addEventListener("click", () => {
  const previousName = anniversaries[editingDate];
  delete anniversaries[editingDate];
  if (!saveAnniversaries()) {
    anniversaries[editingDate] = previousName;
    return;
  }
  anniversaryDialog.close();
  render();
});

anniversaryForm.addEventListener("click", (event) => {
  if (event.target.closest('[data-action="cancel-anniversary"]')) anniversaryDialog.close();
});

// ===== 边界处理：2000年1月 ~ 2050年12月 =====
function updateArrows() {
  document.getElementById("prevMonth").disabled =
    viewYear === MIN_YEAR && viewMonth === 0;
  document.getElementById("nextMonth").disabled =
    viewYear === MAX_YEAR && viewMonth === 11;
}

function shiftMonth(delta) {
  let m = viewMonth + delta;
  let y = viewYear;
  if (m < 0) { m = 11; y--; }
  if (m > 11) { m = 0; y++; }
  if (y < MIN_YEAR || y > MAX_YEAR) return;
  viewYear = y;
  viewMonth = m;
  render();
}

// ===== 事件 =====
document.getElementById("prevMonth").addEventListener("click", () => shiftMonth(-1));
document.getElementById("nextMonth").addEventListener("click", () => shiftMonth(1));

yearSelect.addEventListener("change", (e) => {
  viewYear = Number(e.target.value);
  render();
});

monthSelect.addEventListener("change", (e) => {
  viewMonth = Number(e.target.value) - 1;
  render();
});

// 回到今天
document.getElementById("todayBtn").addEventListener("click", () => {
  viewYear = now.getFullYear();
  viewMonth = now.getMonth();
  render();
});

render();
