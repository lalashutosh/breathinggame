#!/usr/bin/env python3
"""Copy every garden from the Vercel deployment's Upstash Redis into garden.json,
so the laptop backup (serve.py) carries on with the same trees, gardens and codes.

Needs the Redis REST credentials. Fetch them once with:
    npx vercel env pull .env.vercel --environment production
This script reads KV_REST_API_URL / KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_*) from the
environment or from .env.vercel. The existing garden.json is kept as garden.json.bak.
"""
import json
import os
import shutil
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "garden.json")


def load_env():
    env = dict(os.environ)
    path = os.path.join(ROOT, ".env.vercel")
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            k, sep, v = line.strip().partition("=")
            if sep and not k.startswith("#"):
                env.setdefault(k, v.strip().strip('"'))
    url = env.get("KV_REST_API_URL") or env.get("UPSTASH_REDIS_REST_URL")
    token = env.get("KV_REST_API_TOKEN") or env.get("UPSTASH_REDIS_REST_TOKEN")
    if not url or not token:
        sys.exit("No Redis credentials. Run: npx vercel env pull .env.vercel --environment production")
    return url, token


def main():
    url, token = load_env()

    def redis(*cmd):
        req = urllib.request.Request(url, data=json.dumps(cmd).encode(), method="POST",
                                     headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
        out = json.load(urllib.request.urlopen(req, timeout=15))
        if out.get("error"):
            sys.exit(f"Redis error: {out['error']}")
        return out["result"]

    def hash_values(key):
        flat = redis("HGETALL", key) or []
        return {flat[i]: json.loads(flat[i + 1]) for i in range(0, len(flat), 2)}

    def contributions(gid):
        return sorted(hash_values(f"g:{gid}:slots").values(), key=lambda c: c["plantedAt"])

    data = {"version": 2, "contributions": contributions("community"), "gardens": {}}
    cursor = "0"
    while True:
        cursor, keys = redis("SCAN", cursor, "MATCH", "g:*:meta", "COUNT", "200")
        for key in keys:
            meta = json.loads(redis("GET", key))
            code = meta["code"]
            helpers = {}
            for vid, h in hash_values(f"g:{code}:helpers").items():
                h["lastSeen"] = h.get("lastSeen", 0) / 1000  # JS ms -> python seconds
                helpers[vid] = h
            data["gardens"][code] = {**meta, "contributions": contributions(code), "helpers": helpers}
        if cursor == "0":
            break

    if not data["contributions"]:
        sys.exit("The community garden on Vercel is empty; not overwriting garden.json.")
    if os.path.exists(OUT):
        shutil.copy(OUT, OUT + ".bak")
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1)
    print(f"Saved {len(data['contributions'])} community trees and {len(data['gardens'])} personal gardens to garden.json")


if __name__ == "__main__":
    main()
