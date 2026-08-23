from fastapi import FastAPI, Request, UploadFile, Form, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
import time, json, os, requests, re

from .config import settings
from .db import cases, checkins, links, logs
from .tokens import make_one_time_token, verify_token
from .storage import upload_photo
from .sms import send_sms
from .geo import ip_to_geo
from .telnyx_tools import router as telnyx_router, _compute_warm_transfer_plan, _compose_expanded_whisper_text

# ---- App & mounts ----
app = FastAPI()

@app.get("/")
async def root():
    """Friendly root endpoint so platform health checks don't 404.
    Links to /healthz and /docs.
    """
    return {
        "ok": True,
        "service": "AI Agent Warrant",
        "health": "/healthz",
        "docs": "/docs"
    }

@app.head("/")
async def root_head():
    """Explicit HEAD for Render health probe. Returns 200 with no body."""
    return Response(status_code=200)

@app.get("/healthz")
async def healthz():
    # Introspect mounted routes for visibility
    paths = {getattr(r, 'path', None) for r in app.router.routes}
    return {
        "status": "ok",
        "build": getattr(settings, "BUILD_SHA", None),
        "has_transfer_plan": "/telnyx/transfer_plan" in paths,
        "has_transfer_target": "/telnyx/transfer_target" in paths,
        "has_attach_caller": "/telnyx/attach_caller" in paths,
        "has_ai_events": "/telnyx/ai_events" in paths
    }

@app.get("/hold_music/moonlightdrive.mp3")
async def serve_hold_music():
    """
    Serve hold music from local static file.
    
    This endpoint streams hold music to Telnyx playback_start API.
    The audio file is stored locally in app/static/hold/moonlightdrive.mp3.
    
    Returns: audio/mpeg stream (no authentication required for this endpoint)
    """
    file_path = "app/static/hold/moonlightdrive.mp3"
    
    try:
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Hold music file not found: {file_path}")
        
        file_size = os.path.getsize(file_path)
        
        # Log the access
        logs.insert_one({
            "type": "hold_music_served",
            "ts": int(time.time()),
            "file_path": file_path,
            "file_size": file_size
        })
        
        # Stream the audio file
        def iterate_file():
            with open(file_path, "rb") as f:
                while True:
                    chunk = f.read(8192)
                    if not chunk:
                        break
                    yield chunk
        
        return StreamingResponse(
            iterate_file(),
            media_type="audio/mpeg",
            headers={
                "Content-Length": str(file_size),
                "Cache-Control": "public, max-age=86400"
            }
        )
    except FileNotFoundError as e:
        err_msg = str(e)
        logs.insert_one({
            "type": "hold_music_error",
            "ts": int(time.time()),
            "error": err_msg
        })
        raise HTTPException(404, err_msg)
    except Exception as e:
        err_msg = str(e)
        logs.insert_one({
            "type": "hold_music_error",
            "ts": int(time.time()),
            "error": err_msg
        })
        raise HTTPException(500, f"Failed to serve hold music: {err_msg}")

# ---- WEBHOOK ENDPOINTS FOR AI ASSISTANT PLAYBACK CONTROL ----
# These endpoints are called by the Telnyx AI Assistant via the webhook tool
# to start/stop hold music on active calls

@app.post("/ai/playback_start")
async def ai_playback_start(request: Request):
    """
    Webhook endpoint for AI Assistant to start playback.
    
    Called by Telnyx AI Assistant when it needs to play hold music.
    This endpoint calls the Telnyx Call Control API to actually start playback.
    
    Expected payload (from AI Assistant webhook):
    {
        "call_control_id": "v0UID...",
        "audio_url": "https://...",
        "loop": true
    }
    """
    try:
        body = await request.json()
        call_control_id = body.get("call_control_id")
        audio_url = body.get("audio_url") or os.getenv("HOLD_MUSIC_URL")
        loop = body.get("loop", True)
        
        if not call_control_id or not audio_url:
            return JSONResponse(
                status_code=400,
                content={"ok": False, "error": "Missing call_control_id or audio_url"}
            )

        # Guard against placeholder or obviously invalid call_control_id values
        ccid_trim = call_control_id.strip()
        if ccid_trim.lower() in {"call_control_id", "{{call_control_id}}"} or " " in ccid_trim:
            logs.insert_one({
                "type": "ai_playback_start_error",
                "ts": int(time.time()),
                "call_control_id": ccid_trim,
                "error": "placeholder_call_control_id"
            })
            return JSONResponse(
                status_code=400,
                content={"ok": False, "error": "Invalid call_control_id placeholder detected"}
            )

        if not re.match(r"^v[0-9].*", ccid_trim):
            logs.insert_one({
                "type": "ai_playback_start_warning",
                "ts": int(time.time()),
                "call_control_id": ccid_trim,
                "warning": "call_control_id_unexpected_format"
            })
        
        # Call Telnyx Call Control API to start playback
        api_url = f"https://api.telnyx.com/v2/calls/{call_control_id}/actions/playback_start"
        headers = {
            "Authorization": f"Bearer {settings.TELNYX_API_KEY}",
            "Content-Type": "application/json"
        }
        payload = {
            "audio_url": audio_url
        }
        
        res = requests.post(api_url, json=payload, headers=headers, timeout=10)
        try:
            res.raise_for_status()
        except requests.exceptions.RequestException as e:
            err_body = ""
            status = res.status_code if res is not None else None
            try:
                err_body = res.text if res is not None else ""
            except Exception:
                err_body = "<unreadable response>"
            logs.insert_one({
                "type": "ai_playback_start_error",
                "ts": int(time.time()),
                "call_control_id": call_control_id,
                "status": status,
                "response": err_body,
                "error": str(e)
            })
            return JSONResponse(
                status_code=500,
                content={"ok": False, "error": f"Playback start failed: {status} {err_body}".strip()}
            )
        
        logs.insert_one({
            "type": "ai_playback_start",
            "ts": int(time.time()),
            "call_control_id": call_control_id,
            "audio_url": audio_url,
            "status": res.status_code
        })
        
        return JSONResponse(
            status_code=200,
            content={"ok": True, "status": "playback_started"}
        )
    
    except Exception as e:
        err_msg = str(e)
        logs.insert_one({
            "type": "ai_playback_start_error",
            "ts": int(time.time()),
            "error": err_msg
        })
        return JSONResponse(
            status_code=500,
            content={"ok": False, "error": err_msg}
        )

@app.post("/ai/playback_stop")
async def ai_playback_stop(request: Request):
    """
    Webhook endpoint for AI Assistant to stop playback.
    
    Called by Telnyx AI Assistant when hold music should stop.
    This endpoint calls the Telnyx Call Control API to stop playback.
    
    Expected payload (from AI Assistant webhook):
    {
        "call_control_id": "v0UID..."
    }
    """
    try:
        body = await request.json()
        call_control_id = body.get("call_control_id")
        
        if not call_control_id:
            return JSONResponse(
                status_code=400,
                content={"ok": False, "error": "Missing call_control_id"}
            )
        
        # Call Telnyx Call Control API to stop playback
        api_url = f"https://api.telnyx.com/v2/calls/{call_control_id}/actions/playback_stop"
        headers = {
            "Authorization": f"Bearer {settings.TELNYX_API_KEY}",
            "Content-Type": "application/json"
        }
        
        res = requests.post(api_url, json={}, headers=headers, timeout=10)
        res.raise_for_status()
        
        logs.insert_one({
            "type": "ai_playback_stop",
            "ts": int(time.time()),
            "call_control_id": call_control_id,
            "status": res.status_code
        })
        
        return JSONResponse(
            status_code=200,
            content={"ok": True, "status": "playback_stopped"}
        )
    
    except requests.exceptions.RequestException as e:
        err_msg = str(e)
        logs.insert_one({
            "type": "ai_playback_stop_error",
            "ts": int(time.time()),
            "error": err_msg
        })
        return JSONResponse(
            status_code=500,
            content={"ok": False, "error": f"Playback stop failed: {err_msg}"}
        )
    except Exception as e:
        err_msg = str(e)
        logs.insert_one({
            "type": "ai_playback_stop_error",
            "ts": int(time.time()),
            "error": err_msg
        })
        return JSONResponse(
            status_code=500,
            content={"ok": False, "error": err_msg}
        )

# ---- DYNAMIC VARIABLES WEBHOOK FOR TELNYX FLOW ----
# Called by Telnyx Flow when resolving {{primary_number}} in Transfer action

@app.post("/dynamic-variables")
async def dynamic_variables(request: Request):
    """
    Telnyx Dynamic Variables Webhook.
    
    Called by Telnyx Flow to resolve template variables like {{primary_number}}.
    This endpoint calls the warm transfer plan logic internally to get the current routing
    number and returns it in the format Telnyx expects.
    
    Response format (required by Telnyx):
    {
        "dynamic_variables": {
            "primary_number": "+1XXXXXXXXXX"
        }
    }
    """
    try:
        body = await request.json()
        
        # Log incoming request for debugging
        logs.insert_one({
            "type": "dynamic_variables_webhook_received",
            "ts": int(time.time()),
            "payload": body
        })
        
        # Extract context from Telnyx payload (optional, for future use)
        payload = body.get("data", {}).get("payload", {})
        
        # Call the warm transfer plan logic to get the routing number
        # Pass empty/minimal context since this is just for variable resolution
        plan_result = _compute_warm_transfer_plan(
            county=None,
            lang="en",
            inmate={},
            bail={},
            caller={},
            summary=None,
            topic=None,
            urgency="medium"
        )
        
        # Extract primary_number from the plan result
        primary_number = plan_result.get("primary_number")
        
        if not primary_number:
            # Fallback to default office number from config
            primary_number = getattr(settings, "DEFAULT_OFFICE_NUMBER", "+6263796590")
        
        logs.insert_one({
            "type": "dynamic_variables_resolved",
            "ts": int(time.time()),
            "primary_number": primary_number
        })
        
        # Return response in exact format Telnyx expects
        return JSONResponse(
            status_code=200,
            content={
                "dynamic_variables": {
                    "primary_number": primary_number
                }
            }
        )
    
    except Exception as e:
        err_msg = str(e)
        
        # On error, return fallback number
        fallback_number = getattr(settings, "DEFAULT_OFFICE_NUMBER", "+6263796590")
        
        logs.insert_one({
            "type": "dynamic_variables_error",
            "ts": int(time.time()),
            "error": err_msg,
            "fallback_used": fallback_number
        })
        
        # Still return valid response to prevent Telnyx timeout
        return JSONResponse(
            status_code=200,
            content={
                "dynamic_variables": {
                    "primary_number": fallback_number
                }
            }
        )

@app.post("/expanded_whisper")
async def expanded_whisper(request: Request):
    """
    Expanded Agent Whisper Webhook.
    
    Called by Telnyx Flow when agent presses 1 (wants more information).
    Takes the same context data as warm_transfer_plan and returns expanded whisper text
    with full call details (dates, eligibility, caller info, etc.).
    
    Input JSON: { county?, lang?, inmate?, bail?, caller?, summary?, topic?, urgency? }
    Response JSON:
    {
        "ok": true,
        "expanded_whisper": "string with full call details"
    }
    """
    try:
        body = await request.json()
        
        # Extract context from request
        county = body.get("county")
        inmate = body.get("inmate")
        bail = body.get("bail")
        caller = body.get("caller")
        summary = body.get("summary")
        topic = body.get("topic")
        urgency = body.get("urgency")
        
        logs.insert_one({
            "type": "expanded_whisper_webhook_received",
            "ts": int(time.time()),
            "county": county,
            "inmate_name": inmate.get("name") if inmate else None
        })
        
        # Generate expanded whisper using the full context
        expanded_text = _compose_expanded_whisper_text(
            county=county,
            inmate=inmate,
            bail=bail,
            caller=caller,
            summary=summary,
            topic=topic,
            urgency=urgency
        )
        
        logs.insert_one({
            "type": "expanded_whisper_generated",
            "ts": int(time.time()),
            "whisper_length": len(expanded_text)
        })
        
        return JSONResponse(
            status_code=200,
            content={
                "ok": True,
                "expanded_whisper": expanded_text
            }
        )
    
    except Exception as e:
        err_msg = str(e)
        
        logs.insert_one({
            "type": "expanded_whisper_error",
            "ts": int(time.time()),
            "error": err_msg
        })
        
        return JSONResponse(
            status_code=500,
            content={
                "ok": False,
                "error": err_msg
            }
        )

app.mount("/static", StaticFiles(directory="app/static"), name="static")
tpl = Jinja2Templates(directory="app/templates")

# Telnyx tool webhooks
app.include_router(telnyx_router)

# ---- Helper: IP + UA ----
def client_meta(req: Request):
    ip = req.headers.get("x-forwarded-for", req.client.host)
    ua = req.headers.get("user-agent", "")
    return ip.split(",")[0].strip(), ua

# ---- Helper: unified event logger ----
async def log_event(case_id: str, req: Request, evt_type: str,
                    person_id: str | None = None, notes: str | None = None,
                    tok: str | None = None, extra: dict | None = None):
    ip, ua = client_meta(req)
    geo = await ip_to_geo(ip)
    doc = {
        "ts": int(time.time()),
        "case_id": case_id,
        "person_id": person_id,
        "type": evt_type,
        "ip": ip,
        "user_agent": ua,
        "geo": geo,
        "notes": notes,
        "tok": tok,
    }
    if extra:
        doc.update(extra)
    logs.insert_one(doc)
    return doc

# ---- Beacons (pixel + css) ----
@app.get("/px/{case_id}")
async def px(case_id: str, req: Request, tok: str | None = None):
    await log_event(case_id, req, evt_type="asset_hit", notes="tracking_pixel", tok=tok)
    # 1x1 transparent GIF
    return Response(
        content=(
            b"GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xFF\xFF\xFF!\xF9\x04"
            b"\x01\x00\x00\x01\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;"
        ),
        media_type="image/gif"
    )

@app.get("/css/{case_id}.css")
async def css(case_id: str, req: Request, tok: str | None = None):
    await log_event(case_id, req, evt_type="asset_hit", notes="css_beacon", tok=tok)
    return Response("body{visibility:visible}", media_type="text/css")

# ---- Preview page (OG card) ----
@app.get("/p/{case_id}", response_class=HTMLResponse)
async def preview_page(req: Request, case_id: str):
    case = cases.find_one({"case_id": case_id}) or {}

    page_url = f"{settings.BASE_URL}/p/{case_id}"
    # Prefer case-specific image; fall back to a default
    og_candidate = f"{settings.BASE_URL}/static/og/{case_id}.jpg"
    og_default   = f"{settings.BASE_URL}/static/og/default.jpg"
    og_img = og_candidate if os.path.exists("app/static/og/"+case_id+".jpg") else og_default

    action_tok = make_one_time_token(case.get("person_id", "unknown"), case_id, ttl_seconds=3600)
    action_url = f"{settings.BASE_URL}/checkin?tok={action_tok}"

    await log_event(case_id, req, evt_type="preview_view", person_id=case.get("person_id"))

    return tpl.TemplateResponse("preview.html", {
        "request": req,
        "title": "Required Check‑In",
        "og_title": f"Required Check‑In for {case.get('name','Defendant')}",
        "og_desc": "Tap to securely share your location to verify compliance.",
        "og_url": page_url,
        "og_image": og_img,
        "name": case.get("name","Defendant"),
        "case_id": case_id,
        "action_url": action_url,
        "beacon_css": f"{settings.BASE_URL}/css/{case_id}.css?tok={action_tok}",
        "beacon_px":  f"{settings.BASE_URL}/px/{case_id}?tok={action_tok}",
    })

# ---- Check-in page ----
@app.get("/checkin", response_class=HTMLResponse)
async def checkin_page(req: Request, tok: str):
    try:
        payload = verify_token(tok)
    except Exception:
        raise HTTPException(400, "Invalid or expired link")

    case_id = payload.get("case")
    person_id = payload.get("sub")

    await log_event(case_id, req, evt_type="checkin_view", person_id=person_id, tok=tok)

    return tpl.TemplateResponse("checkin.html", {
        "request": req,
        "tok": tok,
        "case_id": case_id
    })

# ---- Receive check-in ----
@app.post("/api/checkin")
async def api_checkin(request: Request, token: str = Form(...), photo: UploadFile | None = None,
                      loc: str = Form(""), loc_error: str = Form("")):
    ip, ua = client_meta(request)

    try:
        payload = verify_token(token)
    except Exception:
        raise HTTPException(400, "Invalid or expired token")

    person_id = payload.get("sub")
    case_id = payload.get("case")

    gps = json.loads(loc) if loc else None

    photo_url = None
    if photo and photo.filename:
        content = await photo.read()
        try:
            photo_url = upload_photo(content, key_prefix=person_id or "unknown")
        except Exception:
            # If S3 is disabled, upload_photo returns None; keep going
            photo_url = None

    checkins.insert_one({
        "person_id": person_id,
        "case_id": case_id,
        "ts": int(time.time()),
        "ip": ip,
        "user_agent": ua,
        "gps": gps,
        "loc_error": loc_error,
        "photo_url": photo_url,
        "outcome": "ok" if gps or photo_url else "partial"
    })

    await log_event(case_id, request, evt_type="checkin_submit", person_id=person_id, tok=token,
                    extra={"had_gps": bool(gps), "had_photo": bool(photo_url)})

    # Queue follow-up (log-only in this starter)
    try:
        case = cases.find_one({"case_id": case_id}) or {}
        to = case.get("phone")
        if to:
            logs.insert_one({"type":"followup_queued","case_id":case_id,"ts":int(time.time())})
    except Exception as e:
        logs.insert_one({"type":"followup_error","case_id":case_id,"err":str(e),"ts":int(time.time())})

    return JSONResponse({"ok": True})

# ---- Record explicit refusal ----
@app.post("/api/refusal")
async def api_refusal(request: Request, tok: str):
    ip, ua = client_meta(request)
    try:
        payload = verify_token(tok)
    except Exception:
        raise HTTPException(400, "Invalid or expired link")

    case_id = payload.get("case")
    person_id = payload.get("sub")

    geo = await ip_to_geo(ip)

    await log_event(case_id, request, evt_type="refusal", person_id=person_id, tok=tok, extra={"geo": geo})

    checkins.insert_one({
        "person_id": person_id,
        "case_id": case_id,
        "ts": int(time.time()),
        "ip": ip,
        "user_agent": ua,
        "gps": None,
        "loc_error": "refused",
        "photo_url": None,
        "outcome": "refused",
        "geo": geo
    })

    return JSONResponse({"ok": True})

# ---- Admin: last-known area (coarse) ----
@app.get("/admin/last_area/{case_id}", response_class=HTMLResponse)
async def admin_last_area(req: Request, case_id: str):
    last = (logs.find_one({"case_id": case_id, "geo": {"$ne": None}}, sort=[("ts", -1)])
            or checkins.find_one({"case_id": case_id, "geo": {"$ne": None}}, sort=[("ts", -1)]))
    if not last or not last.get("geo"):
        return HTMLResponse(f"<h3>No geo on record yet for {case_id}</h3>", status_code=200)

    geo = last["geo"]
    name = (cases.find_one({"case_id": case_id}) or {}).get("name", "Defendant")

    return tpl.TemplateResponse("admin_last_area.html", {
        "request": req,
        "case_id": case_id,
        "name": name,
        "geo": geo,
        "ts": last.get("ts", 0)
    })

# ---- Admin: send link ----
@app.post("/admin/send_link/{case_id}")
async def admin_send_link(case_id: str):
    case = cases.find_one({"case_id": case_id})
    if not case:
        raise HTTPException(404, "Case not found")

    preview_url = f"{settings.BASE_URL}/p/{case_id}"
    action_tok = make_one_time_token(case["person_id"], case_id)
    action_url = f"{settings.BASE_URL}/checkin?tok={action_tok}"

    body = (
        f"{case['name']}, immediate bond compliance check:\n"
        f"{preview_url}\n"
        f"Secure check‑in: {action_url}\n"
        f"Reply STOP to opt out."
    )

    send_sms(case["phone"], body)
    await log_event(
        case_id,
        Request(scope={"type":"http","headers":[],"client":("0.0.0.0",0)}),
        evt_type="sms_sent",
        person_id=case.get("person_id"),
        notes="admin_send_link",
        extra={"to": case["phone"]},
    )
    return {"ok": True}
