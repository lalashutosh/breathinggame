#!/usr/bin/env python3
"""
serve.py - serve the ΑΝΑΣΑ (anasa) garden page and a tiny shared-garden API.

    python3 serve.py                 # http://localhost:8000
    python3 serve.py --port 8080 --data garden.json --open

The page works as plain static files too (the garden then lives in the browser's
localStorage). With this server running, every visitor sees the same garden:

    GET  /api/garden                      -> {"version": 1, "contributions": [...]}
    POST /api/garden/contributions        <- {"type","kind","slot":{"col","row"},"gameId","visitorId",
                                              "visitorName","gardenId"}
                                          -> 201 the stored contribution, 409 if the slot is taken

Friends' gardens (community play). Every player can own one personal garden, found by a
short code. A friend who opens an invite joins a "run": what they earn is planted in the
host's garden instead of their own.

    GET  /api/garden?g=<code>             -> that garden: {"version", "contributions", "garden": meta}
    POST /api/gardens                     <- {"visitorId","name"}  -> create or rename my garden (meta)
    POST /api/gardens/<code>/join         <- {"visitorId","name"}  -> 200 meta (helper registered)
    POST /api/gardens/<code>/leave        <- {"visitorId"}         -> 200 meta
"""
import argparse
import shutil
import subprocess
import sys
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
SCHEMA_VERSION = 2


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


CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
CODE_RE = __import__("re").compile(r"^[A-Z0-9]{4,8}$")
HELPER_TTL = 3 * 3600  # a run lasts a few hours unless the helper leaves first


def _clean_name(v, fallback="A friend"):
    v = " ".join(str(v or "").split())[:24]
    return v or fallback


class GardenData:
    """The community garden plus one personal garden per player.

    File layout (version 2):
      {"version": 2, "contributions": [...community...],
       "gardens": {code: {"code","name","ownerId","created","contributions":[...],
                          "helpers": {visitorId: {"name","joinedAt","lastSeen","planted"}}}}}
    A version 1 file (community only) is upgraded in place.
    """

    def __init__(self, path):
        self.path = path
        self.lock = threading.Lock()
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                self.data = json.load(f)
        else:
            self.data = {"version": SCHEMA_VERSION, "contributions": seed_contributions()}
        self.data.setdefault("gardens", {})
        self.data["version"] = SCHEMA_VERSION
        self._save()

    def _save(self):
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.data, f, indent=1)
        os.replace(tmp, self.path)

    # ------------------------------------------------------------- helpers
    def _garden(self, code):
        if not code or code == "community":
            return None
        return self.data["gardens"].get(str(code).upper())

    def _meta(self, g):
        now = time.time()
        helpers = []
        for vid, h in g.get("helpers", {}).items():
            if h.get("left") or now - h.get("lastSeen", 0) > HELPER_TTL:
                continue
            helpers.append({"name": h["name"], "planted": h.get("planted", 0), "joinedAt": h.get("joinedAt"),
                            "id": vid[-6:]})
        helpers.sort(key=lambda h: h.get("joinedAt") or "")
        return {"code": g["code"], "name": g["name"], "owner": g["ownerId"][-6:], "created": g["created"],
                "helpers": helpers, "count": len(g["contributions"])}

    def _new_code(self):
        import secrets
        while True:
            code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))
            if code not in self.data["gardens"]:
                return code

    # ------------------------------------------------------------- reads
    def snapshot(self, code=None):
        with self.lock:
            if not code or code == "community":
                return 200, {"version": SCHEMA_VERSION, "contributions": self.data["contributions"]}
            g = self._garden(code)
            if not g:
                return 404, {"error": "no garden with that code"}
            return 200, {"version": SCHEMA_VERSION, "contributions": g["contributions"], "garden": self._meta(g)}

    # ------------------------------------------------------------- personal gardens
    def ensure_garden(self, body):
        vid = str(body.get("visitorId") or "")[:64]
        if not vid:
            return 400, {"error": "missing visitorId"}
        name = _clean_name(body.get("name"), "")
        with self.lock:
            g = next((g for g in self.data["gardens"].values() if g["ownerId"] == vid), None)
            if not g:
                code = self._new_code()
                g = {"code": code, "name": name or "My garden", "ownerId": vid,
                     "created": datetime.now(timezone.utc).isoformat(), "contributions": [], "helpers": {}}
                self.data["gardens"][code] = g
            elif name:
                g["name"] = name
            self._save()
            return 200, self._meta(g)

    def join(self, code, body, leave=False):
        vid = str(body.get("visitorId") or "")[:64]
        if not vid:
            return 400, {"error": "missing visitorId"}
        with self.lock:
            g = self._garden(code)
            if not g:
                return 404, {"error": "no garden with that code"}
            if g["ownerId"] == vid:
                return 409, {"error": "this is your own garden"}
            helpers = g.setdefault("helpers", {})
            if leave:
                if vid in helpers:
                    helpers[vid]["left"] = True
            else:
                h = helpers.get(vid) or {"planted": 0}
                fresh = h.get("left") or time.time() - h.get("lastSeen", 0) > HELPER_TTL
                h.update({"name": _clean_name(body.get("name")), "lastSeen": time.time(), "left": False})
                if fresh or "joinedAt" not in h:
                    h["joinedAt"] = datetime.now(timezone.utc).isoformat()
                    h["planted"] = 0
                helpers[vid] = h
            self._save()
            return 200, self._meta(g)

    # ------------------------------------------------------------- planting
    def plant(self, body):
        kind = body.get("kind")
        slot = body.get("slot") or {}
        col, row = slot.get("col"), slot.get("row")
        if body.get("type", "tree") not in TYPES or kind not in KINDS:
            return 400, {"error": "unknown contribution type or kind"}
        if not (isinstance(col, int) and isinstance(row, int) and 0 <= col < COLS and 0 <= row < ROWS):
            return 400, {"error": "slot out of range"}
        code = body.get("gardenId")
        vid = str(body.get("visitorId") or "anon")[:64]
        with self.lock:
            if code and code != "community":
                g = self._garden(code)
                if not g:
                    return 404, {"error": "no garden with that code"}
                h = g.get("helpers", {}).get(vid)
                is_helper = h and not h.get("left") and time.time() - h.get("lastSeen", 0) <= HELPER_TTL
                if g["ownerId"] != vid and not is_helper:
                    return 403, {"error": "join this garden's run to plant here"}
                target = g["contributions"]
            else:
                g, h, target = None, None, self.data["contributions"]
            for c in target:
                if c["slot"]["col"] == col and c["slot"]["row"] == row:
                    return 409, {"error": "slot taken"}
            item = {
                "id": "c_" + uuid.uuid4().hex[:12],
                "type": body.get("type", "tree"),
                "kind": kind,
                "slot": {"col": col, "row": row},
                "plantedAt": datetime.now(timezone.utc).isoformat(),
                "visitorId": vid,
                "visitorName": _clean_name(body.get("visitorName"), "") or None,
                "gameId": (str(body.get("gameId"))[:64] if body.get("gameId") else None),
            }
            target.append(item)
            if g is not None and g["ownerId"] != vid:
                h["planted"] = h.get("planted", 0) + 1
                h["lastSeen"] = time.time()
            self._save()
        return 201, item


def list_mics():
    """Microphones on this machine as PipeWire/PulseAudio sources: [{"name", "label"}].
    The sensor bridge opens one by name, which works at 16 kHz where raw device indexes may not."""
    exe = shutil.which("pactl")
    if not exe:
        return []
    try:
        out = subprocess.run([exe, "-f", "json", "list", "sources"], capture_output=True, text=True, timeout=3).stdout
        sources = json.loads(out or "[]")
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
        return []
    return [{"name": s.get("name", ""), "label": s.get("description") or s.get("name", "")}
            for s in sources
            if s.get("name") and not s["name"].endswith(".monitor")]


class GreenfoldLauncher:
    """Starts the Godot build of Greenfold (the immersive valley) in its own window and
    collects the result it reports back when the walk ends."""

    def __init__(self, base_url):
        self.base_url = base_url
        self.project = os.path.join(ROOT, "greenfold")
        self.godot = os.environ.get("GODOT_BIN") or shutil.which("godot") or shutil.which("godot4")
        self.proc = None
        self.bridge = None
        self.results = {}
        self.sensors = {}
        self.sensors_t = 0.0
        self.lock = threading.Lock()
        venv_py = os.path.join(ROOT, "sensors", ".venv", "bin", "python")
        self.sensor_python = venv_py if os.path.exists(venv_py) else sys.executable

    def available(self):
        return bool(self.godot) and os.path.exists(os.path.join(self.project, "project.godot"))

    def launch(self, mode=None, mic=False, heart=False, mic_source=None):
        if not self.available():
            return 501, {"error": "Godot or the greenfold project was not found on this machine"}
        with self.lock:
            if self.proc and self.proc.poll() is None:
                self.proc.terminate()
            self._stop_bridge()
            sid = uuid.uuid4().hex[:12]
            args = [self.godot, "--path", self.project, "--fullscreen", "--",
                    f"--report={self.base_url}api/greenfold/result", f"--session={sid}", "--hub"]
            if mode:
                args.append(f"--mode={mode}")
            if mic or heart:
                # the sensor bridge reuses breathdive.py's mic + Bluetooth code and posts to /api/sensors
                bargs = [self.sensor_python, os.path.join(ROOT, "sensors", "bridge.py"), "--post", f"{self.base_url}api/sensors"]
                if mic:
                    bargs.append("--mic")
                    if mic_source:
                        bargs += ["--source", mic_source]
                if heart:
                    bargs.append("--hr")
                self.sensors, self.sensors_t = {}, 0.0
                self.bridge = subprocess.Popen(bargs, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                               env={**os.environ, "PYGAME_HIDE_SUPPORT_PROMPT": "1"})
                args.append(f"--sensors={self.base_url}api/sensors")
            self.proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            proc = self.proc
        threading.Thread(target=self._reap, args=(proc,), daemon=True).start()
        return 202, {"session": sid, "sensors": bool(mic or heart)}

    def _reap(self, proc):
        proc.wait()
        with self.lock:
            if proc is self.proc:
                self._stop_bridge()

    def _stop_bridge(self):
        if self.bridge and self.bridge.poll() is None:
            self.bridge.terminate()
        self.bridge = None

    def push_sensors(self, body):
        with self.lock:
            self.sensors, self.sensors_t = body, time.time()
        return 200, {"ok": True}

    def get_sensors(self):
        with self.lock:
            return 200, {**self.sensors, "age": round(time.time() - self.sensors_t, 2) if self.sensors_t else 99}

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


DATASET = os.path.join(ROOT, "dataset", "raw")
SESSION_ID = __import__("re").compile(r"^[A-Za-z0-9_-]{1,80}$")


def dataset_list():
    out = []
    if os.path.isdir(DATASET):
        for name in sorted(os.listdir(DATASET)):
            if not name.endswith(".json"):
                continue
            sid = name[:-5]
            try:
                meta = json.load(open(os.path.join(DATASET, name)))
            except (OSError, json.JSONDecodeError):
                continue
            segs = meta.get("segments", [])
            out.append({"id": sid, "seconds": meta.get("seconds"), "created": meta.get("created"),
                        "breaths": sum(1 for g in segs if g.get("label") == "in"),
                        "hasAudio": os.path.exists(os.path.join(DATASET, sid + ".wav"))})
    return out


def train_model():
    py = os.path.join(ROOT, "sensors", ".venv", "bin", "python")
    py = py if os.path.exists(py) else sys.executable
    r = subprocess.run([py, os.path.join(ROOT, "ml", "train_breath.py")], cwd=ROOT, capture_output=True, text=True, timeout=900)
    log = "\n".join(l for l in (r.stdout + r.stderr).splitlines() if "RuntimeWarning" not in l and "avx2" not in l)
    return (200 if r.returncode == 0 else 500), {"ok": r.returncode == 0, "log": log}


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
            return self._json(200, {"available": self.greenfold.available(),
                                    "sensors": os.path.exists(os.path.join(ROOT, "sensors", "bridge.py"))})
        if route == "/api/sensors":
            return self._json(*self.greenfold.get_sensors())
        if route == "/api/mics":
            return self._json(200, {"mics": list_mics()})
        if route == "/api/dataset":
            return self._json(200, {"sessions": dataset_list()})
        if route == "/api/greenfold/result":
            sid = parse_qs(urlparse(self.path).query).get("session", [""])[0]
            return self._json(*self.greenfold.result(sid))
        if route == "/api/garden":
            code = parse_qs(urlparse(self.path).query).get("g", [""])[0]
            return self._json(*self.garden.snapshot(code))
        return super().do_GET()

    def do_POST(self):
        route = self.path.split("?")[0]
        if route.startswith("/api/dataset/"):
            return self._dataset_post(route[len("/api/dataset/"):])
        if route == "/api/model/train":
            return self._json(*train_model())
        friends = route == "/api/gardens" or (route.startswith("/api/gardens/") and route.rsplit("/", 1)[-1] in ("join", "leave"))
        if not friends and route not in ("/api/garden/contributions", "/api/greenfold/launch", "/api/greenfold/result", "/api/sensors"):
            return self._json(404, {"error": "not found"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return self._json(400, {"error": "bad json"})
        if route == "/api/greenfold/launch":
            src = body.get("micSource")
            known = {m["name"] for m in list_mics()}
            return self._json(*self.greenfold.launch(body.get("mode"), bool(body.get("mic")), bool(body.get("heart")),
                                                     src if isinstance(src, str) and src in known else None))
        if not isinstance(body, dict):
            return self._json(400, {"error": "expected a json object"})
        if route == "/api/gardens":
            return self._json(*self.garden.ensure_garden(body))
        if friends:
            parts = route.split("/")  # ['', 'api', 'gardens', code, action]
            if len(parts) != 5 or not CODE_RE.match(parts[3].upper()):
                return self._json(400, {"error": "bad garden code"})
            return self._json(*self.garden.join(parts[3], body, leave=parts[4] == "leave"))
        if route == "/api/sensors":
            return self._json(*self.greenfold.push_sensors(body))
        if route == "/api/greenfold/result":
            return self._json(*self.greenfold.report(body))
        status, payload = self.garden.plant(body)
        self._json(status, payload)

    def _dataset_post(self, name):
        sid, _, ext = name.rpartition(".")
        if ext not in ("wav", "json") or not SESSION_ID.match(sid):
            return self._json(400, {"error": "bad session name"})
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > 80 * 1024 * 1024:
            return self._json(413, {"error": "empty or too large"})
        data = self.rfile.read(n)
        if ext == "json":
            try:
                json.loads(data)
            except json.JSONDecodeError:
                return self._json(400, {"error": "bad json"})
        elif data[:4] != b"RIFF":
            return self._json(400, {"error": "not a wav file"})
        os.makedirs(DATASET, exist_ok=True)
        with open(os.path.join(DATASET, f"{sid}.{ext}"), "wb") as f:
            f.write(data)
        return self._json(201, {"saved": f"{sid}.{ext}", "bytes": n})

    def end_headers(self):
        if self.path.endswith((".js", ".css", ".html")) or self.path == "/":
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        if "/api/" in (args[0] if args else ""):
            super().log_message(fmt, *args)


def main():
    ap = argparse.ArgumentParser(description="ΑΝΑΣΑ garden page + shared garden API")
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
    print(f"ΑΝΑΣΑ garden at {url}  (data: {args.data})")
    if args.open:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()
