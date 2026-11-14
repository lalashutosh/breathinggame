#!/usr/bin/env python3
"""Hand a scoped coding task to a Verda (Modal, OpenAI-compatible) model.

Usage:
  python3 tools/verda_task.py --task task.md --out path/to/file.gd [--ctx a.gd b.gd] [--tier strong|fast]

The model must answer with exactly one fenced code block; that block is written to --out.
Spend is appended to tools/verda_spend.log and refused past BUDGET_VERDA_USD.
"""
import argparse, json, os, re, sys, time, urllib.request, urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOG = ROOT / "tools" / "verda_spend.log"

SYSTEM = """You are a senior Godot 4.7 engineer writing production GDScript / Godot shader code.
Rules:
- Godot 4.x syntax ONLY (no Godot 3 APIs: use @export, @onready, super(), signal.emit(), Callable, PackedFloat32Array, etc.).
- Static typing where reasonable. Tabs for indentation in .gd files.
- Build everything procedurally in code (no external assets, no .tscn editing) unless told otherwise.
- Do not invent engine APIs. If unsure, choose the simpler well-known API.
- Answer with EXACTLY ONE fenced code block containing the full file. No prose before or after."""


def load_env():
    env = {}
    for line in (ROOT / ".env").read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def spent():
    if not LOG.exists():
        return 0.0
    return sum(float(l.split("\t")[1]) for l in LOG.read_text().splitlines() if "\t" in l)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--task", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--ctx", nargs="*", default=[])
    ap.add_argument("--tier", default="strong", choices=["strong", "fast"])
    ap.add_argument("--max-tokens", type=int, default=48000)
    a = ap.parse_args()

    env = load_env()
    T = a.tier.upper()
    base = env.get(f"VERDA_BASE_URL_{T}") or env.get("VERDA_BASE_URL")
    model = env[f"VERDA_MODEL_{T}"]
    budget = float(env.get("BUDGET_VERDA_USD", "0") or 0)
    if budget and spent() >= budget:
        sys.exit(f"budget reached ({spent():.2f} / {budget})")

    user = Path(a.task).read_text()
    for c in a.ctx:
        user += f"\n\n--- context file: {c} ---\n```\n{(ROOT / c).read_text()}\n```"

    headers = {"Content-Type": "application/json"}
    if env.get("VERDA_API_KEY"):
        headers["Authorization"] = "Bearer " + env["VERDA_API_KEY"]
    else:
        headers["Modal-Key"] = env["MODAL_TOKEN_ID"]
        headers["Modal-Secret"] = env["MODAL_TOKEN_SECRET"]

    body = json.dumps({
        "model": model,
        "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}],
        "max_tokens": a.max_tokens,
        "temperature": 0.3,
    }).encode()
    req = urllib.request.Request(base.rstrip("/") + "/chat/completions", data=body, headers=headers)
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=900) as r:
            resp = json.loads(r.read())
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code}: {e.read()[:500].decode(errors='replace')}")

    msg = resp["choices"][0]["message"]["content"] or ""
    u = resp.get("usage", {})
    pin = float(env.get(f"VERDA_PRICE_{T}_IN", 0) or 0)
    pout = float(env.get(f"VERDA_PRICE_{T}_OUT", 0) or 0)
    cost = (u.get("prompt_tokens", 0) * pin + u.get("completion_tokens", 0) * pout) / 1e6
    with LOG.open("a") as f:
        f.write(f"{time.strftime('%H:%M:%S')}\t{cost:.4f}\t{a.tier}\t{a.out}\n")

    blocks = re.findall(r"```[a-zA-Z0-9_]*\n(.*?)```", msg, re.S)
    if resp["choices"][0].get("finish_reason") == "length":
        Path(a.out + ".raw.txt").write_text(msg)
        sys.exit(f"truncated at max_tokens; raw saved to {a.out}.raw.txt")
    if not blocks:
        Path(a.out + ".raw.txt").write_text(msg)
        sys.exit(f"no code block; raw saved to {a.out}.raw.txt")
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(max(blocks, key=len).rstrip() + "\n")
    print(f"ok {a.out}  {u.get('completion_tokens', '?')} tok  ${cost:.3f}  {time.time()-t0:.0f}s  total ${spent():.2f}")


if __name__ == "__main__":
    main()
