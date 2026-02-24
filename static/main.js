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
const liveStats = document.getElementById("live-stats");
const focusBanner = document.getElementById("focus-banner");
const saveDefaultsCheckbox = document.getElementById("save-defaults");

const DEFAULTS_KEY = "focusSentryDefaults";

let sessionId = null;
let frameIntervalId = null;
let countdownIntervalId = null;
let mediaStream = null;

let currentState = "unknown";
let lastStateChangeMs = null;
let unfocusedStartMs = null;

let alertTriggeredThisBreak = false;
let inAlertState = false;

let focusedMsTotal = 0;
let unfocusedMsTotal = 0;
let breaksCount = 0;

let UNFOCUSED_THRESHOLD_MS = 2500;
let alertMode = "popup";

let bannerTimeoutId = null;
const BANNER_DISPLAY_MS = 3000;

function loadDefaultsFromStorage() {
    try {
        const raw = localStorage.getItem(DEFAULTS_KEY);
        if (!raw) {
            return;
        }
        const defaults = JSON.parse(raw);

        if (typeof defaults.duration === "number") {
            form.duration.value = defaults.duration;
        }
        if (typeof defaults.alert_threshold === "number") {
            form.alert_threshold.value = defaults.alert_threshold;
        }
        if (typeof defaults.alert_mode === "string") {
            form.alert_mode.value = defaults.alert_mode;
        }
        if (typeof defaults.email === "string") {
            form.email.value = defaults.email;
        }
        if (typeof defaults.phone === "string") {
            form.phone.value = defaults.phone;
        }
        if (typeof defaults.send_email === "boolean") {
            form.send_email.checked = defaults.send_email;
        }
        if (typeof defaults.send_sms === "boolean") {
            form.send_sms.checked = defaults.send_sms;
        }

        if (saveDefaultsCheckbox) {
            saveDefaultsCheckbox.checked = true;
        }
    } catch (err) {
        console.error("Failed to load defaults from localStorage", err);
    }
}

function saveDefaultsToStorage() {
    try {
        const duration = Number(form.duration.value);
        const alertThreshold = Number(form.alert_threshold.value);
        const alertModeValue = form.alert_mode.value;
        const email = form.email.value || "";
        const phone = form.phone.value || "";
        const sendEmail = form.send_email.checked;
        const sendSms = form.send_sms.checked;

        const payload = {
            duration: isNaN(duration) ? 60 : duration,
            alert_threshold: isNaN(alertThreshold) ? 2.5 : alertThreshold,
            alert_mode: alertModeValue,
            email,
            phone,
            send_email: sendEmail,
            send_sms: sendSms,
        };

        localStorage.setItem(DEFAULTS_KEY, JSON.stringify(payload));
    } catch (err) {
        console.error("Failed to save defaults to localStorage", err);
    }
}

async function startCamera() {
    mediaStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
    });
    video.srcObject = mediaStream;
}

form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const durationMinutes = Number(form.duration.value);
    const email = form.email.value;
    const phone = form.phone.value;
    const alertThresholdSeconds = Number(form.alert_threshold.value);
    const mode = form.alert_mode.value;

    const sendEmail = form.send_email.checked;
    const sendSms = form.send_sms.checked;

    if (saveDefaultsCheckbox && saveDefaultsCheckbox.checked) {
        saveDefaultsToStorage();
    }

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
    inAlertState = false;

    focusedMsTotal = 0;
    unfocusedMsTotal = 0;
    breaksCount = 0;

    focusStatus.textContent = "Focus state: unknown";
    video.classList.remove("video-focused", "video-unfocused");
    video.style.borderColor = "transparent";
    hideBanner();
    updateLiveStats();
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

            if (inAlertState) {
                showBanner("Back on track. You are focused again.", "info");
            }

            unfocusedStartMs = null;
            alertTriggeredThisBreak = false;
            inAlertState = false;
        }

        currentState = "focused";
        focusStatus.textContent = "Focus state: focused";
        video.classList.add("video-focused");
        video.classList.remove("video-unfocused");
        video.style.borderColor = "#16a34a";
    } else {
        if (currentState !== "unfocused") {
            currentState = "unfocused";
            unfocusedStartMs = now;
            alertTriggeredThisBreak = false;
            focusStatus.textContent = "Focus state: unfocused";
            video.classList.add("video-unfocused");
            video.classList.remove("video-focused");
            video.style.borderColor = "#dc2626";
        } else {
            if (
                !alertTriggeredThisBreak &&
                unfocusedStartMs &&
                now - unfocusedStartMs >= UNFOCUSED_THRESHOLD_MS
            ) {
                alertTriggeredThisBreak = true;
                inAlertState = true;
                triggerLostFocusAlert(now - unfocusedStartMs);
            }
        }
    }

    lastStateChangeMs = now;
    updateLiveStats();
}

function updateLiveStats() {
    const now = Date.now();

    let focused = focusedMsTotal;
    let unfocused = unfocusedMsTotal;

    if (lastStateChangeMs !== null) {
        const delta = now - lastStateChangeMs;
        if (currentState === "focused") {
            focused += delta;
        } else if (currentState === "unfocused") {
            unfocused += delta;
        }
    }

    const total = focused + unfocused;
    const focusPercent =
        total > 0 ? Math.round((focused / total) * 100) : 0;

    liveStats.textContent =
        "Focused: " +
        focusPercent +
        " percent so far, breaks: " +
        breaksCount;
}

function showBanner(message, kind) {
    if (!focusBanner) {
        return;
    }

    if (bannerTimeoutId) {
        clearTimeout(bannerTimeoutId);
        bannerTimeoutId = null;
    }

    focusBanner.textContent = message;
    focusBanner.classList.remove("hidden", "banner-warning", "banner-info", "visible");

    // reset inline styles
    focusBanner.style.backgroundColor = "";
    focusBanner.style.color = "";
    focusBanner.style.border = "";

    if (kind === "warning") {
        focusBanner.classList.add("banner-warning");
        focusBanner.style.backgroundColor = "#fee2e2";
        focusBanner.style.color = "#b91c1c";
        focusBanner.style.border = "1px solid #fecaca";
    } else if (kind === "info") {
        focusBanner.classList.add("banner-info");
        focusBanner.style.backgroundColor = "#dcfce7";
        focusBanner.style.color = "#166534";
        focusBanner.style.border = "1px solid #bbf7d0";
    }

    requestAnimationFrame(() => {
        focusBanner.classList.add("visible");
    });

    bannerTimeoutId = setTimeout(() => {
        hideBanner();
    }, BANNER_DISPLAY_MS);
}

function hideBanner() {
    if (!focusBanner) {
        return;
    }

    focusBanner.classList.remove("visible");
    setTimeout(() => {
        focusBanner.classList.add("hidden");
        focusBanner.textContent = "";
        focusBanner.style.backgroundColor = "";
        focusBanner.style.color = "";
        focusBanner.style.border = "";
    }, 250);
}

function triggerLostFocusAlert(unfocusedDurationMs) {
    const seconds = (unfocusedDurationMs / 1000).toFixed(1);
    const message = "Lost focus for at least " + seconds + " seconds.";

    showBanner(message, "warning");

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

// load defaults once
loadDefaultsFromStorage();