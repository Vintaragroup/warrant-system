# app/telnyx_tools.py
from __future__ import annotations
from fastapi import APIRouter, Request, HTTPException, Depends
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPBearer
from typing import Any, Dict, Optional, List
import time, re
from difflib import SequenceMatcher
from bson import ObjectId

from .config import settings
from .db import persons, custody_events, inquiries, logs, cases  # no 'db' import
from .sms import send_sms

# Expose Bearer auth in OpenAPI/Swagger; _auth below still validates the exact token
router = APIRouter(
    prefix="/telnyx",
    tags=["telnyx-tools"],
    dependencies=[Depends(HTTPBearer())]
)

# Get the Database handle from an existing collection
_db = persons.database  # <-- fixes ImportError on Render

# --------- helpers ---------
def _auth(req: Request) -> None:
    auth = req.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = auth.split(" ", 1)[1]
    if token != settings.TELNYX_TOOL_TOKEN:
        raise HTTPException(status_code=403, detail="Invalid token")

def _verify_webhook_secret(req: Request) -> None:
    """Optional lightweight verification for webhook posts via a shared secret header.
    If TELNYX_WEBHOOK_SECRET is set in settings, require header 'X-Telnyx-Secret' to match.
    """
    secret = getattr(settings, "TELNYX_WEBHOOK_SECRET", None)
    if not secret:
        return
    hdr = req.headers.get("x-telnyx-secret")
    if not hdr or hdr != secret:
        raise HTTPException(status_code=401, detail="Invalid webhook secret")


def _normalize_dob_input(dob: Optional[str]) -> Optional[str]:
    """Normalize incoming DOB strings to MM/DD[/YYYY] to improve lookup matching."""
    if not dob:
        return None
    s = dob.strip()
    if not s:
        return None
    parts = re.findall(r"\d+", s)
    if not parts:
        return s.replace("-", "/").replace(".", "/")
    try:
        if len(parts) >= 3:
            month = int(parts[0])
            day = int(parts[1])
            year = int(parts[2])
            if not (1 <= month <= 12 and 1 <= day <= 31):
                raise ValueError
            return f"{month:02d}/{day:02d}/{year:04d}"
        if len(parts) == 2:
            month = int(parts[0])
            day = int(parts[1])
            if not (1 <= month <= 12 and 1 <= day <= 31):
                raise ValueError
            return f"{month:02d}/{day:02d}"
    except Exception:
        pass
    return s.replace("-", "/").replace(".", "/")

def _e164(phone: str | None) -> Optional[str]:
    if not phone:
        return None
    phone = phone.strip()
    return phone if re.fullmatch(r"\+\d{10,15}", phone) else None

def _normalize_name(s: Optional[str]) -> Optional[str]:
    if not s:
        return None
    return re.sub(r"[^a-z]", "", s.lower()) or None

def _name_variants(full_name: str) -> List[str]:
    """Return possible name variants (e.g., 'First Last' -> 'Last, First')."""
    name = (full_name or "").strip()
    if not name:
        return []
    variants: List[str] = []
    def _add(v: str) -> None:
        v = v.strip()
        if v and v not in variants:
            variants.append(v)

    _add(name)

    if "," in name:
        last, first = [part.strip() for part in name.split(",", 1)]
        if first and last:
            _add(f"{first} {last}")
            _add(f"{last} {first}")
    else:
        parts = [p for p in name.split() if p]
        if len(parts) >= 2:
            first = parts[0]
            last = parts[-1]
            _add(f"{last}, {first}")
            _add(f"{last} {first}")
    return variants

def _agents_map() -> dict:
    import json as _json
    try:
        return _json.loads(settings.ONCALL_AGENTS_JSON) if settings.ONCALL_AGENTS_JSON else {}
    except Exception:
        return {}

def _agent_phone_from_name(name: Optional[str]) -> Optional[str]:
    """Resolve agent phone by fuzzy name match using ONCALL_AGENTS_JSON.
    Accepted format:
    {
      "Alex": {"phone": "+1713...", "aliases": ["Alejandro", "Alexander"]},
      "Maria": {"phone": "+1832..."}
    }
    Matching is case-insensitive, letters-only compare; exact or startswith on name or aliases.
    """
    if not name:
        return None
    roster = _agents_map()
    want = _normalize_name(name)
    if not want:
        return None
    # Pass 1: exact normalized key match
    for disp, info in roster.items():
        norm = _normalize_name(disp)
        if norm and norm == want:
            ph = (info or {}).get("phone")
            return _e164(ph)
    # Pass 2: aliases exact or startswith
    for disp, info in roster.items():
        info = info or {}
        # main display startswith
        norm = _normalize_name(disp)
        if norm and (norm == want or norm.startswith(want) or want.startswith(norm)):
            ph = info.get("phone")
            if _e164(ph):
                return ph
        # aliases
        for al in (info.get("aliases") or []):
            an = _normalize_name(str(al))
            if an and (an == want or an.startswith(want) or want.startswith(an)):
                ph = info.get("phone")
                if _e164(ph):
                    return ph
    return None

def _objid(s: str | None) -> Optional[ObjectId]:
    if not s:
        return None
    try:
        return ObjectId(s)
    except Exception:
        return None

def _latest_custody(person_id: str) -> Optional[dict]:
    return custody_events.find_one({"person_id": person_id}, sort=[("scraped_at", -1)])

def _parse_bond_str(total_bond: str | None) -> Optional[float]:
    if not total_bond:
        return None
    try:
        return float(total_bond.replace("$", "").replace(",", ""))
    except Exception:
        return None

def _parse_bond_label(s: str | None) -> tuple[Optional[float], Optional[bool]]:
    """Parse assorted bond label strings.
    Returns (amount_numeric, eligible) where eligible may be None if unknown.
    Examples handled: "$5,000.00", "5000", "No Bond", "PR Bond".
    """
    if not s:
        return None, None
    txt = s.strip().lower()
    if "no bond" in txt:
        return None, False
    if "pr bond" in txt or "personal recognizance" in txt:
        # Treat PR as bond amount 0 but eligible False for posting
        return 0.0, False
    # Extract first money-like token
    m = re.search(r"\$?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?|[0-9]+)", s)
    if m:
        try:
            val = float(m.group(1).replace(",", ""))
            return val, (val > 0)
        except Exception:
            return None, None
    return None, None

def _needs_human_review(text: Optional[str], status: Optional[str]) -> bool:
    """Heuristic to flag when a human should review/advise caller.
    Triggers on phrases like 'refer to magistrate', 'pending', 'see judge', etc.
    """
    blob = f"{text or ''} {status or ''}".lower()
    return bool(re.search(r"refer|magistrate|see\s+(?:the\s+)?judge|pending|tbd|set by|to be|not available|call|contact", blob))

def _compose_agent_sms(
    *,
    county: Optional[str],
    inmate: Optional[dict],
    bail: Optional[dict],
    caller: Optional[dict],
    summary: Optional[str],
    urgency: Optional[object] = None,
    topic: Optional[str] = None
) -> str:
    """Build a concise SMS (<= 320 chars) for the on-call agent.
    inmate: { full_name?, dob? }
    bail: { total_bond?, amount_numeric?, eligible?, bond_text?, needs_human_review? }
    caller: { name?, phone?, relationship?, intends_to_post? }
    """
    parts: list[str] = []
    if county:
        parts.append(f"New transfer ({county.title()}):")
    else:
        parts.append("New transfer:")

    if inmate:
        nm = inmate.get("full_name") or inmate.get("name")
        dob = inmate.get("dob")
        if nm and dob:
            parts.append(f"Inmate {nm} (DOB {dob})")
        elif nm:
            parts.append(f"Inmate {nm}")

    if bail:
        tb = bail.get("total_bond") or bail.get("bond_text")
        elig = bail.get("eligible")
        need = bail.get("needs_human_review")
        if tb:
            parts.append(f"Bail {tb}")
        if elig is True:
            parts.append("Eligible")
        elif elig is False:
            parts.append("Not eligible")
        elif need:
            parts.append("Needs review")

    if caller:
        cname = caller.get("name")
        cph = caller.get("phone")
        rel = caller.get("relationship")
        intends = caller.get("intends_to_post")
        if cname and cph:
            parts.append(f"Caller {cname} {cph}")
        elif cname:
            parts.append(f"Caller {cname}")
        elif cph:
            parts.append(f"Caller {cph}")
        if rel:
            parts.append(rel)
        if intends is True:
            parts.append("intends to post")

    # Extras captured from final question
    if topic:
        parts.append(f"Topic: {topic}")
    if urgency is not None:
        try:
            ustr = str(urgency).strip().lower()
            if ustr in ("true","yes","y","urgent","high","asap","1") or urgency is True:
                parts.append("URGENT")
            elif ustr and ustr not in ("false","no","n","0","none","null"):
                parts.append(f"Urgency: {ustr}")
        except Exception:
            pass

    if summary:
        parts.append(f"Summary: {summary}")

    msg = " | ".join([p for p in parts if p])
    return (msg[:317] + "...") if len(msg) > 320 else msg

def _compose_whisper_text(
    *,
    county: Optional[str],
    inmate: Optional[dict],
    bail: Optional[dict],
    caller: Optional[dict],
    summary: Optional[str],
    urgency: Optional[object] = None,
    topic: Optional[str] = None
) -> str:
    """Minimal whisper for agent: caller name, inmate name, bond amount.
    Agent chooses if they want expanded captured data before accepting call.
    
    DTMF: 1 = show all captured data, 2 = transfer without more info.
    """
    segs: list[str] = []
    
    # === ESSENTIAL INFO ONLY ===
    if caller:
        cname = caller.get("name")
        if cname:
            segs.append(f"Caller: {cname}.")
    
    if inmate:
        nm = inmate.get("full_name") or inmate.get("name")
        if nm:
            segs.append(f"About: {nm}.")
    
    if bail:
        tb = bail.get("total_bond") or bail.get("bond_text")
        if tb:
            segs.append(f"Bond: {tb}.")
    
    # === AGENT CHOICE PROMPT ===
    accept_digit = str(settings.TRANSFER_ACCEPT_DIGIT) if settings.TRANSFER_ACCEPT_DIGIT else "1"
    decline_digit = str(settings.TRANSFER_DECLINE_DIGIT) if settings.TRANSFER_DECLINE_DIGIT else "2"
    
    segs.append(f"Press {accept_digit} for more information.")
    segs.append(f"Press {decline_digit} to transfer the call.")
    
    return " ".join(segs)

def _compose_expanded_whisper_text(
    *,
    county: Optional[str],
    inmate: Optional[dict],
    bail: Optional[dict],
    caller: Optional[dict],
    summary: Optional[str],
    urgency: Optional[object] = None,
    topic: Optional[str] = None
) -> str:
    """Expanded whisper when agent presses 1 for more info.
    Provides all captured data: dates, eligibility, inmate DOB, caller relationship, call reason, etc.
    """
    segs: list[str] = []
    
    # === CALLER INFO (detailed) ===
    if caller:
        cname = caller.get("name")
        rel = caller.get("relationship")
        phone = caller.get("phone")
        intends = caller.get("intends_to_post")
        
        if cname:
            segs.append(f"Caller: {cname}.")
        if cname and rel:
            segs.append(f"{rel} of the inmate.")
        if phone:
            clean_phone = phone.replace("(", "").replace(")", "").replace("-", " ").replace("+", "plus ")
            segs.append(f"Callback: {clean_phone}.")
        if intends is True:
            segs.append("Intends to post bail today.")
    
    # === INMATE INFO (detailed) ===
    if inmate:
        nm = inmate.get("full_name") or inmate.get("name")
        dob = inmate.get("dob")
        
        if nm:
            segs.append(f"Inmate: {nm}.")
        if dob:
            segs.append(f"Date of birth: {dob}.")
    
    # === BAIL STATUS (detailed) ===
    if bail:
        tb = bail.get("total_bond") or bail.get("bond_text")
        elig = bail.get("eligible")
        need = bail.get("needs_human_review")
        
        if tb:
            segs.append(f"Bond amount: {tb}.")
        if elig is True:
            segs.append("Eligible to post bail.")
        elif elig is False:
            segs.append("Not eligible to post bail.")
        elif need:
            segs.append("Needs human review.")
    
    # === CALL CONTEXT ===
    if county:
        segs.append(f"County: {county.title()}.")
    if topic:
        segs.append(f"Call reason: {topic}.")
    if urgency is not None:
        try:
            ustr = str(urgency).strip().lower()
            if ustr in ("true","yes","urgent","high","asap","1") or urgency is True:
                segs.append("High priority call.")
        except Exception:
            pass
    
    # === SUMMARY/NOTES ===
    if summary:
        if len(summary) > 60:
            parts = summary.split(". ")
            for part in parts:
                if part.strip():
                    segs.append(f"{part.strip()}.")
        else:
            segs.append(f"Notes: {summary}.")
    
    segs.append("Ready to transfer the call.")
    
    return " ".join(segs)

# ---------- office routing ----------
import json as _json
from datetime import datetime, time as dtime
try:
    import zoneinfo  # Python 3.9+
except Exception:  # pragma: no cover
    zoneinfo = None

def _office_phone_for_county(county: Optional[str]) -> Optional[str]:
    """Return E.164 office phone for a county using settings routes, else default.
    Match is case-insensitive; uses normalized county key.
    """
    try:
        routes = (_json.loads(settings.OFFICE_ROUTES_JSON) if settings.OFFICE_ROUTES_JSON else {})
    except Exception:
        routes = {}
    key = (county or "").strip().lower()
    if key in routes:
        return routes.get(key)
    # try simple normalization (drop ' county')
    if key.endswith(" county") and key[:-7] in routes:
        return routes.get(key[:-7])
    return settings.DEFAULT_OFFICE_NUMBER

def _static_transfer_numbers() -> List[str]:
    """Return a static list of transfer numbers when explicitly configured."""
    raw = getattr(settings, "STATIC_TRANSFER_NUMBERS_JSON", None)
    if not raw:
        return []
    try:
        data = _json.loads(raw)
    except Exception:
        return []
    if not isinstance(data, list):
        return []
    seen: set[str] = set()
    out: List[str] = []
    for entry in data:
        if not isinstance(entry, str):
            continue
        num = _e164(entry)
        if num and num not in seen:
            seen.add(num)
            out.append(num)
    return out

def _transfer_numbers_by_schedule(county: Optional[str], lang: Optional[str] = None) -> list[str]:
    """Return an ordered list of phone numbers based on OFFICES_SCHEDULE_JSON.
    If no schedule match, fall back to OFFICE_ROUTES_JSON or default.
    """
    static = _static_transfer_numbers()
    if static:
        return static

    numbers: list[str] = []
    # Parse schedule JSON
    try:
        sched = _json.loads(settings.OFFICES_SCHEDULE_JSON) if settings.OFFICES_SCHEDULE_JSON else {}
    except Exception:
        sched = {}
    tzname = settings.APP_TZ or "UTC"
    tz = zoneinfo.ZoneInfo(tzname) if zoneinfo else None
    now = datetime.now(tz) if tz else datetime.utcnow()
    dow = ["mon","tue","wed","thu","fri","sat","sun"][now.weekday()]
    cur_min = now.hour * 60 + now.minute

    key = (county or "").strip().lower()
    langkey = f"{key}_{(lang or '').strip().lower()}" if lang else None
    # candidates: county+lang, county-specific, normalized without ' county', then default
    selected_key: Optional[str] = None
    for k in [langkey, key, key[:-7] if key.endswith(" county") else None, "default"]:
        if not k:
            continue
        rules = sched.get(k)
        if not rules:
            continue
        for r in rules:
            days = [d.lower() for d in r.get("days", [])]
            s = r.get("start","00:00")
            e = r.get("end","23:59")
            try:
                sh, sm = [int(x) for x in s.split(":",1)]
                eh, em = [int(x) for x in e.split(":",1)]
            except Exception:
                sh, sm, eh, em = 0, 0, 23, 59
            start_min = sh*60 + sm
            end_min = eh*60 + em
            in_window = False
            if dow in days:
                if start_min <= end_min:
                    in_window = (start_min <= cur_min <= end_min)
                else:
                    # window wraps past midnight
                    in_window = (cur_min >= start_min or cur_min <= end_min)
            if in_window:
                arr = [p for p in r.get("numbers", []) if isinstance(p, str) and p.startswith("+")]
                numbers.extend(arr)
        if numbers:
            selected_key = k
            break

    # Dedupe while preserving order
    seen = set()
    deduped: list[str] = []
    for n in numbers:
        if n not in seen:
            deduped.append(n)
            seen.add(n)
    numbers = deduped

    # Harris-specific policy: if we matched Harris (non-Spanish) schedule, insert Alex (Spanish fallback) as the next attempt.
    try:
        if selected_key == "harris" and (not lang or lang.lower() != "es"):
            # find Alex from the 'harris_es' schedule (first available number)
            r_es = sched.get("harris_es") or []
            alex_num: Optional[str] = None
            for rr in r_es:
                arr = [p for p in rr.get("numbers", []) if isinstance(p, str) and p.startswith("+")]
                if arr:
                    alex_num = arr[0]
                    break
            if alex_num and alex_num not in numbers:
                if numbers:
                    numbers.insert(1, alex_num)
                else:
                    numbers.append(alex_num)
    except Exception:
        pass

    # If still empty, apply Harris-specific gap fallback to Alex (Spanish line)
    if not numbers:
        try:
            # Normalize county key used earlier
            base_key = (county or "").strip().lower()
            if base_key.endswith(" county"):
                base_key = base_key[:-7]
            if base_key == "harris":
                r_es = sched.get("harris_es") or []
                alex_num: Optional[str] = None
                for rr in r_es:
                    arr = [p for p in rr.get("numbers", []) if isinstance(p, str) and p.startswith("+")]
                    if arr:
                        alex_num = arr[0]
                        break
                if alex_num:
                    numbers.append(alex_num)
        except Exception:
            pass

    # if still empty, fallback to single route
    if not numbers:
        one = _office_phone_for_county(county)
        if one:
            numbers.append(one)
    # final fallback: none
    return numbers

# ---------- FAST PATH over simple_* collections ----------
SIMPLE_COUNTIES = ["harris", "brazoria", "galveston", "fortbend"]

def _normalize_county_key(county: Optional[str]) -> Optional[str]:
    if not county:
        return None
    key = re.sub(r"[^a-z0-9]", "", county.lower())
    suffixes = ["county", "countyjail", "parish", "borough", "jail", "co"]
    changed = True
    while key and changed:
        changed = False
        for suffix in suffixes:
            if key.endswith(suffix):
                key = key[: -len(suffix)]
                changed = True
                break
    return key or None

def _county_matches(record_county: Optional[str], requested: Optional[str]) -> bool:
    if not requested:
        return True
    req = _normalize_county_key(requested)
    rec = _normalize_county_key(record_county)
    return bool(req and rec and req == rec)

def _build_county_patterns(county: Optional[str]) -> List[str]:
    if not county:
        return []
    trimmed = county.strip()
    if not trimmed:
        return []
    patterns = [trimmed]
    simplified = re.sub(r"(?i)\b(county|co\.?|parish|borough)\b", "", trimmed).strip()
    if simplified and simplified not in patterns:
        patterns.append(simplified)
    return [p for p in patterns if p]

def _custody_for_requested_county(person_id: str, county: Optional[str]) -> Optional[dict]:
    if not person_id:
        return None
    if not county:
        return _latest_custody(person_id)

    latest = _latest_custody(person_id)
    if latest and _county_matches(latest.get("county"), county):
        return latest

    for pattern in _build_county_patterns(county):
        regex = {"$regex": re.escape(pattern), "$options": "i"}
        specific = custody_events.find_one(
            {"person_id": person_id, "county": regex},
            sort=[("scraped_at", -1)]
        )
        if specific and _county_matches(specific.get("county"), county):
            return specific
    return None

def _lookup_person_by_name(full_name: str, dob: Optional[str], county: Optional[str]) -> tuple[Optional[dict], Optional[dict]]:
    name_variants = _name_variants(full_name)
    name_filters: List[Dict[str, Any]] = []
    for variant in name_variants or [full_name]:
        name_filters.append({"full_name": {"$regex": f"^{re.escape(variant)}$", "$options": "i"}})

    if not name_filters:
        name_filters.append({"full_name": {"$regex": f"^{re.escape(full_name)}$", "$options": "i"}})

    if dob:
        q: Dict[str, Any] = {"$and": [{"dob": dob}, {"$or": name_filters}]}
    else:
        q = {"$or": name_filters}

    cursor = persons.find(q).limit(10)
    for pdoc in cursor:
        pid = str(pdoc.get("_id"))
        custody = _custody_for_requested_county(pid, county)
        if county:
            if custody:
                return pdoc, custody
            continue
        return pdoc, custody
    return None, None

def _list_simple_cols(county_hint: Optional[str] = None, *, exclusive: bool = False):
    existing = set(_db.list_collection_names())
    available: Dict[str, Any] = {}
    for c in SIMPLE_COUNTIES:
        name = f"simple_{c}"
        if name in existing:
            available[c] = _db[name]

    ordered: List[Any] = []
    if county_hint:
        key = _normalize_county_key(county_hint)
        if key and key in available:
            ordered.append(available[key])
            if exclusive:
                return ordered

    for c in SIMPLE_COUNTIES:
        col = available.get(c)
        if col and col not in ordered:
            ordered.append(col)
    return ordered

def _split_name(full_name: str) -> tuple[Optional[str], Optional[str]]:
    if not full_name:
        return None, None
    s = full_name.strip()
    if "," in s:
        last, first = s.split(",", 1)
        return first.strip() or None, last.strip() or None
    parts = s.split()
    if len(parts) >= 2:
        return " ".join(parts[:-1]), parts[-1]
    return s, None

def _score_simple_hit(doc: dict, want_last: Optional[str], want_first: Optional[str], dob: Optional[str]) -> int:
    sc = 0
    doc_last = (doc.get("last_name") or "")
    if (not doc_last) and doc.get("full_name"):
        parts = str(doc["full_name"]).split(",", 1)
        if parts:
            doc_last = parts[0].strip()
    doc_first = (doc.get("first_name") or "")
    if (not doc_first) and doc.get("full_name"):
        parts = str(doc["full_name"]).split(",", 1)
        if len(parts) == 2:
            doc_first = parts[1].strip()
    try:
        if want_last and doc_last:
            dl = doc_last.upper()
            wl = want_last.upper()
            if dl == wl:
                sc += 4
            elif dl.startswith(wl):
                sc += 2
        if want_first and doc_first:
            want_norm = want_first.upper()
            have_norm = doc_first.upper()
            if have_norm.startswith(want_norm) or want_norm.startswith(have_norm):
                sc += 2
            else:
                ratio = SequenceMatcher(None, have_norm, want_norm).ratio()
                if ratio >= 0.9:
                    sc += 2
                elif ratio >= 0.75:
                    sc += 1
        if dob and doc.get("dob") and str(doc["dob"]) == dob:
            sc += 3
        if doc.get("booking_date"):
            sc += 1
    except Exception:
        pass
    return sc

def _find_in_simple(full_name: str, *, dob: Optional[str]=None, county_hint: Optional[str]=None) -> Optional[dict]:
    first, last = _split_name(full_name)
    if not last and first:
        last, first = first, None  # single token -> treat as last name

    base_last: Dict[str, Any] = {}
    if last:
        base_last["last_name"] = {"$regex": f"^{re.escape(last)}$", "$options": "i"}
    base_dob: Dict[str, Any] = {"dob": dob} if dob else {}

    queries: List[Dict[str, Any]] = []
    if first:
        queries.append({**base_last, **base_dob, "first_name": {"$regex": f"^{re.escape(first)}", "$options": "i"}})
        if len(first) >= 4:
            queries.append({**base_last, **base_dob, "first_name": {"$regex": f"^{re.escape(first[:4])}", "$options": "i"}})
        if len(first) >= 2:
            queries.append({**base_last, **base_dob, "first_name": {"$regex": f"^{re.escape(first[:2])}", "$options": "i"}})
    if base_last or base_dob:
        queries.append({**base_last, **base_dob})
    if not queries:
        queries.append({"first_name": {"$regex": f"^{re.escape(first or last or full_name)}", "$options": "i"}})

    cols: List[Any] = []
    if county_hint:
        cols = _list_simple_cols(county_hint, exclusive=True)
    if not cols:
        cols = _list_simple_cols()
    if not cols:
        return None

    best = None
    best_score = -1
    seen_ids: set[str] = set()
    dedup_queries: List[Dict[str, Any]] = []
    for q in queries:
        if q not in dedup_queries:
            dedup_queries.append(q)
    for col in cols:
        for q in dedup_queries:
            cur = col.find(q).sort([("booking_date", -1)]).limit(5)
            for d in cur:
                did = str(d.get("_id"))
                if did in seen_ids:
                    continue
                seen_ids.add(did)
                sc = _score_simple_hit(d, last, first, dob)
                if sc > best_score:
                    best, best_score = d, sc
    return best if best_score > 0 else None

def _bail_view_from_simple(d: dict) -> dict:
    # Prefer explicit numeric bond_amount when present
    amount = None
    if d.get("bond_amount") is not None:
        try:
            amount = float(d["bond_amount"])
        except Exception:
            amount = None

    total_bond_str = d.get("bond")
    eligible = None if amount is None else (amount > 0)

    # Harris often uses bond_label instead of bond/bond_amount
    if amount is None and (not total_bond_str):
        amt2, elig2 = _parse_bond_label(d.get("bond_label") or d.get("dbg_bond_note"))
        if amt2 is not None:
            amount = amt2
            total_bond_str = f"${int(amt2):,}.00"
            eligible = elig2 if elig2 is not None else (amt2 > 0)
        elif elig2 is not None:
            # we know it's no/PR bond, but no numeric
            eligible = elig2

    # If we had amount but no string, format a default string
    if (not total_bond_str) and (amount is not None):
        total_bond_str = f"${int(amount):,}.00"

    bond_text = d.get("bond") or d.get("bond_label") or d.get("dbg_bond_note")
    needs_review = (amount is None) and _needs_human_review(bond_text, d.get("category") or d.get("status"))

    return {
        "found": True,
        "has_custody": True,
        "status": d.get("category") or "In Custody",
        "total_bond": total_bond_str,
        "amount_numeric": amount,
        "eligible": eligible,
        "bond_text": bond_text,
        "needs_human_review": needs_review
    }

def _resolve_person_id_from_payload(person_id: str | None, full_name: str | None, dob: str | None) -> Optional[str]:
    """Resolve and return person_id (as string) if possible.
    Does not create new persons; only matches existing.
    """
    if person_id:
        oid = _objid(person_id)
        if not oid:
            return None
        pdoc = persons.find_one({"_id": oid})
        return str(pdoc["_id"]) if pdoc else None
    if full_name:
        q: Dict[str, Any] = {"full_name": full_name}
        if dob:
            q["dob"] = dob
        pdoc = persons.find_one(q)
        if pdoc:
            return str(pdoc["_id"])  # type: ignore[index]
    return None

# --------- endpoints ---------

@router.post("/find_person")
async def find_person(payload: Dict[str, Any], request: Request):
    """
    Find a person by full name (required) and optional date-of-birth.
    Returns the person and their latest custody snapshot (if any).
    """
    _auth(request)
    full_name = (payload.get("full_name") or "").strip()
    dob       = _normalize_dob_input(payload.get("dob"))
    county    = (payload.get("county") or payload.get("location_hint") or "").strip() or None

    if not full_name:
        raise HTTPException(400, "Provide 'full_name'")

    # FAST PATH: simple_* collections
    s = _find_in_simple(full_name, dob=dob, county_hint=county)
    if s:
        latest = {
            "id": str(s.get("_id")),
            "status": "In Custody",
            "facility": (s.get("county") or "").title(),
            "county": (s.get("county") or "").title(),
            "booking_number": s.get("booking_number"),
            "total_bond": s.get("bond") or (f"${int(s.get('bond_amount',0)):,}.00" if s.get("bond_amount") else None),
            "arrest_date": s.get("booking_date"),
            "source_url": None,
            "scraped_at": s.get("normalized_at"),
        }
        person_out = {
            "id": None,
            "full_name": s.get("full_name"),
            "dob": s.get("dob"),
            "aka": [],
        }
        return {"found": True, "person": person_out, "latest_custody": latest}

    # FALLBACK: persons + custody_events scoped to requested county
    pdoc, latest = _lookup_person_by_name(full_name, dob, county)
    if not pdoc:
        return {"found": False}

    pid = str(pdoc.get("_id"))

    custody = None
    if latest:
        custody = {
            "id": str(latest.get("_id")),
            "status": latest.get("status"),
            "facility": latest.get("facility"),
            "county": latest.get("county"),
            "booking_number": latest.get("booking_number"),
            "total_bond": latest.get("total_bond"),
            "arrest_date": latest.get("arrest_date"),
            "source_url": latest.get("source_url"),
            "scraped_at": latest.get("scraped_at"),
        }

    return {
        "found": True,
        "person": {
            "id": pid,
            "full_name": pdoc.get("full_name"),
            "dob": pdoc.get("dob"),
            "aka": pdoc.get("aka", []),
        },
        "latest_custody": custody
    }

@router.post("/get_bail_status")
async def get_bail_status(payload: Dict[str, Any], request: Request):
    """
    Get simple bail status/amount. Accepts person_id OR full_name(+optional dob).
    Tries simple_* first, then persons/custody_events.
    """
    _auth(request)

    person_id = (payload.get("person_id") or "").strip()
    full_name = (payload.get("full_name") or "").strip()
    dob       = _normalize_dob_input(payload.get("dob"))
    county    = (payload.get("county") or payload.get("location_hint") or "").strip() or None

    # FAST PATH: name lookup in simple_* first
    if full_name:
        s = _find_in_simple(full_name, dob=dob, county_hint=county)
        if s:
            return _bail_view_from_simple(s)

    # FALLBACK: persons + custody_events
    pdoc = None
    pid: Optional[str] = None
    c: Optional[dict] = None
    if person_id:
        oid = _objid(person_id)
        if not oid:
            raise HTTPException(400, "Invalid person_id")
        pdoc = persons.find_one({"_id": oid})
        if pdoc:
            pid = str(pdoc.get("_id"))
            c = _custody_for_requested_county(pid, county)
    elif full_name:
        pdoc, c = _lookup_person_by_name(full_name, dob, county)
        if pdoc:
            pid = str(pdoc.get("_id"))
    else:
        raise HTTPException(400, "Provide person_id OR full_name")

    if not pdoc:
        return {"found": False}

    if not pid:
        pid = str(pdoc.get("_id"))
    if c is None:
        c = _custody_for_requested_county(pid, county)
    if not c:
        return {"found": True, "has_custody": False}

    amount_num = _parse_bond_str(c.get("total_bond"))
    eligible = None
    if amount_num is not None:
        status = (c.get("status") or "").lower()
        eligible = not ("release" in status or "no bond" in (c.get("total_bond") or "").lower())

    bond_text = c.get("total_bond")
    needs_review = (amount_num is None) and _needs_human_review(bond_text, c.get("status"))

    return {
        "found": True,
        "has_custody": True,
        "status": c.get("status"),
        "total_bond": c.get("total_bond"),
        "amount_numeric": amount_num,
        "eligible": eligible,
        "bond_text": bond_text,
        "needs_human_review": needs_review
    }

@router.post("/create_bail_inquiry")
async def create_bail_inquiry(payload: Dict[str, Any], request: Request):
    """
    Create an inquiry record from a caller. This does NOT modify custody_events;
    it creates/records the lead in your 'inquiries' collection.
    """
    _auth(request)
    person_id   = (payload.get("person_id") or "").strip()
    full_name   = (payload.get("inmate_name") or payload.get("full_name") or "").strip()
    caller_name = (payload.get("caller_name") or "").strip()
    caller_ph   = _e164(payload.get("caller_phone"))
    relation    = (payload.get("relationship") or "").strip()
    intends     = bool(payload.get("intends_to_post", False))
    notes       = (payload.get("notes") or "").strip()

    if not person_id and not full_name:
        raise HTTPException(400, "person_id or full_name required")
    if not caller_name or not caller_ph:
        raise HTTPException(400, "Valid caller_name and caller_phone (E.164) required")

    doc = {
        "person_id": person_id or None,
        "full_name": full_name or None,
        "caller_name": caller_name,
        "caller_phone": caller_ph,
        "relationship": relation or None,
        "intends_to_post": intends,
        "notes": notes or None,
        "created_ts": int(time.time())
    }
    res = inquiries.insert_one(doc)

    logs.insert_one({"type":"telnyx_create_inquiry","inquiry_id":str(res.inserted_id),"ts":int(time.time())})
    return {"ok": True, "inquiry_id": str(res.inserted_id)}

@router.post("/attach_caller")
async def attach_caller_to_case(payload: Dict[str, Any], request: Request):
    """
    Attach caller info to an existing case CRM (if a case exists for the inmate),
    and persist an inquiry record regardless. This is intended to be called after
    the agent confirms the inmate and bail exists.

    Input JSON:
    - person_id OR full_name (+optional dob)
    - caller_name (required)
    - caller_phone (E.164, required)
    - relationship (optional)
    - intends_to_post (bool, optional)
    - notes (optional)
    Returns: { ok, inquiry_id, linked_to_case, case_id? }
    """
    _auth(request)

    person_id   = (payload.get("person_id") or "").strip()
    full_name   = (payload.get("inmate_name") or payload.get("full_name") or "").strip()
    dob         = (payload.get("dob") or "").strip() or None
    caller_name = (payload.get("caller_name") or "").strip()
    caller_ph   = _e164(payload.get("caller_phone"))
    relationship= (payload.get("relationship") or "").strip() or None
    intends     = bool(payload.get("intends_to_post", False))
    notes       = (payload.get("notes") or "").strip() or None

    if not person_id and not full_name:
        raise HTTPException(400, "person_id or full_name required")
    if not caller_name or not caller_ph:
        raise HTTPException(400, "Valid caller_name and caller_phone (E.164) required")

    # First, persist the inquiry record
    inquiry_doc = {
        "person_id": person_id or None,
        "full_name": full_name or None,
        "caller_name": caller_name,
        "caller_phone": caller_ph,
        "relationship": relationship,
        "intends_to_post": intends,
        "notes": notes,
        "created_ts": int(time.time())
    }
    res = inquiries.insert_one(inquiry_doc)

    # Attempt to resolve person_id to link to a case
    pid = _resolve_person_id_from_payload(person_id or None, full_name or None, dob)
    linked = False
    case_id_out: Optional[str] = None
    if pid:
        case_doc = cases.find_one({"person_id": pid})
        if case_doc:
            case_id_out = case_doc.get("case_id") or str(case_doc.get("_id"))
            # Upsert CRM contact into the case document
            cases.update_one(
                {"_id": case_doc["_id"]},
                {"$push": {"crm_contacts": {
                    "ts": int(time.time()),
                    "inquiry_id": str(res.inserted_id),
                    "caller_name": caller_name,
                    "caller_phone": caller_ph,
                    "relationship": relationship,
                    "intends_to_post": intends,
                    "notes": notes,
                }},
                 "$set": {"crm_updated_ts": int(time.time())}}
            )
            linked = True
        else:
            logs.insert_one({
                "type": "telnyx_attach_no_case",
                "person_id": pid,
                "inquiry_id": str(res.inserted_id),
                "ts": int(time.time())
            })
    else:
        logs.insert_one({
            "type": "telnyx_attach_unresolved_person",
            "full_name": full_name,
            "inquiry_id": str(res.inserted_id),
            "ts": int(time.time())
        })

    return {
        "ok": True,
        "inquiry_id": str(res.inserted_id),
        "linked_to_case": linked,
        "case_id": case_id_out
    }

@router.post("/transfer_target")
async def transfer_target(payload: Dict[str, Any], request: Request):
    """
    Resolve the best transfer phone number (E.164) for an office based on county.
    Input JSON: { county?: string }
    Returns: { ok: true, phone?: "+1..." }
    If no county match and no default is configured, phone will be null.
    """
    _auth(request)
    county = (payload.get("county") or "").strip() or None
    phone = _office_phone_for_county(county)
    return {"ok": True, "phone": phone}

@router.post("/transfer_plan")
async def transfer_plan(payload: Dict[str, Any], request: Request):
    """
    Return an ordered list of phone numbers to try, based on county and schedule.
    Input JSON: { county?: string }
    Response: { ok: true, numbers: ["+1...", "+1..."], attempt_timeout_sec: number }
    """
    _auth(request)
    county = (payload.get("county") or "").strip() or None
    lang = (payload.get("lang") or "").strip() or None
    numbers = _transfer_numbers_by_schedule(county, lang)
    return {
        "ok": True,
        "numbers": numbers,
        "attempt_timeout_sec": int(settings.DIAL_ATTEMPT_TIMEOUT_SEC or 20)
    }

def _compute_warm_transfer_plan(county: Optional[str], lang: Optional[str], inmate: Dict[str, Any], 
                                bail: Dict[str, Any], caller: Dict[str, Any], summary: Optional[str],
                                topic: Optional[str], urgency: Optional[str]) -> Dict[str, Any]:
    """
    Core logic for warm transfer plan computation.
    Extracted to be reusable by both the router endpoint and dynamic variables webhook.
    """
    county = (county or "").strip() or None
    lang = (lang or "").strip() or None
    inmate = inmate or {}
    bail = bail or {}
    caller = caller or {}
    summary = (summary or "").strip() or None
    topic = (topic or "").strip() or None
    urgency = urgency or None

    raw_numbers = _transfer_numbers_by_schedule(county, lang)
    numbers: list[str] = []
    invalid_numbers: list[str] = []
    seen_numbers: set[str] = set()
    for raw in raw_numbers:
        normalized = _e164(raw)
        if not normalized:
            invalid_numbers.append(str(raw))
            continue
        if normalized not in seen_numbers:
            numbers.append(normalized)
            seen_numbers.add(normalized)
    # Build whisper text for the agent side
    whisper = _compose_whisper_text(
        county=county, inmate=inmate, bail=bail, caller=caller, summary=summary, topic=topic, urgency=urgency
    )
    # Resolve hold music URL and defaults
    hold_url = getattr(settings, "HOLD_MUSIC_URL", None)
    if isinstance(hold_url, str):
        hold_url = hold_url.strip()
        if hold_url.lower() in {"none", "null", ""}:
            hold_url = None

    attempt_timeout = int(getattr(settings, "DIAL_ATTEMPT_TIMEOUT_SEC", 20) or 20)

    accept = getattr(settings, "TRANSFER_ACCEPT_DIGIT", None)
    if isinstance(accept, str):
        accept = accept.strip()
        if accept.lower() in {"none", "null", ""}:
            accept = None
    if not accept:
        accept = "1"

    decline = getattr(settings, "TRANSFER_DECLINE_DIGIT", None)
    if isinstance(decline, str):
        decline = decline.strip()
        if decline.lower() in {"none", "null", ""}:
            decline = None
    if not decline:
        decline = "2"

    from_caller_id = getattr(settings, "OFFICE_CALLER_ID", None)
    if isinstance(from_caller_id, str):
        from_caller_id = from_caller_id.strip()
        if from_caller_id.lower() in {"none", "null", ""}:
            from_caller_id = None
    if not from_caller_id:
        default_office = getattr(settings, "DEFAULT_OFFICE_NUMBER", None)
        if isinstance(default_office, str):
            default_office = default_office.strip()
            if default_office.lower() in {"none", "null", ""}:
                default_office = None
        from_caller_id = default_office

    if not numbers:
        logs.insert_one({
            "type": "warm_transfer_no_numbers",
            "ts": int(time.time()),
            "county": county,
            "lang": lang,
            "invalid": invalid_numbers
        })
    elif invalid_numbers:
        logs.insert_one({
            "type": "warm_transfer_invalid_numbers",
            "ts": int(time.time()),
            "county": county,
            "lang": lang,
            "invalid": invalid_numbers
        })

    # Friendly message for the caller while on hold
    caller_hold_msg = "Please hold while I connect you with an agent."
    primary_number = numbers[0] if numbers else None

    return {
        "ok": True,
        "numbers": numbers,
        "primary_number": primary_number,
        "attempt_timeout_sec": attempt_timeout,
        "hold_music_url": hold_url,
        "whisper_text": whisper,
        "accept_dtmf": accept,
        "decline_dtmf": decline,
        "from_caller_id": from_caller_id,
        "caller_hold_message": caller_hold_msg
    }

@router.post("/warm_transfer_plan")
async def warm_transfer_plan(payload: Dict[str, Any], request: Request):
    """Return a plan for a warm transfer: numbers to try, hold music URL, and a TTS whisper.
    Input JSON: { county?, lang?, inmate?, bail?, caller?, summary? }
    Response JSON:
    {
      ok: true,
      numbers: ["+1..."],
      attempt_timeout_sec: number,
      hold_music_url: string|null,
      whisper_text: string,
      accept_dtmf: string,
      decline_dtmf: string,
      from_caller_id: string|null,
      caller_hold_message: string
    }
    """
    _auth(request)
    county = payload.get("county")
    lang = payload.get("lang")
    inmate = payload.get("inmate")
    bail = payload.get("bail")
    caller = payload.get("caller")
    summary = payload.get("summary")
    topic = payload.get("topic") or payload.get("subject")
    urgency = payload.get("urgency")
    
    return _compute_warm_transfer_plan(
        county=county,
        lang=lang,
        inmate=inmate,
        bail=bail,
        caller=caller,
        summary=summary,
        topic=topic,
        urgency=urgency
    )

@router.get("/hold_music")
async def hold_music(request: Request):
    """Expose the configured hold music URL for diagnostics and assistant wiring."""
    _auth(request)
    return {
        "ok": True,
        "hold_music_url": getattr(settings, "HOLD_MUSIC_URL", None)
    }

@router.get("/hold_music_test")
async def hold_music_test(request: Request):
    """Test if the configured hold music URL is accessible (200 OK, audio/mpeg content-type).
    Requires Bearer token. Returns diagnostic info about URL reachability.
    """
    _auth(request)
    
    url = getattr(settings, "HOLD_MUSIC_URL", None)
    if not url:
        return {
            "ok": False,
            "url": None,
            "error": "HOLD_MUSIC_URL not configured in environment",
            "status_code": None,
            "content_type": None
        }
    
    import requests
    try:
        res = requests.head(url, timeout=5, allow_redirects=True)
        return {
            "ok": res.status_code == 200,
            "url": url,
            "status_code": res.status_code,
            "content_type": res.headers.get("content-type"),
            "error": None if res.status_code == 200 else f"HTTP {res.status_code}"
        }
    except requests.exceptions.RequestException as e:
        return {
            "ok": False,
            "url": url,
            "status_code": None,
            "content_type": None,
            "error": str(e)
        }

@router.get("/hold_music/moonlightdrive.mp3")
async def serve_hold_music_proxy():
    """
    Public proxy endpoint that serves hold music from Telnyx private storage.
    
    This endpoint allows Telnyx playback_start API to access the audio file without
    needing pre-signed URLs. The audio is fetched from Telnyx private storage
    (accessible from Render's infrastructure) and streamed publicly.
    
    Usage: Set HOLD_MUSIC_URL=https://ai-agent-warrant.onrender.com/hold_music/moonlightdrive.mp3
    Then Telnyx playback_start API can access it.
    
    Returns: audio/mpeg stream (no authentication required for this endpoint)
    """
    import requests
    
    # Direct Telnyx Object Storage URL (private, but accessible from Render)
    telnyx_storage_url = "https://us-central-1.telnyxcloudstorage.com/hold-music/moonlightdrive.mp3"
    
    try:
        res = requests.get(telnyx_storage_url, timeout=30)
        res.raise_for_status()
        
        # Log the access
        logs.insert_one({
            "type": "telnyx_hold_music_served",
            "ts": int(time.time()),
            "source_url": telnyx_storage_url,
            "content_length": len(res.content),
            "content_type": res.headers.get("content-type")
        })
        
        # Stream the audio to the client (Telnyx API)
        return StreamingResponse(
            iter([res.content]),
            media_type="audio/mpeg",
            headers={
                "Content-Length": str(len(res.content)),
                "Cache-Control": "public, max-age=3600"
            }
        )
    except requests.exceptions.RequestException as e:
        err_msg = str(e)
        logs.insert_one({
            "type": "telnyx_hold_music_error",
            "ts": int(time.time()),
            "error": err_msg
        })
        raise HTTPException(500, f"Failed to serve hold music: {err_msg}")



@router.get("/schedule_status")
async def schedule_status(request: Request, county: Optional[str] = None, lang: Optional[str] = None):
    """Diagnostic endpoint to verify OFFICES_SCHEDULE_JSON parsing and matching.
    Requires Bearer token. Returns tz, time, parsed keys, and a sample plan.
    """
    _auth(request)
    # Parse schedule
    try:
        sched = _json.loads(settings.OFFICES_SCHEDULE_JSON) if settings.OFFICES_SCHEDULE_JSON else {}
        parse_ok = True
    except Exception as e:
        sched = {}
        parse_ok = False
    keys = list(sched.keys())
    tzname = settings.APP_TZ or "UTC"
    tz = zoneinfo.ZoneInfo(tzname) if zoneinfo else None
    now = datetime.now(tz) if tz else datetime.utcnow()
    dow = ["mon","tue","wed","thu","fri","sat","sun"][now.weekday()]
    plan = _transfer_numbers_by_schedule(county or "Harris", lang)
    fallback = _office_phone_for_county(county or "Harris")
    return {
        "parse_ok": parse_ok,
        "tz": tzname,
        "now_local": now.isoformat(),
        "weekday": dow,
        "parsed_keys": keys,
        "has_default_list": isinstance(sched.get("default"), list),
        "sample_input": {"county": county or "Harris", "lang": lang},
        "sample_plan": plan,
        "fallback_via_routes": fallback
    }

@router.post("/notify_agent")
async def notify_agent(payload: Dict[str, Any], request: Request):
    """Send an SMS summary to the on-call agent(s) before/while transferring.
    Input JSON (either single or multiple recipients):
    - to_phone (E.164, optional) — single recipient (backward compatible)
    - to_phones (array of E.164, optional) — multiple recipients (e.g., all on-call agents)
    - agent_name (string, optional) — resolve single agent name to phone
    - county (optional)
    - inmate (object with full_name?, dob?)
    - bail (object with total_bond?, amount_numeric?, eligible?, bond_text?, needs_human_review?)
    - caller (object with name?, phone?, relationship?, intends_to_post?)
    - summary (string, optional freeform notes/summary)
    
    At least one of: to_phone, to_phones, or agent_name must be provided.
    Returns: { ok: true, sent_count: N, recipients: [...], errors: [...] }
    """
    _auth(request)
    
    # Gather all recipient phone numbers
    recipients = []
    
    # Option 1: to_phones array (primary for multi-recipient)
    to_phones_input = payload.get("to_phones")
    if isinstance(to_phones_input, list):
        for ph in to_phones_input:
            normalized = _e164(ph)
            if normalized:
                recipients.append(normalized)
    
    # Option 2: to_phone single recipient (backward compatible)
    to_phone_input = payload.get("to_phone")
    if to_phone_input and not recipients:
        normalized = _e164(to_phone_input)
        if normalized:
            recipients.append(normalized)
    
    # Option 3: agent_name lookup (only if no to_phone/to_phones provided)
    agent_name = (payload.get("agent_name") or "").strip() or None
    if agent_name and not recipients:
        ph = _agent_phone_from_name(agent_name)
        if ph:
            recipients.append(ph)
    
    if not recipients:
        raise HTTPException(400, "Provide 'to_phone' (E.164), 'to_phones' (array), or 'agent_name' matching ONCALL_AGENTS_JSON")
    
    county = (payload.get("county") or "").strip() or None
    inmate = payload.get("inmate") or {}
    bail = payload.get("bail") or {}
    caller = payload.get("caller") or {}
    summary = (payload.get("summary") or "").strip() or None
    topic = (payload.get("topic") or payload.get("subject") or "").strip() or None
    urgency = payload.get("urgency")

    body = _compose_agent_sms(
        county=county, inmate=inmate, bail=bail, caller=caller, summary=summary, topic=topic, urgency=urgency
    )
    
    # Send SMS to all recipients and collect results
    sent_count = 0
    errors = []
    
    for to in recipients:
        provider_response = None
        error_msg = None
        try:
            provider_response = send_sms(to, body)
            sent_count += 1
            logs.insert_one({
                "type": "notify_agent_sms",
                "ts": int(time.time()),
                "to": to,
                "body": body,
                "res": provider_response
            })
        except Exception as e:
            error_msg = str(e)
            errors.append({"phone": to, "error": error_msg})
            logs.insert_one({
                "type": "notify_agent_sms_error",
                "ts": int(time.time()),
                "to": to,
                "body": body,
                "err": error_msg
            })

    return {
        "ok": True,
        "sent_count": sent_count,
        "total_recipients": len(recipients),
        "recipients": recipients,
        "errors": errors if errors else None
    }

@router.get("/agents")
async def list_agents(request: Request):
    """List configured on-call agents (names only) and whether phones are valid.
    Requires Bearer token.
    """
    _auth(request)
    roster = _agents_map()
    out = []
    for name, info in roster.items():
        ph = (info or {}).get("phone")
        out.append({
            "name": name,
            "phone": ph,
            "valid_e164": bool(_e164(ph)),
            "aliases": (info or {}).get("aliases") or []
        })
    return {"ok": True, "agents": out}

@router.get("/agent_phone")
async def get_agent_phone(name: str, request: Request):
    """Resolve a single agent phone by name for diagnostics."""
    _auth(request)
    ph = _agent_phone_from_name(name)
    return {"ok": bool(ph), "name": name, "phone": ph}

@router.post("/notify_group")
async def notify_group(payload: Dict[str, Any], request: Request):
    """Send an SMS/WhatsApp summary to multiple recipients.
    Input JSON:
    - to_phones: array of E.164 strings (required)
    - county, inmate, bail, caller, summary: same as /notify_agent (optional)
    Returns: { ok: true, sent: [...], failed: [...]} with per-recipient provider responses.
    """
    _auth(request)
    tos_raw = payload.get("to_phones") or []
    if not isinstance(tos_raw, list) or not tos_raw:
        raise HTTPException(400, "Provide non-empty 'to_phones' array of E.164 numbers")
    to_list: List[str] = []
    for p in tos_raw:
        e = _e164(str(p))
        if e:
            to_list.append(e)
    if not to_list:
        raise HTTPException(400, "No valid E.164 numbers in 'to_phones'")

    county = (payload.get("county") or "").strip() or None
    inmate = payload.get("inmate") or {}
    bail = payload.get("bail") or {}
    caller = payload.get("caller") or {}
    summary = (payload.get("summary") or "").strip() or None
    topic = (payload.get("topic") or payload.get("subject") or "").strip() or None
    urgency = payload.get("urgency")

    body = _compose_agent_sms(
        county=county, inmate=inmate, bail=bail, caller=caller, summary=summary, topic=topic, urgency=urgency
    )
    sent: List[Dict[str, Any]] = []
    failed: List[Dict[str, Any]] = []
    for to in to_list:
        try:
            res = send_sms(to, body)
            logs.insert_one({"type":"notify_group_sms","to":to,"body":body,"ts":int(time.time()),"res":res})
            sent.append({"to": to, "provider_response": res})
        except Exception as e:
            logs.insert_one({"type":"notify_group_sms_error","to":to,"err":str(e),"ts":int(time.time())})
            failed.append({"to": to, "error": str(e)})
    return {"ok": True, "sent": sent, "failed": failed, "count": {"sent": len(sent), "failed": len(failed)}}

# ---------- optional webhooks ----------
@router.post("/ai_events")
async def telnyx_ai_events(payload: Dict[str, Any], request: Request):
    """Receive Telnyx AI Assistant events (session start/end, tool calls, transcripts).
    Secured with optional X-Telnyx-Secret if configured. Does not require Bearer token.
    """
    _verify_webhook_secret(request)
    data = payload.get("data") or {}
    event_type = data.get("event_type")
    session_id = data.get("session_id") or data.get("id") or payload.get("session_id")
    call_control_id = (data.get("payload") or {}).get("call_control_id")
    logs.insert_one({
        "type": "telnyx_ai_events",
        "ts": int(time.time()),
        "event_type": event_type,
        "session_id": session_id,
        "call_control_id": call_control_id,
        "payload": payload
    })
    return {"ok": True}

@router.post("/call_events")
async def telnyx_call_events(payload: Dict[str, Any], request: Request):
    """Receive telephony-level call status events if configured in Telnyx.
    Secured with optional X-Telnyx-Secret.
    """
    _verify_webhook_secret(request)
    data = payload.get("data") or {}
    event_type = data.get("event_type")
    call_payload = data.get("payload") or {}
    call_control_id = call_payload.get("call_control_id") or call_payload.get("call_control_id_a")
    call_session_id = call_payload.get("call_session_id")
    connection_id = call_payload.get("connection_id")
    logs.insert_one({
        "type": "telnyx_call_events",
        "ts": int(time.time()),
        "event_type": event_type,
        "call_control_id": call_control_id,
        "call_session_id": call_session_id,
        "connection_id": connection_id,
        "payload": payload
    })
    return {"ok": True}

# ---------- diagnostics ----------
@router.get("/sms_status")
async def sms_status(request: Request):
    """Return which SMS providers are configured so we can debug notify_agent delivery.
    Does not send any messages. Requires Bearer token.
    """
    _auth(request)
    try:
        from .config import settings as _s
    except Exception:
        raise HTTPException(500, "Config load error")

    telnyx_ready = bool(_s.TELNYX_API_KEY and (_s.TELNYX_MESSAGING_FROM_NUMBER or _s.TELNYX_MESSAGING_PROFILE_ID))
    twilio_ready = bool(
        _s.TWILIO_ACCOUNT_SID and _s.TWILIO_AUTH_TOKEN and (
            getattr(_s, "TWILIO_MESSAGING_SERVICE_SID", None) or _s.TWILIO_FROM_NUMBER
        )
    )

    return {
        "ok": True,
        "telnyx": {
            "api_key": bool(_s.TELNYX_API_KEY),
            "from_number": bool(_s.TELNYX_MESSAGING_FROM_NUMBER),
            "messaging_profile_id": bool(_s.TELNYX_MESSAGING_PROFILE_ID),
            "configured": telnyx_ready
        },
        "twilio": {
            "account_sid": bool(_s.TWILIO_ACCOUNT_SID),
            "from_number": bool(_s.TWILIO_FROM_NUMBER),
            "messaging_service_sid": bool(getattr(_s, "TWILIO_MESSAGING_SERVICE_SID", None)),
            "use_whatsapp": bool(getattr(_s, "TWILIO_USE_WHATSAPP", False)),
            "whatsapp_from": bool(getattr(_s, "TWILIO_WHATSAPP_FROM", None)),
            "configured": twilio_ready
        },
        "send_order": ["twilio", "telnyx", "dev-noop"]
    }

@router.post("/recording_ready")
async def telnyx_recording_ready(payload: Dict[str, Any], request: Request):
    """Receive recording availability notifications (URL) when enabled in Telnyx.
    Secured with optional X-Telnyx-Secret.
    """
    _verify_webhook_secret(request)
    logs.insert_one({
        "type": "telnyx_recording_ready",
        "ts": int(time.time()),
        "payload": payload
    })
    return {"ok": True}

@router.post("/playback_start")
async def playback_start(payload: Dict[str, Any], request: Request):
    """Start playing audio (hold music) on a call via Telnyx Call Control API.
    Input JSON:
    - call_control_id (required): The call's control_id
    - audio_url (required): URL to the audio file (MP3, WAV, etc.)
    - loop (optional, default True): Whether to loop the audio
    Returns: { ok: true, call_control_id, status }
    """
    _auth(request)
    
    call_control_id = (payload.get("call_control_id") or "").strip()
    audio_url = (payload.get("audio_url") or "").strip()
    loop = payload.get("loop", True)
    
    if not call_control_id or not audio_url:
        raise HTTPException(400, "Provide 'call_control_id' and 'audio_url'")

    ccid_trim = call_control_id.strip()
    if ccid_trim.lower() in {"call_control_id", "{{call_control_id}}"} or " " in ccid_trim:
        logs.insert_one({
            "type": "telnyx_playback_start_error",
            "ts": int(time.time()),
            "call_control_id": ccid_trim,
            "error": "placeholder_call_control_id"
        })
        raise HTTPException(400, "Invalid call_control_id placeholder detected")

    if not re.match(r"^v[0-9].*", ccid_trim):
        logs.insert_one({
            "type": "telnyx_playback_start_warning",
            "ts": int(time.time()),
            "call_control_id": ccid_trim,
            "warning": "call_control_id_unexpected_format"
        })
    
    import requests
    headers = {
        "Authorization": f"Bearer {settings.TELNYX_API_KEY}",
        "Content-Type": "application/json"
    }
    body: Dict[str, Any] = {
        "audio_url": audio_url,
    }
    
    try:
        api_url = f"https://api.telnyx.com/v2/calls/{call_control_id}/actions/playback_start"
        res = requests.post(api_url, json=body, headers=headers, timeout=10)
        try:
            res.raise_for_status()
        except requests.exceptions.RequestException as e:
            status = res.status_code if res is not None else None
            try:
                body_txt = res.text if res is not None else ""
            except Exception:
                body_txt = "<unreadable response>"
            logs.insert_one({
                "type": "telnyx_playback_start_error",
                "ts": int(time.time()),
                "call_control_id": call_control_id,
                "status": status,
                "response": body_txt,
                "error": str(e)
            })
            raise HTTPException(500, f"Playback start failed: {status} {body_txt}".strip())
        data = res.json()
        
        logs.insert_one({
            "type": "telnyx_playback_start",
            "ts": int(time.time()),
            "call_control_id": call_control_id,
            "audio_url": audio_url,
            "status": data.get("result", {}).get("status", "unknown")
        })
        
        return {
            "ok": True,
            "call_control_id": call_control_id,
            "status": data.get("result", {}).get("status", "unknown")
        }
    except requests.exceptions.RequestException as e:
        err_msg = str(e)
        logs.insert_one({
            "type": "telnyx_playback_start_error",
            "ts": int(time.time()),
            "call_control_id": call_control_id,
            "error": err_msg
        })
        raise HTTPException(500, f"Playback start failed: {err_msg}")

@router.post("/playback_stop")
async def playback_stop(payload: Dict[str, Any], request: Request):
    """Stop playing audio on a call via Telnyx Call Control API.
    Input JSON:
    - call_control_id (required): The call's control_id
    Returns: { ok: true, call_control_id, status }
    """
    _auth(request)
    
    call_control_id = (payload.get("call_control_id") or "").strip()
    
    if not call_control_id:
        raise HTTPException(400, "Provide 'call_control_id'")
    
    import requests
    headers = {
        "Authorization": f"Bearer {settings.TELNYX_API_KEY}",
        "Content-Type": "application/json"
    }
    
    try:
        api_url = f"https://api.telnyx.com/v2/calls/{call_control_id}/actions/playback_stop"
        res = requests.post(api_url, json={}, headers=headers, timeout=10)
        res.raise_for_status()
        data = res.json()
        
        logs.insert_one({
            "type": "telnyx_playback_stop",
            "ts": int(time.time()),
            "call_control_id": call_control_id,
            "status": data.get("result", {}).get("status", "unknown")
        })
        
        return {
            "ok": True,
            "call_control_id": call_control_id,
            "status": data.get("result", {}).get("status", "unknown")
        }
    except requests.exceptions.RequestException as e:
        err_msg = str(e)
        logs.insert_one({
            "type": "telnyx_playback_stop_error",
            "ts": int(time.time()),
            "call_control_id": call_control_id,
            "error": err_msg
        })
        raise HTTPException(500, f"Playback stop failed: {err_msg}")

@router.get("/debug_recent")
async def telnyx_debug_recent(request: Request, types: Optional[str] = None, limit: int = 50):
    """Return recent Telnyx-related log entries for debugging transfers.
    Requires Bearer token. Query params:
      - types: comma-separated filters (e.g., "telnyx_ai_events,telnyx_call_events,notify_agent_sms*")
      - limit: number of records to return (default 50, max 200)

    This surfaces lightweight fields only to avoid large payloads.
    """
    _auth(request)
    try:
        q = {}
        if types:
            pats = [t.strip() for t in types.split(",") if t.strip()]
            if pats:
                # Build $or with regex for simple glob-like matching when trailing * is used
                ors = []
                for p in pats:
                    if p.endswith("*"):
                        ors.append({"type": {"$regex": f"^{p[:-1]}"}})
                    else:
                        ors.append({"type": p})
                q = {"$or": ors}
        lim = max(1, min(int(limit or 50), 200))
        cur = logs.find(q or {"type": {"$regex": "^telnyx_"}}).sort([("ts", -1)]).limit(lim)
        out = []
        for d in cur:
            # Trim very large payloads to avoid huge responses
            payload = d.get("payload")
            if isinstance(payload, dict):
                # Keep only top-level small keys
                small = {k: v for k, v in payload.items() if k in ("event", "status", "call_id", "session_id", "to", "from", "reason", "tool_name")}
            else:
                small = None
            out.append({
                "ts": d.get("ts"),
                "type": d.get("type"),
                "call_control_id": d.get("call_control_id"),
                "call_session_id": d.get("call_session_id"),
                "status": d.get("status"),
                "error": d.get("error"),
                "response": d.get("response"),
                "event_type": d.get("event_type"),
                "notes": d.get("notes"),
                "meta": small
            })
        return {"ok": True, "count": len(out), "items": out}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"debug_recent error: {e}")


@router.get("/call_log")
async def telnyx_call_log(
    request: Request,
    call_control_id: Optional[str] = None,
    call_session_id: Optional[str] = None,
    limit: int = 200
):
    """Fetch detailed log records for a specific call or session."""
    _auth(request)
    if not call_control_id and not call_session_id:
        raise HTTPException(400, "Provide call_control_id or call_session_id")
    try:
        q: Dict[str, Any] = {"$or": []}
        if call_control_id:
            q["$or"].append({"call_control_id": call_control_id})
            # Also consider nested payloads for historical entries
            q["$or"].append({"payload.data.payload.call_control_id": call_control_id})
        if call_session_id:
            q["$or"].append({"call_session_id": call_session_id})
            q["$or"].append({"payload.data.payload.call_session_id": call_session_id})
        if not q["$or"]:
            raise HTTPException(400, "Invalid query parameters")
        lim = max(1, min(int(limit or 100), 500))
        cur = logs.find(q).sort([("ts", -1)]).limit(lim)
        items: List[Dict[str, Any]] = []
        for d in cur:
            rec = {
                "ts": d.get("ts"),
                "type": d.get("type"),
                "event_type": d.get("event_type"),
                "call_control_id": d.get("call_control_id"),
                "call_session_id": d.get("call_session_id"),
                "status": d.get("status"),
                "error": d.get("error"),
                "response": d.get("response"),
                "notes": d.get("notes"),
                "payload": d.get("payload")
            }
            items.append(rec)
        return {"ok": True, "count": len(items), "items": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"call_log error: {e}")
