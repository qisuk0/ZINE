const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";
const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_ENTRY_LENGTH = 12000;
const MAX_TOTAL_TEXT_LENGTH = 50000;
const OPENAI_TIMEOUT_MS = 8500;
const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function sendJson(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function isValidIsoDate(value) {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isValidIsoMonth(value) {
  if (!MONTH_PATTERN.test(value)) return false;
  const [year, month] = value.split("-").map(Number);
  return 2000 <= year && year <= 2050 && 1 <= month && month <= 12;
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object") {
    return { error: "请求内容无效。" };
  }
  const month = payload.month;
  if (typeof month !== "string" || !isValidIsoMonth(month)) {
    return { error: "月份格式无效。" };
  }
  const entries = payload.entries;
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 31) {
    return { error: "报告需要 1 到 31 篇本月日记。" };
  }

  const [year, monthNumber] = month.split("-").map(Number);
  const normalized = [];
  let totalLength = 0;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      return { error: "日记格式无效。" };
    }
    const dateValue = entry.date;
    const text = entry.text;
    if (
      typeof dateValue !== "string" ||
      !DATE_PATTERN.test(dateValue) ||
      !isValidIsoDate(dateValue) ||
      typeof text !== "string" ||
      !text.trim() ||
      text.length > MAX_ENTRY_LENGTH
    ) {
      return { error: "日记日期或内容无效。" };
    }
    if (dateValue.slice(0, 7) !== month) {
      return { error: "日记必须属于所选月份。" };
    }
    totalLength += text.length;
    normalized.push({ date: dateValue, text: text.trim() });
  }
  if (totalLength > MAX_TOTAL_TEXT_LENGTH) {
    return { error: "本月日记总长度过大，请减少内容后重试。" };
  }
  return { month, entries: normalized };
}

export default async function handler(request) {
  if (request.method !== "POST") {
    return sendJson(404, { error: "接口不存在。" });
  }

  const origin = request.headers.get("origin");
  const host = new URL(request.url).host;
  if (origin && new URL(origin).host !== host) {
    return sendJson(403, { error: "请求来源无效，请从 ZINE 页面发起请求。" });
  }

  const apiKey = (process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    return sendJson(503, { error: "未配置 OPENAI_API_KEY。请先在 Netlify 环境变量中设置 API 密钥。" });
  }

  const contentLength = Number(request.headers.get("content-length") || "0");
  if (!Number.isFinite(contentLength) || contentLength <= 0 || contentLength > MAX_REQUEST_BYTES) {
    return sendJson(413, { error: "日记内容过大，请缩短后重试。" });
  }

  let payload;
  try {
    payload = JSON.parse(await request.text());
  } catch {
    return sendJson(400, { error: "请求内容无效。" });
  }

  const validated = validatePayload(payload);
  if (validated.error) {
    return sendJson(400, { error: validated.error });
  }

  const journalText = validated.entries
    .map((entry) => `【${entry.date}】\n${entry.text}`)
    .join("\n\n");

  const requestBody = {
    model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
    temperature: 0.7,
    messages: [
      {
        role: "system",
        content:
          "你是一位温柔、细腻的私人日记整理助手。" +
          "只基于用户提供的日记写中文月度回顾，不要推断或诊断心理/健康状况，" +
          "不要添加日记没有提到的事实。使用温暖、不评判的语气，" +
          "突出真实出现的主题、重要瞬间、情绪变化和值得珍藏的细节。" +
          "输出包含「本月关键词」「值得记住的瞬间」「情绪与主题」「写给下个月的自己」四个小标题，" +
          "避免重复原文长句。",
      },
      {
        role: "user",
        content: `请总结 ${validated.month} 的 ${validated.entries.length} 篇日记：\n\n${journalText}`,
      },
    ],
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } catch (error) {
    if (error && error.name === "AbortError") {
      return sendJson(504, { error: "AI 生成超时，请减少日记篇数或长度后重试。" });
    }
    return sendJson(502, { error: "无法连接 OpenAI 服务，请稍后重试。" });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      return sendJson(502, { error: "OpenAI API 密钥无效或无权调用，请检查 Netlify 环境变量。" });
    }
    if (response.status === 429) {
      return sendJson(502, { error: "OpenAI 请求次数或额度已达限制，请稍后重试。" });
    }
    return sendJson(502, { error: `OpenAI 服务暂时不可用（HTTP ${response.status}），请稍后重试。` });
  }

  let result;
  try {
    result = await response.json();
    const report = result.choices[0].message.content;
    if (typeof report !== "string" || !report.trim()) {
      throw new Error("empty report");
    }
    return sendJson(200, { report: report.trim() });
  } catch {
    return sendJson(502, { error: "OpenAI 返回的报告格式无效，请稍后重试。" });
  }
}
