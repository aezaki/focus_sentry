const form = document.getElementById("session-form");
const statusDiv = document.getElementById("session-status");
const sessionPanel = document.getElementById("session-panel");
const summaryPanel = document.getElementById("summary-panel");
const summaryText = document.getElementById("summary-text");
const video = document.getElementById("video");
const focusStatus = document.getElementById("focus-status");
const timerDisplay = document.getElementById("timer");
const endButton = document.getElementById("end-session-button");
const alertSound = document.getElementById("alert-sound");

let sessionId = null;
let frameIntervalId = null;
let countdownIntervalId = null;
let mediaStream = null;

let currentState = "unknown";
let lastStateChangeMs = null;
let unfocusedStartMs = null;
let alertTriggeredThisBreak = false;

let focusedMsTotal = 0;
let unfocusedMsTotal = 0;
let breaksCount = 0;

let UNFOCUSED_THRESHOLD_MS = 2500;
let alertMode = "popup";

async function startCamera() {
    mediaStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
    });
    video.srcObject = mediaStream;
}

form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const durationMinutes = Number(e.target.duration.value);
    const email = e.target.email.value;
    const phone = e.target.phone.value;
    const alertThresholdSeconds = Number(e.target.alert_threshold.value);
    const mode = e.target.alert_mode.value;

    const sendEmail = e.target.send_email.checked;
    const sendSms = e.target.send_sms.checked;

    const formData = new FormData();
    formData.append("duration_minutes", durationMinutes);
    formData.append("alert_threshold", alertThresholdSeconds);
    formData.append("alert_mode", mode);
    if (email) {
        formData.append("email", email);
    }
    if (phone) {
        formData.append("phone", phone);
    }
    if (sendEmail) {
        formData.append("send_email_flag", "true");
    }
    if (sendSms) {
        formData.append("send_sms_flag", "true");
    }

    statusDiv.textContent = "Starting session...";

    try {
        const res = await fetch("/start-session", {
            method: "POST",
            body: formData,
        });

        if (!res.ok) {
            statusDiv.textContent = "Failed to start session.";
            return;
        }

        const data = await res.json();
        sessionId = data.session_id;

        UNFOCUSED_THRESHOLD_MS = data.alert_threshold_ms;
        alertMode = data.alert_mode;

        statusDiv.textContent = "Session started.";
        sessionPanel.style.display = "block";
        summaryPanel.style.display = "none";

        resetTracking();
        await startCamera();
        startFrameLoop();
        startCountdown(durationMinutes);
    } catch (err) {
        console.error(err);
        statusDiv.textContent = "Error talking to the server.";
    }
});

endButton.addEventListener("click", () => {
    endSessionNow(true);
});

function resetTracking() {
    currentState = "unknown";
    lastStateChangeMs = Date.now();
    unfocusedStartMs = null;
    alertTriggeredThisBreak = false;

    focusedMsTotal = 0;
    unfocusedMsTotal = 0;
    breaksCount = 0;

    focusStatus.textContent = "Focus state: unknown";
}

function startFrameLoop() {
    if (frameIntervalId) {
        clearInterval(frameIntervalId);
    }
    frameIntervalId = setInterval(sendFrame, 500);
}

async function sendFrame() {
    if (!sessionId || !video.srcObject) {
        return;
    }

    const blob = await captureFrameBlob();
    if (!blob) {
        return;
    }

    const formData = new FormData();
    formData.append("session_id", sessionId);
    formData.append("frame", blob, "frame.jpg");

    try {
        const res = await fetch("/frame", {
            method: "POST",
            body: formData,
        });

        if (!res.ok) {
            console.error("Frame request failed", res.status);
            return;
        }

        const data = await res.json();
        handleFocusState(Boolean(data.focused));
    } catch (err) {
        console.error("Error sending frame", err);
    }
}

function captureFrameBlob() {
    return new Promise((resolve) => {
        const canvas = document.createElement("canvas");
        canvas.width = 320;
        canvas.height = 240;
        const ctx = canvas.getContext("2d");

        try {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        } catch (err) {
            console.error("Error drawing frame", err);
            resolve(null);
            return;
        }

        canvas.toBlob(
            (blob) => {
                resolve(blob);
            },
            "image/jpeg",
            0.6
        );
    });
}

function handleFocusState(isFocused) {
    const now = Date.now();

    if (lastStateChangeMs === null) {
        lastStateChangeMs = now;
    }

    const delta = now - lastStateChangeMs;
    if (currentState === "focused") {
        focusedMsTotal += delta;
    } else if (currentState === "unfocused") {
        unfocusedMsTotal += delta;
    }

    if (isFocused) {
        if (currentState === "unfocused") {
            breaksCount += 1;
            unfocusedStartMs = null;
            alertTriggeredThisBreak = false;
        }
        currentState = "focused";
        focusStatus.textContent = "Focus state: focused";
    } else {
        if (currentState !== "unfocused") {
            currentState = "unfocused";
            unfocusedStartMs = now;
            alertTriggeredThisBreak = false;
            focusStatus.textContent = "Focus state: unfocused";
        } else {
            if (
                !alertTriggeredThisBreak &&
                unfocusedStartMs &&
                now - unfocusedStartMs >= UNFOCUSED_THRESHOLD_MS
            ) {
                alertTriggeredThisBreak = true;
                triggerAlert();
            }
        }
    }

    lastStateChangeMs = now;
}

function triggerAlert() {
    if (alertMode === "popup" || alertMode === "both") {
        alert("You looked away longer than your alert threshold.");
    }
    if (alertMode === "sound" || alertMode === "both") {
        if (alertSound) {
            alertSound.currentTime = 0;
            alertSound.play().catch(() => {});
        }
    }
}

function startCountdown(durationMinutes) {
    if (countdownIntervalId) {
        clearInterval(countdownIntervalId);
    }

    const totalMs = durationMinutes * 60 * 1000;
    const startTime = Date.now();
    const endTime = startTime + totalMs;

    countdownIntervalId = setInterval(() => {
        const now = Date.now();
        const remainingMs = endTime - now;

        if (remainingMs <= 0) {
            timerDisplay.textContent = "Time left: 0:00";
            clearInterval(countdownIntervalId);
            countdownIntervalId = null;
            endSessionNow(false);
            return;
        }

        const totalSeconds = Math.floor(remainingMs / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        timerDisplay.textContent =
            "Time left: " + minutes + ":" + String(seconds).padStart(2, "0");
    }, 1000);
}

function endSessionNow(endedEarly) {
    if (!sessionId && sessionId !== 0) {
        return;
    }

    if (frameIntervalId) {
        clearInterval(frameIntervalId);
        frameIntervalId = null;
    }
    if (countdownIntervalId) {
        clearInterval(countdownIntervalId);
        countdownIntervalId = null;
    }

    if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
        mediaStream = null;
    }
    video.srcObject = null;

    const now = Date.now();
    if (lastStateChangeMs !== null) {
        const delta = now - lastStateChangeMs;
        if (currentState === "focused") {
            focusedMsTotal += delta;
        } else if (currentState === "unfocused") {
            unfocusedMsTotal += delta;
        }
    }

    const totalMs = focusedMsTotal + unfocusedMsTotal;
    const totalSeconds = Math.round(totalMs / 1000);
    const focusedSeconds = Math.round(focusedMsTotal / 1000);
    const unfocusedSeconds = Math.round(unfocusedMsTotal / 1000);
    const focusPercent =
        totalSeconds > 0 ? Math.round((focusedSeconds / totalSeconds) * 100) : 0;

    const baseSummary =
        "Total time: " +
        totalSeconds +
        " seconds. Focused: " +
        focusedSeconds +
        " seconds. Unfocused: " +
        unfocusedSeconds +
        " seconds. Focus percentage: " +
        focusPercent +
        "%. Breaks: " +
        breaksCount +
        ".";

    const prefix = endedEarly ? "Session ended early. " : "Session completed. ";
    summaryText.textContent = prefix + baseSummary;
    summaryPanel.style.display = "block";

    const thisSessionId = sessionId;
    sessionId = null;

    const formData = new FormData();
    formData.append("session_id", String(thisSessionId));
    formData.append("total_seconds", String(totalSeconds));
    formData.append("focused_seconds", String(focusedSeconds));
    formData.append("unfocused_seconds", String(unfocusedSeconds));
    formData.append("breaks_count", String(breaksCount));
    formData.append("focus_percent", String(focusPercent));
    formData.append("ended_early", endedEarly ? "true" : "false");

    fetch("/end-session", {
        method: "POST",
        body: formData,
    })
        .then((res) => res.json())
        .then((data) => {
            if (!data.ok) {
                console.error("Backend failed to save session", data);
            } else {
                console.log("Session saved", data);
            }
        })
        .catch((err) => {
            console.error("Failed to send session summary to backend", err);
        });
}