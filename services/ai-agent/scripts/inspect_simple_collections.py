# Usage: python scripts/inspect_simple_collections.py
# Summarize fields in simple_* collections and check against expected webhook fields.

import json
from collections import defaultdict
import sys, pathlib, os, re

EXPECTED_FIELDS = {
    "_id",
    "full_name",
    "first_name",
    "last_name",
    "dob",
    "county",
    "booking_date",
    "bond",
    "bond_amount",
    "booking_number",
    "normalized_at",
    "category",
}

SIMPLE = ["harris", "brazoria", "galveston", "fortbend"]


def type_of(v):
    import bson
    if v is None:
        return "null"
    if isinstance(v, list):
        return "array"
    if isinstance(v, bson.ObjectId):
        return "ObjectId"
    return type(v).__name__


def summarize_collection(db, name: str):
    col = db[name]
    total = col.estimated_document_count()
    if total == 0:
        return {"name": name, "total": 0, "fields": {}, "samples": []}

    # Try to sort by booking_date if present, else sample
    try:
        cur = col.find({}).sort([("booking_date", -1)]).limit(20)
    except Exception:
        cur = col.aggregate([{"$sample": {"size": 20}}])

    fields = defaultdict(set)
    samples = []
    for i, doc in enumerate(cur):
        samples.append(doc)
        for k, v in doc.items():
            fields[k].add(type_of(v))

    field_summary = {k: sorted(list(v)) for k, v in fields.items()}

    # Alignment check
    present = set(field_summary.keys())
    missing = sorted(list(EXPECTED_FIELDS - present))
    extras = sorted(list(present - EXPECTED_FIELDS))

    return {
        "name": name,
        "total": total,
        "fields": field_summary,
        "present_expected": sorted(list(present & EXPECTED_FIELDS)),
        "missing_expected": missing,
        "extra_fields": extras,
        "sampleCount": len(samples),
        "samples_preview": [
            {k: doc.get(k) for k in [
                "_id","full_name","first_name","last_name","dob",
                "county","booking_date","bond","bond_amount",
                "booking_number","normalized_at","category"
            ] if k in doc}
            for doc in samples[:3]
        ]
    }


def read_env(path: pathlib.Path) -> dict:
    env = {}
    if not path.exists():
        return env
    line_re = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$")
    with path.open() as f:
        for raw in f:
            s = raw.strip()
            if not s or s.startswith('#'):
                continue
            m = line_re.match(s)
            if not m:
                continue
            k, v = m.group(1), m.group(2)
            # Strip surrounding quotes if present
            if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
                v = v[1:-1]
            env[k] = v
    return env


def main():
    # Load Mongo config from .env without instantiating app settings
    ROOT = pathlib.Path(__file__).resolve().parent.parent
    env = read_env(ROOT / '.env')
    mongo_uri = env.get('MONGO_URI') or os.environ.get('MONGO_URI')
    mongo_db = env.get('MONGO_DB') or os.environ.get('MONGO_DB')
    if not mongo_uri or not mongo_db:
        print(json.dumps({
            "error": "Missing MONGO_URI or MONGO_DB in .env or environment",
            "have_MONGO_URI": bool(mongo_uri),
            "have_MONGO_DB": bool(mongo_db)
        }, indent=2))
        sys.exit(2)

    from pymongo import MongoClient
    client = MongoClient(mongo_uri)
    _db = client[mongo_db]

    names = [f"simple_{c}" for c in SIMPLE if f"simple_{c}" in _db.list_collection_names()]

    report = {
        "database": _db.name,
        "collections": []
    }

    if not names:
        report["note"] = "No simple_* collections found"
    else:
        for n in names:
            report["collections"].append(summarize_collection(_db, n))

    print(json.dumps(report, default=str, indent=2))


if __name__ == "__main__":
    main()
