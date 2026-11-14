#!/usr/bin/env python3
"""
serve.py - serve the MindPlay landing page and a tiny shared-garden API.

    python3 serve.py                 # http://localhost:8000
    python3 serve.py --port 8080 --data garden.json --open

The page works as plain static files too (the garden then lives in the browser's
localStorage). With this server running, every visitor sees the same garden:

    GET  /api/garden                      -> {"version": 1, "contributions": [...]}
    POST /api/garden/contributions        <- {"type","kind","slot":{"col","row"},"gameId","visitorId"}
                                          -> 201 the stored contribution, 409 if the slot is taken
"""
import argparse
import shutil
import subprocess
from urllib.parse import urlparse, parse_qs
import json
import os
import threading
import time
import uuid
import webbrowser
from datetime import datetime, timedelta, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(ROOT, "web")
COLS, ROWS = 9, 5
KINDS = {"apple", "cherry", "birch", "pine"}
TYPES = {"tree"}
SCHEMA_VERSION = 1


def _ago(hours):
    return (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()


def seed_contributions():
    """Mirror of SEED_CONTRIBUTIONS in web/js/garden/store.js."""
    rows = [
        ("apple", 1, 1, 300), ("pine", 7, 0, 260), ("cherry", 4, 2, 200), ("birch", 8, 3, 150),
        ("apple", 2, 4, 60), ("pine", 6, 3, 20), ("cherry", 0, 3, 3), ("birch", 8, 1, 0.5),
    ]
    return [
        {"id": f"seed-{i + 1}", "type": "tree", "kind": kind, "slot": {"col": c, "row": r},
         "plantedAt": _ago(h), "visitorId": "seed", "gameId": "breath-dive"}
        for i, (kind, c, r, h) in enumerate(rows)
    ]


class GardenData:
    def __init__(self, path):
        self.path = path
        self.lock = threading.Lock()
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                self.data = json.load(f)
        else:
            self.data = {"version": SCHEMA_VERSION, "contributions": seed_contributions()}
            self._save()

    def _save(self):
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.data, f, indent=1)
        os.replace(tmp, self.path)

    def snapshot(self):
        with self.lock:
            return json.dumps(self.data)

    def plant(self, body):
        kind = body.get("kind")
        slot = body.get("slot") or {}
        col, row = slot.get("col"), slot.get("row")
        if body.get("type", "tree") not in TYPES or kind not in KINDS:
            return 400, {"error": "unknown contribution type or kind"}
        if not (isinstance(col, int) and isinstance(row, int) and 0 <= col < COLS and 0 <= row < ROWS):
            return 400, {"error": "slot out of range"}
        with self.lock:
            for c in self.data["contributions"]:
                if c["slot"]["col"] == col and c["slot"]["row"] == row:
                    return 409, {"error": "slot taken"}
            item = {
                "id": "c_" + uuid.uuid4().hex[:12],
                "type": body.get("type", "tree"),
                "kind": kind,
                "slot": {"col": col, "row": row},
                "plantedAt": datetime.now(timezone.utc).isoformat(),
                "visitorId": str(body.get("visitorId") or "anon")[:64],
                "gameId": (str(body.get("gameId"))[:64] if body.get("gameId") else None),
            }
            self.data["contributions"].append(item)
            self._save()
        return 201, item


class GreenfoldLauncher:
    """Starts the Godot build of Greenfold (the immersive valley) in its own window and
    collects the result it reports back when the walk ends."""

    def __init__(self, base_url):
        self.base_url = base_url
        self.project = os.path.join(ROOT, "greenfold")
        self.godot = os.environ.get("GODOT_BIN") or shutil.which("godot") or shutil.which("godot4")
        self.proc = None
        self.results = {}
        self.lock = threading.Lock()

    def available(self):
        return bool(self.godot) and os.path.exists(os.path.join(self.project, "project.godot"))

    def launch(self, mode=None):
        if not self.available():
            return 501, {"error": "Godot or the greenfold project was not found on this machine"}
        with self.lock:
            if self.proc and self.proc.poll() is None:
                self.proc.terminate()
            sid = uuid.uuid4().hex[:12]
            args = [self.godot, "--path", self.project, "--fullscreen", "--",
                    f"--report={self.base_url}api/greenfold/result", f"--session={sid}", "--hub"]
            if mode:
                args.append(f"--mode={mode}")
            self.proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return 202, {"session": sid}

    def report(self, body):
        sid = str(body.get("session", ""))
        if not sid:
            return 400, {"error": "missing session"}
        with self.lock:
            self.results[sid] = body
        return 201, {"ok": True}

    def result(self, sid):
        with self.lock:
            if sid in self.results:
                return 200, {"done": True, "result": self.results[sid]}
            running = bool(self.proc and self.proc.poll() is None)
        return 200, {"done": False, "running": running}


class Handler(SimpleHTTPRequestHandler):
    garden = None  # set in main
    greenfold = None  # set in main

    def _json(self, status, payload):
        raw = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        route = self.path.split("?")[0]
        if route == "/api/greenfold/status":
            return self._json(200, {"available": self.greenfold.available()})
        if route == "/api/greenfold/result":
            sid = parse_qs(urlparse(self.path).query).get("session", [""])[0]
            return self._json(*self.greenfold.result(sid))
        if self.path.split("?")[0] == "/api/garden":
            raw = self.garden.snapshot().encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return
        return super().do_GET()

    def do_POST(self):
        route = self.path.split("?")[0]
        if route not in ("/api/garden/contributions", "/api/greenfold/launch", "/api/greenfold/result"):
            return self._json(404, {"error": "not found"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return self._json(400, {"error": "bad json"})
        if route == "/api/greenfold/launch":
            return self._json(*self.greenfold.launch(body.get("mode")))
        if route == "/api/greenfold/result":
            return self._json(*self.greenfold.report(body))
        status, payload = self.garden.plant(body)
        self._json(status, payload)

    def end_headers(self):
        if self.path.endswith((".js", ".css", ".html")) or self.path == "/":
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        if "/api/" in (args[0] if args else ""):
            super().log_message(fmt, *args)


def main():
    ap = argparse.ArgumentParser(description="MindPlay landing page + shared garden API")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--data", default=os.path.join(ROOT, "garden.json"), help="where to keep the garden (JSON)")
    ap.add_argument("--open", action="store_true", help="open the page in a browser")
    args = ap.parse_args()

    Handler.garden = GardenData(args.data)
    url = f"http://{args.host}:{args.port}/"
    Handler.greenfold = GreenfoldLauncher(url)
    handler = partial(Handler, directory=WEB)
    httpd = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"MindPlay garden at {url}  (data: {args.data})")
    if args.open:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()
