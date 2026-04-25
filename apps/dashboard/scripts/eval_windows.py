#!/usr/bin/env python3
import os, sys, datetime as dt, math, csv, pathlib
from collections import defaultdict
from pymongo import MongoClient

# --- Config
COUNTIES = ["brazoria", "fortbend", "galveston", "harris", "jefferson"]
SIMPLE_COLL = {
    "brazoria": "simple_brazoria",
    "fortbend": "simple_fortbend",
    "galveston": "simple_galveston",
    "harris":   "simple_harris",
    "jefferson":"simple_jefferson",
}

# raw/source collections (for optional cross-check)
SOURCE_COLL = {
    "brazoria": {"name": "brazoria_inmates", "bond": ["bond_total","charges.bond/type"], "date": ["booking_date_iso","booking_date","first_seen_at"]},
    "fortbend": {"name": "fortbend_inmates", "bond": ["charges.bail_amount_int","charges.bail_amount"], "date": ["booking_date_iso","detail_fetched_at","first_seen_at"]},
    "galveston": {"name": "galveston_events", "bond": ["total_bond"], "date": ["booked_at","arrest_date"]},
    "jefferson": {"name": "jefferson_events", "bond": ["total_bond"], "date": ["booked_at","arrest_date"]},
    # We intentionally exclude MISFEL; BOND + NAFILING are used
    "harris": [
        {"name": "harris_bond",     "bond": ["bond_amount"], "date": ["file_date"]},
        {"name": "harris_nafiling", "bond": ["bond_amount"], "date": ["file_date"]},
    ],
}

# --- Helpers
def now_utc():
    return dt.datetime.now(dt.timezone.utc)

def floor_to_date(d):
    return dt.datetime(d.year, d.month, d.day, tzinfo=dt.timezone.utc)

def parse_date_any(x):
    # supports 'YYYY-MM-DD', MM/DD/YYYY or full ISO string; returns aware UTC
    if not x: return None
    if isinstance(x, dt.datetime):
        return x if x.tzinfo else x.replace(tzinfo=dt.timezone.utc)
    s = str(x)
    try:
        if len(s) == 10 and s[4] == "-" and s[7] == "-":
            y,m,d = map(int, s.split("-"))
            return dt.datetime(y,m,d, tzinfo=dt.timezone.utc)
        if len(s) == 10 and s[2] == "/" and s[5] == "/":
            m,d,y = map(int, s.split("/"))
            return dt.datetime(y,m,d, tzinfo=dt.timezone.utc)
        # fallback ISO parser
        return dt.datetime.fromisoformat(s.replace("Z","+00:00"))
    except Exception:
        return None

def hours_ago(d):
    return (now_utc() - d).total_seconds()/3600.0

def pick_first(doc, keys, default=None):
    for k in keys:
        if "." in k:
            parts = k.split(".")
            val = doc
            for p in parts:
                if isinstance(val, dict) and p in val:
                    val = val[p]
                else:
                    val = None
                    break
            if val not in (None, "", " "):
                return val
        else:
            if k in doc and doc[k] not in (None, "", " "):
                return doc[k]
    return default

def money(n):
    return f"${int(round(n)):,.0f}"

# --- Core window classifier
def bucket_0_24_48_72(book_dt):
    if not book_dt: return None
    h = hours_ago(book_dt)
    if h < 0:
        return None
    if h <= 24: return "24h"
    if h <= 48: return "48h"
    if h <= 72: return "72h"
    return None

def ensure_reports_dir():
    out = pathlib.Path("debug_reports")
    out.mkdir(parents=True, exist_ok=True)
    return out

# --- Simple collections query
def eval_simple(db):
    results = defaultdict(lambda: {"24h":{"count":0,"sum":0.0},
                                   "48h":{"count":0,"sum":0.0},
                                   "72h":{"count":0,"sum":0.0}})
    for county, coll_name in SIMPLE_COLL.items():
        coll = db[coll_name]
        # light projection to speed up
        cursor = coll.find({}, {"booking_date":1, "bond_amount":1, "bond":1})
        for doc in cursor:
            bdate = parse_date_any(doc.get("booking_date"))
            bucket = bucket_0_24_48_72(bdate)
            if not bucket: continue
            bond = doc.get("bond_amount", None)
            if bond is None:
                bond = doc.get("bond", 0)
            try:
                v = float(bond) if bond not in (None,"") else 0.0
            except Exception:
                v = 0.0
            results[county][bucket]["count"] += 1
            results[county][bucket]["sum"] += v
    return results

# --- Source collections query (optional)
def eval_sources(db):
    results = defaultdict(lambda: {"24h":{"count":0,"sum":0.0},
                                   "48h":{"count":0,"sum":0.0},
                                   "72h":{"count":0,"sum":0.0}})
    for county, meta in SOURCE_COLL.items():
        metas = meta if isinstance(meta, list) else [meta]
        for m in metas:
            coll = db[m["name"]]
            cursor = coll.find({}, {k:1 for k in set(m["bond"]+m["date"])})
            for doc in cursor:
                bdate_raw = pick_first(doc, m["date"])
                bdate = parse_date_any(bdate_raw)
                bucket = bucket_0_24_48_72(bdate)
                if not bucket: continue
                bond_raw = pick_first(doc, m["bond"], 0)
                v = 0.0
                try:
                    if isinstance(bond_raw, str):
                        s = bond_raw.strip().replace("$","").replace(",","")
                        v = float(s) if s else 0.0
                    elif isinstance(bond_raw, dict):
                        if "$numberInt" in bond_raw:
                            v = float(bond_raw["$numberInt"])
                        elif "$numberDouble" in bond_raw:
                            v = float(bond_raw["$numberDouble"])
                        else:
                            v = 0.0
                    else:
                        v = float(bond_raw) if bond_raw not in (None,"") else 0.0
                except Exception:
                    v = 0.0
                results[county][bucket]["count"] += 1
                results[county][bucket]["sum"] += v
    return results

def write_reports(ts, kind, results):
    outdir = ensure_reports_dir()
    txt = outdir / f"windows_{kind}_{ts}.txt"
    csvp = outdir / f"windows_{kind}_{ts}.csv"

    # text
    with open(txt, "w", encoding="utf-8") as f:
        f.write(f"Window Evaluation ({kind}) @ {ts}\n")
        f.write("="*60 + "\n\n")
        for c in COUNTIES:
            r = results.get(c, {})
            f.write(f"{c.title()}:\n")
            for b in ("24h","48h","72h"):
                d = r.get(b, {"count":0,"sum":0})
                f.write(f"  {b:>3}: count={d['count']:>5}  sum={money(d['sum'])}\n")
            f.write("\n")

    # csv
    with open(csvp, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["county","window","count","sum_bond"])
        for c in COUNTIES:
            for b in ("24h","48h","72h"):
                d = results.get(c, {}).get(b, {"count":0,"sum":0})
                w.writerow([c, b, d["count"], f"{d['sum']:.2f}"])

    return txt, csvp

def main():
    uri = os.environ.get("MONGO_URI")
    dbname = os.environ.get("MONGO_DB", "warrantdb")
    mode = (sys.argv[1] if len(sys.argv) > 1 else "both").lower()

    if not uri:
        print("ERROR: set MONGO_URI and (optionally) MONGO_DB.", file=sys.stderr)
        sys.exit(2)

    client = MongoClient(uri, serverSelectionTimeoutMS=15_000)
    db = client[dbname]

    ts = dt.datetime.utcnow().strftime("%Y%m%d_%H%M")
    did_any = False

    if mode in ("both","simple"):
        simple = eval_simple(db)
        t, c = write_reports(ts, "simple", simple)
        print(f"[simple] wrote:\n  {t}\n  {c}")
        did_any = True

    if mode in ("both","source"):
        src = eval_sources(db)
        t, c = write_reports(ts, "source", src)
        print(f"[source] wrote:\n  {t}\n  {c}")
        did_any = True

    if not did_any:
        print("Usage: python3 eval_windows.py [both|simple|source]")
        sys.exit(1)

if __name__ == "__main__":
    main()