const DIARIES_STORAGE_KEY = "zine_diaries_v1";
const date = new URLSearchParams(window.location.search).get("date");
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const dateMatch = date && date.match(datePattern);
const diaryDate = document.getElementById("diaryDate");
const diaryText = document.getElementById("diaryText");
const diaryStatus = document.getElementById("diaryStatus");
let diaries = {};
let saveTimer;

function isValidDiaryDate(match) {
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return year >= 2000
    && year <= 2050
    && month >= 1
    && month <= 12
    && day >= 1
    && day <= new Date(year, month, 0).getDate();
}

if (!isValidDiaryDate(dateMatch)) {
  diaryDate.textContent = "无效的日期";
  diaryText.disabled = true;
  diaryStatus.textContent = "请从日历选择一个有效日期。";
  diaryStatus.classList.add("error");
} else {
  diaryDate.textContent = `${dateMatch[1]}年${Number(dateMatch[2])}月${Number(dateMatch[3])}日`;
  document.title = `${diaryDate.textContent} 日记 - ZINE集`;
  loadDiary();
  diaryText.addEventListener("input", scheduleSave);
  window.addEventListener("pagehide", saveDiary);
}

function loadDiary() {
  try {
    const stored = localStorage.getItem(DIARIES_STORAGE_KEY);
    if (stored !== null) {
      const parsed = JSON.parse(stored);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Saved diaries must be a date-text object.");
      }
      diaries = parsed;
    }
    const savedText = diaries[date];
    if (savedText !== undefined && typeof savedText !== "string") {
      throw new Error(`Saved diary for ${date} is invalid.`);
    }
    diaryText.value = savedText || "";
  } catch (error) {
    console.error("Unable to load the saved diary.", error);
    diaryStatus.textContent = "读取日记失败，请检查浏览器存储。";
    diaryStatus.classList.add("error");
    diaryText.disabled = true;
  }
}

function scheduleSave() {
  diaryStatus.textContent = "正在保存…";
  diaryStatus.classList.remove("error");
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveDiary, 300);
}

function saveDiary() {
  if (diaryText.disabled) return;
  window.clearTimeout(saveTimer);
  const content = diaryText.value;
  const previousText = diaries[date];
  if (content.trim()) diaries[date] = content;
  else delete diaries[date];

  try {
    localStorage.setItem(DIARIES_STORAGE_KEY, JSON.stringify(diaries));
    diaryStatus.textContent = content.trim() ? "已自动保存" : "空白日记已清除";
    diaryStatus.classList.remove("error");
  } catch (error) {
    if (previousText === undefined) delete diaries[date];
    else diaries[date] = previousText;
    console.error("Unable to save the diary.", error);
    diaryStatus.textContent = "保存失败，请检查浏览器存储空间和权限。";
    diaryStatus.classList.add("error");
  }
}
