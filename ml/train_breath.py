#!/usr/bin/env python3
"""
ml/train_breath.py - train the ΑΝΑΣΑ breath phase model from recorded sessions.

    python3 ml/train_breath.py                         # dataset/raw -> web/models/breath.json
    python3 ml/train_breath.py --data dataset/synthetic --out /tmp/breath.json

Each session is <id>.wav (16 kHz mono) + <id>.json from the recorder (web/tools/breath-recorder.html):
    {"segments": [{"t0": 0.0, "t1": 5.0, "label": "quiet"}, {"t0": 5.2, "t1": 7.9, "label": "in"}, ...]}
Labels: in -> in, out -> out, anything else (quiet, noise, talk, pause) -> rest. Unlabelled time is skipped.

Evaluation holds out whole sessions (leave-one-session-out when there are 2+), then reports:
  frame accuracy + confusion, and on the tracked phases: switch timing error, missed/extra switches,
  in/out duration error and breath period error. The final model is trained on everything.
"""
import argparse
import glob
import json
import os
import sys
import time
import wave

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import breath_model as bm  # noqa: E402

LABEL_TO_CLASS = {"in": 1, "out": 2}


def load_wav(path):
    with wave.open(path, "rb") as w:
        sr, ch, sw = w.getframerate(), w.getnchannels(), w.getsampwidth()
        raw = w.readframes(w.getnframes())
    if sw != 2:
        raise ValueError(f"{path}: expected 16-bit PCM")
    x = np.frombuffer(raw, dtype="<i2").astype(np.float64) / 32768.0
    if ch > 1:
        x = x.reshape(-1, ch).mean(1)
    if sr != bm.SR:
        from scipy.signal import resample_poly
        g = np.gcd(sr, bm.SR)
        x = resample_poly(x, bm.SR // g, sr // g)
    return x


def load_sessions(folder, margin):
    sessions = []
    for js in sorted(glob.glob(os.path.join(folder, "*.json"))):
        wav = js[:-5] + ".wav"
        if not os.path.exists(wav):
            continue
        meta = json.load(open(js))
        pcm = load_wav(wav)
        times, feats = bm.features_for_signal(pcm)
        y = np.full(len(times), -1)
        for seg in meta.get("segments", []):
            if seg["label"] == "skip":  # hand-marked bad labels: left out of training
                continue
            k = LABEL_TO_CLASS.get(seg["label"], 0)
            m = (times >= seg["t0"] + margin) & (times < seg["t1"] - margin)
            y[m] = k
        keep = y >= 0
        sessions.append({"id": os.path.basename(js)[:-5], "times": times, "X": feats, "y": y, "keep": keep,
                         "segments": meta.get("segments", []), "meta": meta})
        print(f"  {sessions[-1]['id']}: {len(pcm) / bm.SR:6.1f} s  frames {keep.sum():5d}  "
              f"in {np.sum(y == 1):4d}  out {np.sum(y == 2):4d}  rest {np.sum(y == 0):4d}")
    return sessions


def balance(X, y, rng):
    idx = [np.where(y == k)[0] for k in range(3)]
    cap = int(1.5 * max(len(idx[1]), len(idx[2]), 1))
    if len(idx[0]) > cap:
        idx[0] = rng.choice(idx[0], cap, replace=False)
    sel = np.concatenate(idx)
    return X[sel], y[sel]


def fit(X, y, seed=0):
    from sklearn.neural_network import MLPClassifier
    from sklearn.preprocessing import StandardScaler
    rng = np.random.default_rng(seed)
    Xb, yb = balance(X, y, rng)
    sc = StandardScaler().fit(Xb)
    clf = MLPClassifier(hidden_layer_sizes=(32,), activation="relu", alpha=1e-3, max_iter=500,
                        early_stopping=True, n_iter_no_change=20, random_state=seed)
    clf.fit(sc.transform(Xb), yb)
    if list(clf.classes_) != [0, 1, 2]:
        raise SystemExit("training data needs all three classes (rest, in, out)")
    return sc, clf


def export(sc, clf, metrics, post):
    return {
        "version": 1, "created": time.strftime("%Y-%m-%d %H:%M"),
        "sr": bm.SR, "n": bm.N, "hop": bm.HOP, "nmel": bm.NMEL, "fmin": bm.FMIN, "fmax": bm.FMAX,
        "W": bm.W, "WS": bm.WS, "floor": {"down": bm.FLOOR_DOWN, "up": bm.FLOOR_UP},
        "classes": bm.CLASSES,
        "scaler": {"mean": sc.mean_.tolist(), "scale": sc.scale_.tolist()},
        "layers": [{"W": w.tolist(), "b": b.tolist()} for w, b in zip(clf.coefs_, clf.intercepts_)],
        "post": post, "metrics": metrics,
    }


def true_events(segments):
    """Ground-truth switches (time, new phase) and in/out durations from the labels."""
    seq = sorted((s["t0"], s["t1"], s["label"]) for s in segments if s["label"] in ("in", "out"))
    switches = [(t0, lab) for t0, _, lab in seq]
    durs = {"in": [t1 - t0 for t0, t1, lab in seq if lab == "in"], "out": [t1 - t0 for t0, t1, lab in seq if lab == "out"]}
    ins = [t0 for t0, _, lab in seq if lab == "in"]
    periods = list(np.diff(ins)) if len(ins) > 1 else []
    return switches, durs, periods


def tracked_events(times, probs, post):
    tr = bm.PhaseTracker(post["alpha"], post["thr"], post["minFrames"])
    switches, phases = [], []
    prev = "rest"
    t_prev = None
    for t, p in zip(times, probs):
        dt = bm.FRAME_S if t_prev is None else t - t_prev
        t_prev = t
        tr.t = t - dt
        s = tr.update(p, dt)
        if s["phase"] != prev:
            switches.append((t - s["since"], s["phase"]))
            prev = s["phase"]
    # durations of predicted in/out runs
    durs = {"in": [], "out": []}
    for (t0, ph), (t1, _) in zip(switches, switches[1:]):
        if ph in durs:
            durs[ph].append(t1 - t0)
    ins = [t for t, ph in switches if ph == "in"]
    return [(t, ph) for t, ph in switches if ph in ("in", "out")], durs, list(np.diff(ins)) if len(ins) > 1 else []


def event_metrics(true_sw, pred_sw, tol=1.0):
    used, errs, hit = set(), [], 0
    for t, ph in true_sw:
        best = None
        for j, (pt, pph) in enumerate(pred_sw):
            if j in used or pph != ph or abs(pt - t) > tol:
                continue
            if best is None or abs(pt - t) < abs(pred_sw[best][0] - t):
                best = j
        if best is not None:
            used.add(best)
            hit += 1
            errs.append(pred_sw[best][0] - t)
    return {"switches": len(true_sw), "found": hit, "missed": len(true_sw) - hit, "extra": len(pred_sw) - len(used),
            "timing_median_s": float(np.median(np.abs(errs))) if errs else None,
            "timing_bias_s": float(np.mean(errs)) if errs else None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=os.path.join("dataset", "raw"))
    ap.add_argument("--out", default=os.path.join("web", "models", "breath.json"))
    ap.add_argument("--margin", type=float, default=0.08, help="seconds trimmed at label edges (key reaction time)")
    a = ap.parse_args()

    print(f"sessions in {a.data}:")
    S = load_sessions(a.data, a.margin)
    if not S:
        raise SystemExit("no sessions found - record some with /tools/breath-recorder.html")
    post = {"alpha": 0.25, "thr": 0.55, "minFrames": 15}

    # ---- held-out evaluation
    folds = [[i] for i in range(len(S))] if len(S) > 1 else None
    conf = np.zeros((3, 3), int)
    ev = {"switches": 0, "found": 0, "missed": 0, "extra": 0}
    terr, dur_err, per_err = [], [], []
    if folds:
        plan = [(f, [j for j in range(len(S)) if j not in f]) for f in folds]
    else:  # one session: train on the first 70 %, test on the rest
        s = S[0]
        cut = int(0.7 * len(s["times"]))
        tr_s = dict(s, X=s["X"][:cut], y=s["y"][:cut], keep=s["keep"][:cut], times=s["times"][:cut])
        te_s = dict(s, X=s["X"][cut:], y=s["y"][cut:], keep=s["keep"][cut:], times=s["times"][cut:],
                    segments=[g for g in s["segments"] if g["t0"] >= s["times"][cut]])
        S = [tr_s, te_s]
        plan = [([1], [0])]
        print("  (only one session: holding out its last 30 %)")
    for test_idx, train_idx in plan:
        X = np.concatenate([S[j]["X"][S[j]["keep"]] for j in train_idx])
        y = np.concatenate([S[j]["y"][S[j]["keep"]] for j in train_idx])
        sc, clf = fit(X, y)
        for j in test_idx:
            s = S[j]
            probs = clf.predict_proba(sc.transform(s["X"]))
            k = s["keep"]
            pred = probs.argmax(1)
            for t_, p_ in zip(s["y"][k], pred[k]):
                conf[t_, p_] += 1
            tsw, tdur, tper = true_events(s["segments"])
            psw, pdur, pper = tracked_events(s["times"], probs, post)
            m = event_metrics(tsw, psw)
            for key in ev:
                ev[key] += m[key]
            if m["timing_median_s"] is not None:
                terr.append(m["timing_median_s"])
            for ph in ("in", "out"):
                if tdur[ph] and pdur[ph]:
                    dur_err.append(abs(np.median(pdur[ph]) - np.median(tdur[ph])))
            if tper and pper:
                per_err.append(abs(np.median(pper) - np.median(tper)))
    acc = np.trace(conf) / max(conf.sum(), 1)
    metrics = {
        "held_out_frame_accuracy": round(float(acc), 3),
        "confusion_rows_true_rest_in_out": conf.tolist(),
        "switches": ev,
        "switch_timing_median_s": round(float(np.median(terr)), 3) if terr else None,
        "duration_median_abs_error_s": round(float(np.median(dur_err)), 3) if dur_err else None,
        "period_median_abs_error_s": round(float(np.median(per_err)), 3) if per_err else None,
        "sessions": len(folds) if folds else 1,
    }
    print("\nheld-out results")
    print(f"  frame accuracy        {acc:.1%}")
    print("  confusion (rows = true rest/in/out, cols = predicted)")
    for name, row in zip(bm.CLASSES, conf):
        print(f"    {name:>4}  {row}")
    print(f"  switches found        {ev['found']}/{ev['switches']}   missed {ev['missed']}   extra {ev['extra']}")
    print(f"  switch timing error   {metrics['switch_timing_median_s']} s (median)")
    print(f"  in/out duration error {metrics['duration_median_abs_error_s']} s (median)")
    print(f"  breath period error   {metrics['period_median_abs_error_s']} s (median)")

    # ---- final model on everything
    S_all = load_sessions(a.data, a.margin) if not folds else S
    X = np.concatenate([s["X"][s["keep"]] for s in S_all])
    y = np.concatenate([s["y"][s["keep"]] for s in S_all])
    sc, clf = fit(X, y)
    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    with open(a.out, "w") as f:
        json.dump(export(sc, clf, metrics, post), f)
    print(f"\nmodel written to {a.out}  ({os.path.getsize(a.out) // 1024} KB)")


if __name__ == "__main__":
    main()
