from sqlite3 import Row
import os
import smtplib
from email.message import EmailMessage
from twilio.rest import Client


def send_email_summary(session: Row) -> None:
    email = session["email"]
    if not email:
        return

    smtp_host = os.environ.get("FOCUS_SMTP_HOST")
    smtp_port = os.environ.get("FOCUS_SMTP_PORT")
    smtp_user = os.environ.get("FOCUS_SMTP_USER")
    smtp_password = os.environ.get("FOCUS_SMTP_PASSWORD")
    from_email = os.environ.get("FOCUS_FROM_EMAIL", smtp_user)

    if not (smtp_host and smtp_port and smtp_user and smtp_password and from_email):
        print(f"[focus_sentry] Email config missing, would send summary to {email}")
        return

    total = session["total_seconds"] or 0
    focused = session["focused_seconds"] or 0
    unfocused = session["unfocused_seconds"] or 0
    breaks_count = session["breaks_count"] or 0

    focus_percent = 0
    if total:
        focus_percent = round(focused / total * 100)

    ended_at = session["ended_at"]
    ended_early = bool(session["ended_early"])

    prefix = "Session ended early." if ended_early else "Session completed."

    msg = EmailMessage()
    msg["Subject"] = "Your Focus Sentry session summary"
    msg["From"] = from_email
    msg["To"] = email

    body = (
        f"{prefix}\n\n"
        f"Ended at: {ended_at}\n"
        f"Total time: {total} seconds\n"
        f"Focused: {focused} seconds\n"
        f"Unfocused: {unfocused} seconds\n"
        f"Focus percentage: {focus_percent} percent\n"
        f"Breaks: {breaks_count}\n"
    )
    msg.set_content(body)

    with smtplib.SMTP_SSL(smtp_host, int(smtp_port)) as smtp:
        smtp.login(smtp_user, smtp_password)
        smtp.send_message(msg)


def send_sms_summary(session: Row) -> None:
    phone = session["phone"]
    if not phone:
        return

    account_sid = os.environ.get("FOCUS_TWILIO_ACCOUNT_SID")
    auth_token = os.environ.get("FOCUS_TWILIO_AUTH_TOKEN")
    from_number = os.environ.get("FOCUS_TWILIO_FROM_NUMBER")

    if not (account_sid and auth_token and from_number):
        print(f"[focus_sentry] SMS config missing, would send SMS to {phone}")
        return

    total = session["total_seconds"] or 0
    focused = session["focused_seconds"] or 0
    unfocused = session["unfocused_seconds"] or 0
    breaks_count = session["breaks_count"] or 0

    focus_percent = 0
    if total:
        focus_percent = round(focused / total * 100)

    ended_early = bool(session["ended_early"])
    prefix = "Session ended early." if ended_early else "Session completed."

    body = (
        f"{prefix} "
        f"Total {total}s, focused {focused}s, unfocused {unfocused}s, "
        f"focus {focus_percent} percent, breaks {breaks_count}."
    )

    client = Client(account_sid, auth_token)
    client.messages.create(
        body=body,
        from_=from_number,
        to=phone,
    )