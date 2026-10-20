const DIARIES_STORAGE_KEY = "zine_diaries_v1";
const REPORT_STORAGE_PREFIX = "zine_monthly_report_";
const BOOKS_STORAGE_KEY = "zine_books_v1";
const BOOK_SUMMARY_STORAGE_KEY = "zine_book_summary_v1";
const generateButton = document.getElementById("generateReportBtn");
const reportStatus = document.getElementById("reportStatus");
const reportResult = document.getElementById("reportResult");
const bookSummaryButton = document.getElementById("bookSummaryBtn");
const bookSummaryStatus = document.getElementById("bookSummaryStatus");
const bookSummaryResult = document.getElementById("bookSummaryResult");
const bookSummaryToggle = document.getElementById("bookSummaryToggle");
const reportToggle = document.getElementById("reportToggle");
const accountCardEmail = document.getElementById("accountCardEmail");
const accountCardLink = document.getElementById("accountCardLink");
const now = new Date();
const reportMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
let diariesByDate = {};

function renderAccountCard(snapshot) {
  if (snapshot.user) {
    accountCardEmail.textContent = snapshot.user.username ? `@${snapshot.user.username}` : "已登录账号";
  } else {
    accountCardEmail.textContent = "未登录";
  }
  accountCardLink.textContent = "管理账号";
  accountCardLink.href = "account.html";
}

function readDiaries() {
  try {
    const saved = localStorage.getItem(DIARIES_STORAGE_KEY);
    if (saved === null) return {};
    const parsed = JSON.parse(saved);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Saved diaries must be a date-text object.");
    }
    return parsed;
  } catch (error) {
    console.error("Unable to read journal entries for the AI report.", error);
    reportStatus.textContent = "无法读取日记存档，请检查浏览器存储。";
    reportStatus.classList.add("error");
    generateButton.disabled = true;
    return {};
  }
}

function escapeReportHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function saveReportRecord(key, payload) {
  return window.ZineCloud
    ? window.ZineCloud.setRecord(key, payload)
    : (localStorage.setItem(key, JSON.stringify(payload)), true);
}

function recapToggleFor(element) {
  return element === reportResult ? reportToggle : bookSummaryToggle;
}

function setRecapExpanded(element, expanded) {
  const toggle = recapToggleFor(element);
  element.hidden = !expanded;
  toggle.hidden = false;
  toggle.classList.toggle("collapsed", !expanded);
  toggle.setAttribute("aria-expanded", String(expanded));
  toggle.setAttribute("aria-label", expanded ? "收起总结报告" : "展开总结报告");
}

function bindRecapToggle(element) {
  const toggle = recapToggleFor(element);
  toggle.addEventListener("click", () => {
    setRecapExpanded(element, element.hidden);
  });
}

function narrativeHtml(narrative, pending = false) {
  const content = pending ? "正在生成回顾文字…" : escapeReportHtml(narrative).replace(/\n/g, "<br>");
  return `<p class="recap-narrative${pending ? " pending" : ""}" data-recap-narrative>${content}</p>`;
}

function showLegacyRecap(element, text, generatedAt, label) {
  element.classList.add("report-visual");
  element.innerHTML = `
    <div class="annual-report legacy-recap">
      <div class="recap-section">
        <p class="recap-kicker">${escapeReportHtml(label)}</p>
        <p class="recap-narrative">${escapeReportHtml(text).replace(/\n/g, "<br>")}</p>
      </div>
      <div class="recap-footer">ZINE · ${new Date(generatedAt).toLocaleDateString("zh-CN")}</div>
    </div>`;
  setRecapExpanded(element, true);
  element.dataset.generatedAt = generatedAt;
}

function buildMonthlyStats() {
  const entries = Object.entries(diariesByDate)
    .filter(([date, text]) => date.startsWith(`${reportMonth}-`) && typeof text === "string" && text.trim())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, text]) => ({ date, text: text.trim() }));
  if (!entries.length) return null;

  const lengths = entries.map((entry) => entry.text.length);
  const totalChars = lengths.reduce((sum, value) => sum + value, 0);
  const longestIndex = lengths.indexOf(Math.max(...lengths));
  const entryMap = new Map(entries.map((entry) => [Number(entry.date.slice(-2)), entry]));
  let streak = 0;
  let currentStreak = 0;
  for (let day = 1; day <= 31; day += 1) {
    if (entryMap.has(day)) {
      currentStreak += 1;
      streak = Math.max(streak, currentStreak);
    } else {
      currentStreak = 0;
    }
  }
  return {
    kind: "monthly",
    month: reportMonth,
    entries,
    days: entries.length,
    totalChars,
    averageChars: Math.round(totalChars / entries.length),
    streak,
    longest: entries[longestIndex],
    heat: Object.fromEntries(entries.map((entry) => [Number(entry.date.slice(-2)), entry.text.length])),
  };
}

function renderMonthlyRecap(stats, generatedAt, narrative = "", pending = false) {
  const [year, month] = stats.month.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const maxHeat = Math.max(1, ...Object.values(stats.heat));
  const cells = [];
  for (let index = 0; index < firstWeekday; index += 1) cells.push('<span class="recap-day empty"></span>');
  for (let day = 1; day <= daysInMonth; day += 1) {
    const value = stats.heat[day] || 0;
    const alpha = value ? Math.max(0.35, Math.min(1, value / maxHeat)) : 0;
    cells.push(`<span class="recap-day${value ? " active" : ""}" style="--heat:${alpha}">${day}</span>`);
  }
  const longestDate = new Date(`${stats.longest.date}T00:00:00`).toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
  reportResult.classList.add("report-visual");
  reportResult.innerHTML = `
    <div class="annual-report monthly-recap">
      <div class="recap-hero monthly-hero">
        <span class="recap-kicker">MONTHLY ZINE REPORT</span>
        <span class="recap-date">${year} · ${String(month).padStart(2, "0")}</span>
        <strong>${stats.days}</strong>
        <span class="recap-hero-caption">天留下了记录</span>
      </div>
      <div class="recap-stat-grid">
        <article><strong>${formatNumber(stats.totalChars)}</strong><span>写下字符</span></article>
        <article><strong>${stats.streak}</strong><span>最长连续天数</span></article>
        <article><strong>${formatNumber(stats.averageChars)}</strong><span>平均每篇字符</span></article>
        <article><strong>${stats.longest.text.length}</strong><span>最长一篇字符</span></article>
      </div>
      <section class="recap-section">
        <div class="recap-section-heading"><h3>记录热力</h3><span>越深表示写得越多</span></div>
        <div class="recap-calendar">${cells.join("")}</div>
      </section>
      <section class="recap-section">
        <div class="recap-section-heading"><h3>本月回顾</h3><span>${new Date(generatedAt).toLocaleDateString("zh-CN")}</span></div>
        ${narrativeHtml(narrative, pending)}
      </section>
      <section class="recap-highlight">
        <span>${longestDate} · 最长记录</span>
        <p>${escapeReportHtml(stats.longest.text.slice(0, 180))}${stats.longest.text.length > 180 ? "…" : ""}</p>
      </section>
      <div class="recap-footer">ZINE · YOUR LITTLE JOURNAL</div>
    </div>`;
  setRecapExpanded(reportResult, true);
  reportResult.dataset.generatedAt = generatedAt;
}

function setRecapNarrative(element, narrative) {
  const node = element.querySelector("[data-recap-narrative]");
  if (!node) return;
  node.classList.remove("pending");
  node.innerHTML = escapeReportHtml(narrative).replace(/\n/g, "<br>");
}

function loadSavedReport() {
  try {
    const saved = localStorage.getItem(REPORT_STORAGE_PREFIX + reportMonth);
    if (saved === null) return;
    const report = JSON.parse(saved);
    if (report.kind === "monthly" && report.stats && typeof report.generatedAt === "string") {
      renderMonthlyRecap(report.stats, report.generatedAt, report.narrative || "");
      return;
    }
    if (typeof report.text === "string" && typeof report.generatedAt === "string") {
      showLegacyRecap(reportResult, report.text, report.generatedAt, "往期月度总结");
    }
  } catch (error) {
    console.error("Unable to load the saved monthly report.", error);
    reportStatus.textContent = "读取上次生成的报告失败。";
    reportStatus.classList.add("error");
  }
}

async function generateReport() {
  const stats = buildMonthlyStats();
  if (!stats) {
    reportStatus.textContent = "本月还没有已保存的日记，先写几篇再生成回顾吧。";
    reportStatus.classList.remove("error");
    return;
  }

  const generatedAt = new Date().toISOString();
  const fallbackNarrative =
    `这个月，你在 ${stats.days} 天里写下了 ${formatNumber(stats.totalChars)} 个字符。` +
    `最长的一次记录在 ${new Date(stats.longest.date + "T00:00:00").toLocaleDateString("zh-CN")}，` +
    `连续记录最久达到了 ${stats.streak} 天。`;
  renderMonthlyRecap(stats, generatedAt, "", true);
  generateButton.disabled = true;
  reportStatus.textContent = "正在生成本月回顾…";
  reportStatus.classList.remove("error");

  let narrative = fallbackNarrative;
  let usedApi = false;
  try {
    const response = await fetch("/api/monthly-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month: reportMonth, entries: stats.entries }),
    });
    const result = await response.json();
    if (response.ok && typeof result.report === "string" && result.report.trim()) {
      narrative = result.report.trim();
      usedApi = true;
    }
  } catch (error) {
    console.warn("Monthly recap API unavailable; using local narrative.", error);
  }

  setRecapNarrative(reportResult, narrative);
  saveReportRecord(REPORT_STORAGE_PREFIX + reportMonth, {
    kind: "monthly",
    stats,
    narrative,
    generatedAt,
  });
  reportStatus.textContent = `本月回顾已生成${usedApi ? " · AI 文字" : ""}`;
  generateButton.disabled = false;
}

function collectBookContent() {
  let books = [];
  try {
    const saved = localStorage.getItem(BOOKS_STORAGE_KEY);
    if (saved !== null) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) books = parsed;
    }
  } catch (error) {
    console.error("Unable to read saved books for the recap.", error);
    bookSummaryStatus.textContent = "无法读取集存档，请检查浏览器存储。";
    bookSummaryStatus.classList.add("error");
    return null;
  }

  return books.map((book) => {
    const titles = Array.isArray(book.chapters) ? book.chapters : [];
    let pagesWithContent = 0;
    let photos = 0;
    let decorations = 0;
    let textCount = 0;
    let totalChars = 0;
    let longestText = "";
    const chapters = titles.map((title) => {
      const chapter = { title: String(title), texts: [], photos: 0, decorations: 0, pages: 0 };
      try {
        const key = `zine_chapter_${encodeURIComponent(book.id)}_${encodeURIComponent(title)}`;
        const raw = localStorage.getItem(key);
        if (raw !== null) {
          const parsed = JSON.parse(raw);
          const pages = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.pages) ? parsed.pages : [];
          pages.forEach((page) => {
            if (!Array.isArray(page) || !page.length) return;
            chapter.pages += 1;
            pagesWithContent += 1;
            page.forEach((element) => {
              if (!element || typeof element !== "object") return;
              if (["text", "note", "label"].includes(element.type) && typeof element.content === "string" && element.content.trim()) {
                const text = element.content.trim();
                chapter.texts.push(text.slice(0, 1200));
                textCount += 1;
                totalChars += text.length;
                if (text.length > longestText.length) longestText = text;
              } else if (element.type === "photo" || element.type === "video") {
                chapter.photos += 1;
                photos += 1;
              } else if (element.type === "sticker" || element.type === "washi") {
                chapter.decorations += 1;
                decorations += 1;
              }
            });
          });
        }
      } catch (error) {
        console.error("Unable to read chapter content for the recap.", error);
      }
      chapter.texts = chapter.texts.slice(0, 60);
      return chapter;
    });
    return {
      id: book.id,
      title: typeof book.title === "string" && book.title.trim() ? book.title.trim() : "未命名集",
      lastEditedAt: Number.isFinite(book.lastEditedAt) ? book.lastEditedAt : 0,
      chapters,
      pages: pagesWithContent,
      photos,
      decorations,
      textCount,
      totalChars,
      longestText,
    };
  }).filter((book) => book.chapters.length > 0);
}

function buildBookStats(books) {
  const pages = books.reduce((sum, book) => sum + book.pages, 0);
  const photos = books.reduce((sum, book) => sum + book.photos, 0);
  const decorations = books.reduce((sum, book) => sum + book.decorations, 0);
  const textCount = books.reduce((sum, book) => sum + book.textCount, 0);
  if (!pages && !photos && !decorations && !textCount) return null;
  const activeBooks = books.filter((book) => book.pages || book.photos || book.decorations || book.textCount);
  const topBooks = [...activeBooks]
    .sort((left, right) => (right.pages + right.photos + right.decorations) - (left.pages + left.photos + left.decorations))
    .slice(0, 3);
  const monthCounts = Array.from({ length: 12 }, () => 0);
  const year = now.getFullYear();
  books.forEach((book) => {
    if (!book.lastEditedAt) return;
    const date = new Date(book.lastEditedAt);
    if (date.getFullYear() === year) monthCounts[date.getMonth()] += 1;
  });
  return {
    kind: "book",
    year,
    booksCount: activeBooks.length,
    chapters: books.reduce((sum, book) => sum + book.chapters.length, 0),
    pages,
    photos,
    decorations,
    textCount,
    totalChars: books.reduce((sum, book) => sum + book.totalChars, 0),
    topBooks,
    monthCounts,
  };
}

function renderBookRecap(stats, generatedAt, narrative = "", pending = false) {
  const maxMonth = Math.max(1, ...stats.monthCounts);
  const bars = stats.monthCounts.map((count, index) => {
    const height = count ? Math.max(14, Math.round((count / maxMonth) * 100)) : 4;
    return `<span class="recap-bar${count ? " active" : ""}" style="height:${height}%"><i>${index + 1}</i></span>`;
  }).join("");
  const topBooks = stats.topBooks.map((book, index) => `
    <article class="recap-book">
      <span>${String(index + 1).padStart(2, "0")}</span>
      <div><strong>${escapeReportHtml(book.title)}</strong><small>${book.chapters.length} 章 · ${book.pages} 页 · ${book.photos + book.decorations} 个素材</small></div>
    </article>`).join("");
  bookSummaryResult.classList.add("report-visual");
  bookSummaryResult.innerHTML = `
    <div class="annual-report book-recap">
      <div class="recap-hero annual-hero">
        <span class="recap-kicker">ZINE RECAP ${stats.year}</span>
        <strong>${stats.pages}</strong>
        <span class="recap-hero-caption">页被认真记录</span>
        <p>${stats.booksCount} 本集 · ${stats.chapters} 个章节 · ${formatNumber(stats.textCount)} 段文字</p>
      </div>
      <div class="recap-stat-grid">
        <article><strong>${stats.photos}</strong><span>照片与视频</span></article>
        <article><strong>${stats.decorations}</strong><span>贴纸与胶带</span></article>
        <article><strong>${formatNumber(stats.totalChars)}</strong><span>写下字符</span></article>
        <article><strong>${stats.chapters}</strong><span>完成章节</span></article>
      </div>
      <section class="recap-section">
        <div class="recap-section-heading"><h3>创作轨迹</h3><span>按最近编辑时间</span></div>
        <div class="recap-bars">${bars}</div>
      </section>
      <section class="recap-section">
        <div class="recap-section-heading"><h3>年度主角</h3><span>你的高光集</span></div>
        <div class="recap-book-list">${topBooks}</div>
      </section>
      <section class="recap-section">
        <div class="recap-section-heading"><h3>年度回顾</h3><span>${new Date(generatedAt).toLocaleDateString("zh-CN")}</span></div>
        ${narrativeHtml(narrative, pending)}
      </section>
      <div class="recap-footer">ZINE · YOUR ANNUAL RECAP</div>
    </div>`;
  setRecapExpanded(bookSummaryResult, true);
  bookSummaryResult.dataset.generatedAt = generatedAt;
}

function loadSavedBookSummary() {
  try {
    const saved = localStorage.getItem(BOOK_SUMMARY_STORAGE_KEY);
    if (saved === null) return;
    const summary = JSON.parse(saved);
    if (summary.kind === "book" && summary.stats && typeof summary.generatedAt === "string") {
      renderBookRecap(summary.stats, summary.generatedAt, summary.narrative || "");
      return;
    }
    if (typeof summary.text === "string" && typeof summary.generatedAt === "string") {
      showLegacyRecap(bookSummaryResult, summary.text, summary.generatedAt, "往期 ZINE 总结");
    }
  } catch (error) {
    console.error("Unable to load the saved book summary.", error);
    bookSummaryStatus.textContent = "读取上次的集总结失败。";
    bookSummaryStatus.classList.add("error");
  }
}

async function generateBookSummary() {
  const books = collectBookContent();
  if (books === null) return;
  const stats = buildBookStats(books);
  if (!stats) {
    bookSummaryStatus.textContent = "还没有编辑过的集，先去做一页手账再来生成回顾吧。";
    bookSummaryStatus.classList.remove("error");
    return;
  }

  const generatedAt = new Date().toISOString();
  const fallbackNarrative =
    `这一年，你在 ${stats.booksCount} 本集里记录了 ${stats.pages} 页，` +
    `放进 ${stats.photos} 个照片或视频、${stats.decorations} 个装饰素材。` +
    `最投入的是《${stats.topBooks[0]?.title || "你的第一本集"}》，它成为了这份年度回顾的主角。`;
  renderBookRecap(stats, generatedAt, "", true);
  bookSummaryButton.disabled = true;
  bookSummaryStatus.textContent = "正在翻阅你的集…";
  bookSummaryStatus.classList.remove("error");

  let narrative = fallbackNarrative;
  let usedApi = false;
  try {
    const response = await fetch("/api/book-summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        books: books.map((book) => ({
          title: book.title,
          chapters: book.chapters.map((chapter) => ({
            title: chapter.title,
            texts: chapter.texts,
            photos: chapter.photos,
            decorations: chapter.decorations,
          })),
        })),
      }),
    });
    const result = await response.json();
    if (response.ok && typeof result.report === "string" && result.report.trim()) {
      narrative = result.report.trim();
      usedApi = true;
    }
  } catch (error) {
    console.warn("Book recap API unavailable; using local narrative.", error);
  }

  setRecapNarrative(bookSummaryResult, narrative);
  saveReportRecord(BOOK_SUMMARY_STORAGE_KEY, {
    kind: "book",
    stats,
    narrative,
    generatedAt,
  });
  bookSummaryStatus.textContent = `ZINE 年度回顾已生成${usedApi ? " · AI 文字" : ""}`;
  bookSummaryButton.disabled = false;
}

async function startMePage() {
  if (window.ZineCloud) {
    ZineCloud.subscribe(renderAccountCard);
    try {
      await ZineCloud.ready;
    } catch (error) {
      console.error("Unable to finish account sync before opening the profile page.", error);
    }
  } else {
    renderAccountCard({ user: null, status: "offline" });
  }

  diariesByDate = readDiaries();
  loadSavedReport();
  loadSavedBookSummary();
  generateButton.addEventListener("click", generateReport);
  bookSummaryButton.addEventListener("click", generateBookSummary);
  bindRecapToggle(reportResult);
  bindRecapToggle(bookSummaryResult);
}

startMePage();
