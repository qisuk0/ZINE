import json
import os
import re
from datetime import date as calendar_date
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
HOST = "127.0.0.1"
PORT = int(os.environ.get("ZINE_PORT", "8765"))
OPENAI_URL = "https://api.openai.com/v1/chat/completions"
DEFAULT_MODEL = "gpt-4o-mini"
MAX_REQUEST_BYTES = 256 * 1024
MAX_ENTRY_LENGTH = 12000
MAX_TOTAL_TEXT_LENGTH = 50000


class ZineHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/api/monthly-report":
            self.send_json(404, {"error": "接口不存在。"})
            return

        expected_origin = f"http://{HOST}:{PORT}"
        if self.headers.get("Origin") != expected_origin or self.headers.get("Host") != f"{HOST}:{PORT}":
            self.send_json(403, {"error": "请求来源无效，请从本地 ZINE 页面发起请求。"})
            return

        api_key = os.environ.get("OPENAI_API_KEY", "").strip()
        if not api_key:
            self.send_json(503, {"error": "未配置 OPENAI_API_KEY。请先在启动后端的终端设置 API 密钥。"})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_json(400, {"error": "请求长度无效。"})
            return
        if content_length <= 0 or content_length > MAX_REQUEST_BYTES:
            self.send_json(413, {"error": "日记内容过大，请缩短后重试。"})
            return

        try:
            payload = json.loads(self.rfile.read(content_length))
            entries = payload.get("entries")
            month = payload.get("month")
            if not isinstance(month, str) or not re.fullmatch(r"\d{4}-\d{2}", month):
                raise ValueError("月份格式无效。")
            year, month_number = map(int, month.split("-"))
            if not 2000 <= year <= 2050 or not 1 <= month_number <= 12:
                raise ValueError("月份超出日历范围。")
            if not isinstance(entries, list) or not entries or len(entries) > 31:
                raise ValueError("报告需要 1 到 31 篇本月日记。")

            normalized_entries = []
            total_length = 0
            for entry in entries:
                if not isinstance(entry, dict):
                    raise ValueError("日记格式无效。")
                date_value = entry.get("date")
                text = entry.get("text")
                if (
                    not isinstance(date_value, str)
                    or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date_value)
                    or not isinstance(text, str)
                    or not text.strip()
                    or len(text) > MAX_ENTRY_LENGTH
                ):
                    raise ValueError("日记日期或内容无效。")
                try:
                    parsed_date = calendar_date.fromisoformat(date_value)
                except ValueError as error:
                    raise ValueError("日记日期无效。") from error
                if date_value[:7] != month or parsed_date.year != year or parsed_date.month != month_number:
                    raise ValueError("日记必须属于所选月份。")
                total_length += len(text)
                normalized_entries.append({"date": date_value, "text": text.strip()})
            if total_length > MAX_TOTAL_TEXT_LENGTH:
                raise ValueError("本月日记总长度过大，请减少内容后重试。")
        except (UnicodeDecodeError, json.JSONDecodeError, AttributeError, ValueError) as error:
            self.send_json(400, {"error": str(error) or "请求内容无效。"})
            return

        journal_text = "\n\n".join(
            f"【{entry['date']}】\n{entry['text']}" for entry in normalized_entries
        )
        request_body = {
            "model": os.environ.get("OPENAI_MODEL", DEFAULT_MODEL),
            "temperature": 0.7,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "你是一位温柔、细腻的私人日记整理助手。"
                        "只基于用户提供的日记写中文月度回顾，不要推断或诊断心理/健康状况，"
                        "不要添加日记没有提到的事实。使用温暖、不评判的语气，"
                        "突出真实出现的主题、重要瞬间、情绪变化和值得珍藏的细节。"
                        "输出包含「本月关键词」「值得记住的瞬间」「情绪与主题」「写给下个月的自己」四个小标题，"
                        "避免重复原文长句。"
                    ),
                },
                {
                    "role": "user",
                    "content": f"请总结 {month} 的 {len(normalized_entries)} 篇日记：\n\n{journal_text}",
                },
            ],
        }
        request = Request(
            OPENAI_URL,
            data=json.dumps(request_body, ensure_ascii=False).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )

        try:
            with urlopen(request, timeout=90) as response:
                result = json.loads(response.read())
            report = result["choices"][0]["message"]["content"]
            if not isinstance(report, str) or not report.strip():
                raise ValueError("AI 服务返回的报告内容为空。")
            self.send_json(200, {"report": report.strip()})
        except HTTPError as error:
            if error.code in (401, 403):
                self.send_json(502, {"error": "OpenAI API 密钥无效或无权调用，请检查后端环境变量。"})
            elif error.code == 429:
                self.send_json(502, {"error": "OpenAI 请求次数或额度已达限制，请稍后重试。"})
            else:
                self.send_json(502, {"error": f"OpenAI 服务暂时不可用（HTTP {error.code}），请稍后重试。"})
        except (URLError, TimeoutError):
            self.send_json(502, {"error": "无法连接 OpenAI 服务，请检查网络后重试。"})
        except (KeyError, IndexError, TypeError, json.JSONDecodeError, ValueError) as error:
            print(f"Invalid OpenAI response: {error}")
            self.send_json(502, {"error": "OpenAI 返回的报告格式无效，请稍后重试。"})

    def log_message(self, format_string, *args):
        # Keep request logs useful without ever logging journal request bodies.
        super().log_message(format_string, *args)


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), ZineHandler)
    print(f"ZINE is available at http://{HOST}:{PORT}/me.html")
    if not os.environ.get("OPENAI_API_KEY"):
        print("OPENAI_API_KEY is not set; AI report generation will return a configuration error.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping ZINE local server.")
    finally:
        server.server_close()
