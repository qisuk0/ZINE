const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";
const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_TEXT_LENGTH = 12000;
const MAX_TOTAL_TEXT_LENGTH = 50000;
const OPENAI_TIMEOUT_MS = 8500;

const SYSTEM_PROMPT =
  "你是一位温柔、细腻的独立手账杂志编辑。" +
  "只基于用户提供的集（zine）内容写中文总结，不要编造集里没有的内容。" +
  "从章节标题、文字内容和照片、贴纸等元素的分布中提炼主题与亮点，" +
  "语气温暖、具体、不评判。" +
  "输出包含「整体印象」「每集亮点」「出现的主题」「继续创作的小建议」四个小标题，" +
  "避免重复原文长句，总结控制在 400 字以内。";

function sendJson(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object") {
    return { error: "请求内容无效。" };
  }
  const books = payload.books;
  if (!Array.isArray(books) || books.length === 0 || books.length > 20) {
    return { error: "总结需要 1 到 20 本集。" };
  }

  let totalLength = 0;
  const normalized = [];
  for (const book of books) {
    if (!book || typeof book !== "object") return { error: "集格式无效。" };
    const title = book.title;
    const chapters = book.chapters;
    if (typeof title !== "string" || !title.trim() || title.length > 60) {
      return { error: "集标题无效。" };
    }
    if (!Array.isArray(chapters) || chapters.length > 30) {
      return { error: "章节数量无效。" };
    }

    const normalizedChapters = [];
    for (const chapter of chapters) {
      if (!chapter || typeof chapter !== "object") return { error: "章节格式无效。" };
      const chapterTitle = chapter.title;
      const texts = chapter.texts;
      const photos = chapter.photos;
      const decorations = chapter.decorations;
      if (typeof chapterTitle !== "string" || !chapterTitle.trim() || chapterTitle.length > 60) {
        return { error: "章节标题无效。" };
      }
      if (
        !Array.isArray(texts)
        || texts.length > 60
        || !texts.every((text) => typeof text === "string" && text.trim() && text.length <= MAX_TEXT_LENGTH)
      ) {
        return { error: "章节文字内容无效。" };
      }
      if (
        !Number.isInteger(photos)
        || photos < 0
        || photos > 999
        || !Number.isInteger(decorations)
        || decorations < 0
        || decorations > 999
      ) {
        return { error: "章节统计信息无效。" };
      }
      totalLength += texts.reduce((sum, text) => sum + text.length, 0);
      normalizedChapters.push({
        title: chapterTitle.trim(),
        texts: texts.map((text) => text.trim()),
        photos,
        decorations,
      });
    }
    normalized.push({ title: title.trim(), chapters: normalizedChapters });
  }
  if (totalLength > MAX_TOTAL_TEXT_LENGTH) {
    return { error: "集内容总长度过大，请减少内容后重试。" };
  }
  return { books: normalized };
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
    return sendJson(413, { error: "集内容过大，请缩短后重试。" });
  }

  let payload;
  try {
    payload = JSON.parse(await request.text());
  } catch {
    return sendJson(400, { error: "请求内容无效。" });
  }
  const validated = validatePayload(payload);
  if (validated.error) return sendJson(400, { error: validated.error });

  const bookText = validated.books
    .map((book, index) => {
      const chapterLines = book.chapters.map((chapter) => {
        const stats = `照片/视频 ${chapter.photos} 个，贴纸/胶带 ${chapter.decorations} 个`;
        const text = chapter.texts.length
          ? chapter.texts.join("；")
          : "本章没有文字";
        return `- 章节《${chapter.title}》：${text}（${stats}）`;
      });
      return `【集 ${index + 1}】${book.title}\n${chapterLines.join("\n")}`;
    })
    .join("\n\n");

  const requestBody = {
    model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
    temperature: 0.7,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `这是我的 ${validated.books.length} 本手账集，请根据内容写一篇总结：\n\n${bookText}`,
      },
    ],
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  const baseUrl = (process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  let response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
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
      return sendJson(504, { error: "AI 生成超时，请减少集内容后重试。" });
    }
    return sendJson(502, { error: "无法连接 AI 服务，请稍后重试。" });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      return sendJson(502, { error: "AI API 密钥无效或无权调用，请检查 Netlify 环境变量。" });
    }
    if (response.status === 429) {
      return sendJson(502, { error: "AI 请求次数或额度已达限制，请稍后重试。" });
    }
    return sendJson(502, { error: `AI 服务暂时不可用（HTTP ${response.status}）。` });
  }

  try {
    const result = await response.json();
    const report = result.choices[0].message.content;
    if (typeof report !== "string" || !report.trim()) throw new Error("empty report");
    return sendJson(200, { report: report.trim() });
  } catch {
    return sendJson(502, { error: "AI 返回的总结格式无效，请稍后重试。" });
  }
}
