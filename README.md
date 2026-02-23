# Focus Sentry

Focus Sentry is a small Python web app that uses your webcam to track whether you are looking at the screen during a focus session.

If you look away for longer than a configurable threshold, it alerts you with a popup, a sound, or both. At the end of the session it summarizes how much of the time you stayed focused, stores the result, and can send you an email or SMS summary.

## Features

- Start focus sessions with configurable duration
- Browser based webcam tracking using MediaPipe Face Mesh
- Real time detection of "focused" vs "not focused"
- Alerts on loss of focus after a threshold number of seconds
- End session early button with correct statistics
- Session summaries with focus percentage and break count
- Optional email and SMS summaries
- SQLite backed session history
- History page with focus percentage chart

## Tech stack

- Backend: FastAPI, SQLite, OpenCV, MediaPipe
- Frontend: vanilla HTML and JavaScript
- Notifications: SMTP email, Twilio SMS

## Running locally

1. Create and activate a virtual environment  
2. Install dependencies:

   ```bash
   pip install -r requirements.txt

3.	Run the app:
    ```bash
    uvicorn focus_sentry.app:app --reload

4.	Open http://127.0.0.1:8000 in your browser.

## Configuration

Email sending uses these environment variables:
	•	FOCUS_SMTP_HOST
	•	FOCUS_SMTP_PORT
	•	FOCUS_SMTP_USER
	•	FOCUS_SMTP_PASSWORD
	•	FOCUS_FROM_EMAIL

SMS sending uses Twilio and these environment variables:
	•	FOCUS_TWILIO_ACCOUNT_SID
	•	FOCUS_TWILIO_AUTH_TOKEN
	•	FOCUS_TWILIO_FROM_NUMBER

If these are not set, the app logs what it would send instead of failing.

## Privacy note

All webcam processing happens per frame during the session. Frames are not stored in the database. Only aggregate session statistics are saved.