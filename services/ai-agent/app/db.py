# app/db.py
from pymongo import MongoClient, ASCENDING, DESCENDING
from .config import settings

_client = MongoClient(settings.MONGO_URI)
_db = _client[settings.MONGO_DB]

# Collections for the AI Agent (Telnyx) flows
persons         = _db["persons"]
custody_events  = _db["custody_events"]
inquiries       = _db["inquiries"]
logs            = _db["logs"]
callback_queue  = _db["callback_queue"]

# Collections referenced by main.py from the Rapid Locate code path
cases           = _db["cases"]
checkins        = _db["checkins"]
links           = _db["links"]

# Optional indexes (safe to run repeatedly)
persons.create_index([("full_name", ASCENDING)])
persons.create_index([("dob", ASCENDING)])
custody_events.create_index([("person_id", ASCENDING), ("scraped_at", DESCENDING)])
inquiries.create_index([("created_ts", DESCENDING)])
logs.create_index([("ts", DESCENDING)])
callback_queue.create_index([("requested_at", ASCENDING), ("status", ASCENDING)])
callback_queue.create_index([("caller_phone", ASCENDING)])
callback_queue.create_index([("status", ASCENDING)])

# (Optional) for the rapid_locate collections if you plan to use them:
cases.create_index([("case_id", ASCENDING)], unique=True)
checkins.create_index([("case_id", ASCENDING), ("ts", DESCENDING)])
links.create_index([("case_id", ASCENDING), ("ts", DESCENDING)])