"""Local, executable backend for the Sync-Think workbench demo.

Runs scoped, read-only repository tools and writes reports only in a demo-owned
scratch directory after an explicit in-page approval. No shell interpolation.
"""
from __future__ import annotations

import argparse
import copy
import json
import os
import re
import subprocess
import threading
import time
import uuid
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
SCRATCH = HERE / ".runtime"
RUNS: dict[str, dict] = {}
LOCK = threading.RLock()
MAX_OUTPUT = 12000


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def safe_output(text: str) -> str:
    if len(text) <= MAX_OUTPUT:
        return text
    return text[:MAX_OUTPUT] + f"\n… 已截断 {len(text) - MAX_OUTPUT} 个字符；完整输出仍在本机命令中。"


def command_parts(command: str) -> list[str]:
    """Only a small read-only command vocabulary is available in this demo."""
    text = command.strip()
    if text == "pwd":
        return ["python", "-c", "import os; print(os.getcwd())"]
    if text == "git status --short":
        return ["git", "status", "--short"]
    if text == "git log -1 --oneline":
        return ["git", "log", "-1", "--oneline"]
    if text == "rg --files":
        return ["rg", "--files", "apps/desktop/src/renderer/shell"]
    match = re.fullmatch(r"rg -n ([\w|.\-]{1,90}) (apps/desktop/src/[\w/.-]{1,140}|README\.md)", text)
    if match and ".." not in match.group(2):
        return ["rg", "-n", "--max-count", "6", match.group(1), match.group(2)]
    raise ValueError("此本地演示终端支持 pwd、git status --short、git log -1 --oneline、rg --files，以及限定目录的 rg -n 搜索。")


def execute(argv: list[str], timeout: int = 12) -> dict:
    started = time.monotonic()
    try:
        result = subprocess.run(argv, cwd=REPO, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout, shell=False)
        return {"output": (result.stdout or "") + (result.stderr or ""), "exitCode": result.returncode, "durationMs": round((time.monotonic() - started) * 1000)}
    except subprocess.TimeoutExpired as exc:
        return {"output": safe_output(str(exc.stdout or "") + "\n命令超过演示时限。"), "exitCode": 124, "durationMs": round((time.monotonic() - started) * 1000)}
    except (OSError, ValueError) as exc:
        return {"output": str(exc), "exitCode": 127, "durationMs": round((time.monotonic() - started) * 1000)}


def update(run_id: str, **changes) -> None:
    with LOCK:
        RUNS[run_id].update(changes)
        RUNS[run_id]["updatedAt"] = now()


def emit_tool(run_id: str, name: str, command: str, argv: list[str]) -> dict:
    event = {"id": uuid.uuid4().hex, "type": "tool", "name": name, "command": command,
             "status": "running", "startedAt": now(), "output": "", "durationMs": None, "exitCode": None}
    with LOCK:
        if RUNS[run_id]["status"] == "cancelled":
            return event
        RUNS[run_id]["events"].append(event)
        RUNS[run_id]["updatedAt"] = now()
    result = execute(argv)
    with LOCK:
        event.update(result, fullOutput=result["output"], output=safe_output(result["output"]), status="completed" if result["exitCode"] in (0, 1) else "failed", completedAt=now())
        RUNS[run_id]["updatedAt"] = now()
    return event


def wait_approval(run_id: str) -> bool:
    update(run_id, status="waiting_approval")
    with LOCK:
        RUNS[run_id]["approval"] = {"title": "写入演示报告", "description": "仅写入 Demo 自己的 .runtime/reports 目录；不会修改 Sync-Think 源码。", "path": ".runtime/reports/" + run_id + ".md"}
    while True:
        with LOCK:
            record = RUNS[run_id]
            if record["status"] == "cancelled":
                return False
            decision = record.get("decision")
            if decision is not None:
                record["approval"] = None
                record["status"] = "running"
                return bool(decision)
        time.sleep(0.12)


def run_worker(run_id: str) -> None:
    with LOCK:
        record = RUNS[run_id]
        prompt = record["prompt"]
    try:
        update(run_id, status="running")
        source = "apps/desktop/src/renderer/shell/InlineProcessFlow.tsx" if re.search("执行|输出|工具|命令|Cursor", prompt, re.I) else "apps/desktop/src/renderer/shell/ChatView.tsx"
        query = "tool|result|command" if source.endswith("InlineProcessFlow.tsx") else ("modelId|providerId|conversationId" if re.search("模型|定时|对话|model", prompt, re.I) else "browser|workspace|render")
        search_command = f"rg -n {query} {source}"
        search = emit_tool(run_id, "workspace.search", search_command, command_parts(search_command))
        with LOCK:
            if RUNS[run_id]["status"] == "cancelled":
                return
        source_path = REPO / source
        read_cmd = f"读取 {source}:1-32"
        read = emit_tool(run_id, "file.read", read_cmd, ["python", "-c", "from pathlib import Path; p=Path(r'" + str(source_path) + "'); print('\\n'.join(f'{i+1:>3} {line}' for i,line in enumerate(p.read_text(encoding='utf-8').splitlines()[:32])))"])
        with LOCK:
            if RUNS[run_id]["status"] == "cancelled":
                return
        status = emit_tool(run_id, "terminal.exec", "git status --short", command_parts("git status --short"))
        with LOCK:
            if RUNS[run_id]["status"] == "cancelled":
                return
        matched_lines = [line for line in search["output"].splitlines() if re.match(r"(?:apps/.*?:)?\d+:", line)]
        files = [line.split(":", 1)[0].replace("\\", "/") for line in matched_lines if line.startswith("apps/")]
        unique_files = list(dict.fromkeys(files))[:5] or ([source] if matched_lines else [])
        answer = (f"已在本地工作区执行 {len(RUNS[run_id]['events'])} 次工具调用。搜索命中 {len(matched_lines)} 行，涉及 {len(unique_files)} 个文件；"
                  f"读取了 {source} 的前 32 行；git status 返回码 {status['exitCode']}。"
                  + (" 搜索没有命中，可更换关键词再试。" if not matched_lines else " 可展开每张卡片核对命令、原始输出与耗时。"))
        if re.search("修改|修复|创建|生成报告|写入|保存", prompt):
            if wait_approval(run_id):
                SCRATCH.joinpath("reports").mkdir(parents=True, exist_ok=True)
                path = SCRATCH / "reports" / (run_id + ".md")
                report = f"# 本地执行报告\n\n任务：{prompt}\n\n执行时间：{now()}\n\n" + answer + "\n\n来源：\n" + "\n".join("- " + f for f in unique_files or [source]) + "\n"
                path.write_text(report, encoding="utf-8")
                with LOCK:
                    RUNS[run_id]["events"].append({"id": uuid.uuid4().hex, "type": "tool", "name": "file.patch", "command": str(path.relative_to(HERE)), "status": "completed", "startedAt": now(), "completedAt": now(), "output": report, "exitCode": 0, "durationMs": 1})
                answer += f" 已按审批写入演示报告 {path.relative_to(HERE)}。"
            else:
                answer += " 写入请求未获批准，工作区文件保持原样。"
        with LOCK:
            if RUNS[run_id]["status"] != "cancelled":
                RUNS[run_id].update(status="completed", answer=answer, sources=unique_files or [source], completedAt=now(), updatedAt=now())
    except Exception as exc:
        update(run_id, status="failed", answer=f"本地执行出错：{exc}", completedAt=now())


class DemoHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(HERE), **kwargs)

    def respond(self, status: int, data: dict) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length > 32_768:
            raise ValueError("请求内容过大")
        value = json.loads(self.rfile.read(length) or b"{}")
        if not isinstance(value, dict):
            raise ValueError("请求必须为对象")
        return value

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/health":
            self.respond(200, {"ok": True, "engine": "local-tools", "modelConnected": False, "repo": REPO.name})
            return
        match = re.fullmatch(r"/api/runs/([a-f0-9]{32})", path)
        if match:
            with LOCK:
                run = copy.deepcopy(RUNS.get(match.group(1)))
            if run:
                for event in run["events"]: event.pop("fullOutput", None)
            self.respond(200 if run else 404, run or {"error": "执行记录不存在"})
            return
        output_match = re.fullmatch(r"/api/runs/([a-f0-9]{32})/events/([a-f0-9]{32})/output", path)
        if output_match:
            with LOCK:
                record = RUNS.get(output_match.group(1))
                event = next((item for item in record["events"] if item["id"] == output_match.group(2)), None) if record else None
                payload = {"name": event["name"], "command": event["command"], "output": event.get("fullOutput", event["output"])} if event else None
            self.respond(200 if payload else 404, payload or {"error": "工具输出不存在"})
            return
        if path.startswith("/api/"):
            self.respond(404, {"error": "接口不存在"})
            return
        super().do_GET()

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        try:
            payload = self.body()
            if path == "/api/runs":
                prompt = str(payload.get("prompt", "")).strip()[:2000]
                if not prompt:
                    raise ValueError("请输入任务内容")
                run_id = uuid.uuid4().hex
                record = {"id": run_id, "prompt": prompt, "workspace": str(payload.get("workspace", "SYNC-THINK"))[:80],
                          "requestedModel": str(payload.get("model", ""))[:100], "thinking": str(payload.get("thinking", "中"))[:40],
                          "status": "queued", "events": [], "answer": "", "sources": [], "approval": None, "decision": None,
                          "executor": "local-tools", "createdAt": now(), "updatedAt": now()}
                with LOCK:
                    RUNS[run_id] = record
                threading.Thread(target=run_worker, args=(run_id,), daemon=True).start()
                self.respond(201, record)
                return
            match = re.fullmatch(r"/api/runs/([a-f0-9]{32})/(decision|cancel)", path)
            if match:
                with LOCK:
                    record = RUNS.get(match.group(1))
                    if not record:
                        self.respond(404, {"error": "执行记录不存在"})
                        return
                    if match.group(2) == "decision" and record["status"] == "waiting_approval":
                        record["decision"] = payload.get("approved") is True
                    elif match.group(2) == "cancel":
                        record["status"] = "cancelled"
                    else:
                        self.respond(409, {"error": "当前状态不接受此操作"})
                        return
                self.respond(200, {"ok": True})
                return
            if path == "/api/terminal":
                command = str(payload.get("command", ""))[:250]
                result = execute(command_parts(command))
                self.respond(200, {"command": command, **result, "output": safe_output(result["output"])})
                return
            self.respond(404, {"error": "接口不存在"})
        except (ValueError, json.JSONDecodeError) as exc:
            self.respond(400, {"error": str(exc)})


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Sync-Think interactive local workbench demo")
    parser.add_argument("--port", type=int, default=8775)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), DemoHandler)
    print(f"Sync-Think interactive demo: http://127.0.0.1:{args.port}/", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
