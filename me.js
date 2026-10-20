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

function loadSavedReport() {
  try {
    const saved = localStorage.getItem(REPORT_STORAGE_PREFIX + reportMonth);
    if (saved === null) return;
    const report = JSON.parse(saved);
    if (!report || typeof report.text !== "string" || typeof report.generatedAt !== "string") {
      throw new Error("Saved monthly report has an invalid format.");
    }
    showReport(report.text, report.generatedAt);
  } catch (error) {
    console.error("Unable to load the saved monthly report.", error);
    reportStatus.textContent = "读取上次生成的报告失败。";
    reportStatus.classList.add("error");
  }
}

function showReport(text, generatedAt) {
  reportResult.textContent = text;
  reportResult.hidden = false;
  reportResult.dataset.generatedAt = generatedAt;
}

async function generateReport() {
  const entries = Object.entries(diariesByDate)
    .filter(([date, text]) => date.startsWith(`${reportMonth}-`) && typeof text === "string" && text.trim())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, text]) => ({ date, text: text.trim() }));

  if (!entries.length) {
    reportStatus.textContent = "本月还没有已保存的日记，先写几篇再来生成总结吧。";
    reportStatus.classList.remove("error");
    return;
  }

  generateButton.disabled = true;
  reportStatus.textContent = "正在整理本月日记并生成报告…";
  reportStatus.classList.remove("error");

  try {
    const response = await fetch("/api/monthly-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month: reportMonth, entries }),
    });
    let result;
    try {
      result = await response.json();
    } catch (error) {
      throw new Error("AI 服务返回了无法识别的响应。");
    }
    if (!response.ok) {
      throw new Error(typeof result.error === "string" ? result.error : `报告生成失败（${response.status}）。`);
    }
    if (typeof result.report !== "string" || !result.report.trim()) {
      throw new Error("AI 服务没有返回报告内容。");
    }

    const generatedAt = new Date().toISOString();
    showReport(result.report.trim(), generatedAt);
    try {
      const saved = window.ZineCloud ? window.ZineCloud.setRecord(REPORT_STORAGE_PREFIX + reportMonth, {
        text: result.report.trim(),
        generatedAt,
      }) : (localStorage.setItem(REPORT_STORAGE_PREFIX + reportMonth, JSON.stringify({
        text: result.report.trim(),
        generatedAt,
      })), true);
      if (!saved) throw new Error("Unable to save the generated report locally.");
    } catch (error) {
      console.error("Unable to save the generated monthly report.", error);
      reportStatus.textContent = "报告已生成，但本地保存失败；请检查浏览器存储空间。";
      reportStatus.classList.add("error");
      return;
    }
    reportStatus.textContent = `报告已生成 · ${new Date(generatedAt).toLocaleString("zh-CN")}`;
  } catch (error) {
    console.error("Unable to generate the monthly AI report.", error);
    reportStatus.textContent = error instanceof TypeError
      ? "无法连接本地 AI 服务。请在项目目录启动后端，并通过 http://127.0.0.1:8765/me.html 打开页面。"
      : error.message;
    reportStatus.classList.add("error");
  } finally {
    generateButton.disabled = false;
  }
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
    console.error("Unable to read saved books for the AI summary.", error);
    bookSummaryStatus.textContent = "无法读取集存档，请检查浏览器存储。";
    bookSummaryStatus.classList.add("error");
    return null;
  }

  return books
    .map((book) => {
      const titles = Array.isArray(book.chapters) ? book.chapters : [];
      const chapters = titles.map((title) => {
        const chapter = { title: String(title), texts: [], photos: 0, decorations: 0 };
        try {
          const storageKey = `zine_chapter_${encodeURIComponent(book.id)}_${encodeURIComponent(title)}`;
          const raw = localStorage.getItem(storageKey);
          if (raw !== null) {
            const parsed = JSON.parse(raw);
            const pages = Array.isArray(parsed)
              ? parsed
              : parsed && Array.isArray(parsed.pages)
                ? parsed.pages
                : [];
            pages.forEach((page) => {
              if (!Array.isArray(page)) return;
              page.forEach((element) => {
                if (!element || typeof element !== "object") return;
                if (
                  (element.type === "text" || element.type === "note" || element.type === "label")
                  && typeof element.content === "string"
                  && element.content.trim()
                ) {
                  chapter.texts.push(element.content.trim().slice(0, 1200));
                } else if (element.type === "photo" || element.type === "video") {
                  chapter.photos += 1;
                } else if (element.type === "sticker" || element.type === "washi") {
                  chapter.decorations += 1;
                }
              });
            });
          }
        } catch (error) {
          console.error("Unable to read chapter content for the AI summary.", error);
        }
        chapter.texts = chapter.texts.slice(0, 60);
        return chapter;
      });
      return {
        title: typeof book.title === "string" && book.title.trim() ? book.title.trim() : "未命名集",
        chapters,
      };
    })
    .filter((book) => book.chapters.length > 0);
}

function showBookSummary(text, generatedAt) {
  bookSummaryResult.textContent = text;
  bookSummaryResult.hidden = false;
  bookSummaryResult.dataset.generatedAt = generatedAt;
}

function loadSavedBookSummary() {
  try {
    const saved = localStorage.getItem(BOOK_SUMMARY_STORAGE_KEY);
    if (saved === null) return;
    const summary = JSON.parse(saved);
    if (!summary || typeof summary.text !== "string" || typeof summary.generatedAt !== "string") {
      throw new Error("Saved book summary has an invalid format.");
    }
    showBookSummary(summary.text, summary.generatedAt);
  } catch (error) {
    console.error("Unable to load the saved book summary.", error);
    bookSummaryStatus.textContent = "读取上次的集总结失败。";
    bookSummaryStatus.classList.add("error");
  }
}

async function generateBookSummary() {
  const books = collectBookContent();
  if (books === null) return;
  const totalChapters = books.reduce((sum, book) => sum + book.chapters.length, 0);
  if (!books.length || !totalChapters) {
    bookSummaryStatus.textContent = "还没有创建带章节的集，先去首页新建一本吧。";
    bookSummaryStatus.classList.remove("error");
    return;
  }

  bookSummaryButton.disabled = true;
  bookSummaryStatus.textContent = "正在翻阅你的集并生成总结…";
  bookSummaryStatus.classList.remove("error");
  bookSummaryResult.hidden = true;

  try {
    const response = await fetch("/api/book-summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ books }),
    });
    let result;
    try {
      result = await response.json();
    } catch (error) {
      throw new Error("AI 服务返回了无法识别的响应。");
    }
    if (!response.ok) {
      throw new Error(typeof result.error === "string" ? result.error : `总结生成失败（${response.status}）。`);
    }
    if (typeof result.report !== "string" || !result.report.trim()) {
      throw new Error("AI 服务没有返回总结内容。");
    }

    const generatedAt = new Date().toISOString();
    showBookSummary(result.report.trim(), generatedAt);
    const summaryPayload = { text: result.report.trim(), generatedAt };
    const saved = window.ZineCloud
      ? window.ZineCloud.setRecord(BOOK_SUMMARY_STORAGE_KEY, summaryPayload)
      : (localStorage.setItem(BOOK_SUMMARY_STORAGE_KEY, JSON.stringify(summaryPayload)), true);
    if (!saved) throw new Error("Unable to save the book summary locally.");
    bookSummaryStatus.textContent = `总结已生成 · ${new Date(generatedAt).toLocaleString("zh-CN")}`;
  } catch (error) {
    console.error("Unable to generate the AI book summary.", error);
    bookSummaryStatus.textContent = error instanceof TypeError
      ? "无法连接本地 AI 服务。请在项目目录启动后端，并通过 http://127.0.0.1:8765/me.html 打开页面。"
      : error.message;
    bookSummaryStatus.classList.add("error");
  } finally {
    bookSummaryButton.disabled = false;
  }
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
}

startMePage();
