from datetime import datetime, timedelta
from typing import Optional

from fastapi import FastAPI, Form, UploadFile, File
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.requests import Request

from .detector import classify_focus_state
from .database import init_db, create_session, complete_session, get_recent_sessions
from .notifier import send_email_summary, send_sms_summary

app = FastAPI()

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

init_db()


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/history", response_class=HTMLResponse)
async def history(request: Request):
    sessions = get_recent_sessions(limit=50)
    # convert to plain dicts for Jinja simplicity
    sessions_list = [dict(row) for row in sessions]
    return templates.TemplateResponse(
        "history.html",
        {"request": request, "sessions": sessions_list},
    )


@app.post("/start-session")
async def start_session(
    duration_minutes: int = Form(...),
    alert_threshold: float = Form(...),  # seconds
    alert_mode: str = Form(...),
    email: Optional[str] = Form(None),
    phone: Optional[str] = Form(None),
    send_email_flag: Optional[bool] = Form(False),
    send_sms_flag: Optional[bool] = Form(False),
):
    ends_at = datetime.utcnow() + timedelta(minutes=duration_minutes)
    alert_threshold_ms = int(alert_threshold * 1000)

    send_email_bool = bool(send_email_flag) and bool(email)
    send_sms_bool = bool(send_sms_flag) and bool(phone)

    session_id = create_session(
        duration_minutes=duration_minutes,
        email=email,
        phone=phone,
        alert_threshold_ms=alert_threshold_ms,
        alert_mode=alert_mode,
        send_email=send_email_bool,
        send_sms=send_sms_bool,
    )
    return {
        "session_id": session_id,
        "duration_minutes": duration_minutes,
        "email": email,
        "alert_threshold_ms": alert_threshold_ms,
        "alert_mode": alert_mode,
        "ends_at": ends_at.isoformat(),
    }


@app.post("/frame")
async def process_frame(
    session_id: int = Form(...),
    frame: UploadFile = File(...),
):
    data = await frame.read()
    focused = classify_focus_state(data)
    return {"focused": bool(focused)}


@app.post("/end-session")
async def end_session(
    session_id: int = Form(...),
    total_seconds: int = Form(...),
    focused_seconds: int = Form(...),
    unfocused_seconds: int = Form(...),
    breaks_count: int = Form(...),
    focus_percent: int = Form(...),
    ended_early: str = Form(...),
):
    ended_flag = ended_early.lower() == "true"

    session = complete_session(
        session_id=session_id,
        total_seconds=total_seconds,
        focused_seconds=focused_seconds,
        unfocused_seconds=unfocused_seconds,
        breaks_count=breaks_count,
        focus_percent=focus_percent,
        ended_early=ended_flag,
    )
    if session is None:
        return {"ok": False, "error": "Session not found"}

    send_email = bool(session["send_email"])
    send_sms = bool(session["send_sms"])

    if send_email:
        send_email_summary(session)
    if send_sms:
        send_sms_summary(session)

    total = session["total_seconds"] or 0
    focused = session["focused_seconds"] or 0
    unfocused = session["unfocused_seconds"] or 0
    breaks_val = session["breaks_count"] or 0
    fp = session["focus_percent"] or 0

    return {
        "ok": True,
        "session_id": session["id"],
        "total_seconds": total,
        "focused_seconds": focused,
        "unfocused_seconds": unfocused,
        "breaks_count": breaks_val,
        "focus_percent": fp,
        "ended_early": bool(session["ended_early"]),
    }