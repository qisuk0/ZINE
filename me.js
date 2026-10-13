const DIARIES_STORAGE_KEY = "zine_diaries_v1";
const REPORT_STORAGE_PREFIX = "zine_monthly_report_";
const generateButton = document.getElementById("generateReportBtn");
const reportDescription = document.getElementById("reportDescription");
const reportStatus = document.getElementById("reportStatus");
const reportResult = document.getElementById("reportResult");
const now = new Date();
const reportMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
const diariesByDate = readDiaries();

reportDescription.textContent = `${now.getFullYear()}年${now.getMonth() + 1}月 · 基于本月已保存的日记生成`;
loadSavedReport();
generateButton.addEventListener("click", generateReport);

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
      localStorage.setItem(REPORT_STORAGE_PREFIX + reportMonth, JSON.stringify({
        text: result.report.trim(),
        generatedAt,
      }));
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
