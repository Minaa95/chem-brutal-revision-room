const $ = function (id) { return document.getElementById(id); };
let activeChallengeId = "";
let deviceToken = sessionStorage.getItem("sakms_cloudflare_demo_token") || "";
let busy = false;

async function api(path, options) {
  const settings = options || {};
  const headers = { "content-type": "application/json" };
  if (settings.token) headers.authorization = "Bearer " + settings.token;
  const started = performance.now();
  const response = await fetch(path, {
    method: settings.method || "GET",
    headers: headers,
    body: settings.body ? JSON.stringify(settings.body) : undefined,
    cache: "no-store"
  });
  const roundTrip = Math.round(performance.now() - started);
  $("apiLatency").textContent = roundTrip + " ms";
  let data = {};
  try { data = await response.json(); } catch (error) { data = {}; }
  if (!response.ok || data.ok === false) {
    const err = new Error(data.message || "The request could not be completed.");
    err.status = response.status;
    err.code = data.error || "REQUEST_FAILED";
    err.requestId = data.requestId || response.headers.get("x-request-id") || "";
    throw err;
  }
  return data;
}

function setMessage(element, text, type) {
  element.textContent = text || "";
  element.className = "form-message" + (type ? " " + type : "");
}

function setBusy(button, value, label) {
  button.disabled = value;
  if (label) button.textContent = value ? label : button.dataset.originalLabel;
}

async function refreshHealth() {
  try {
    const data = await api("/api/health");
    $("apiStatus").textContent = "Online";
    $("apiStatus").className = "status-value good";
    $("apiDetail").textContent = data.demoMode ? "Demo-only API responding" : "Unexpected environment";
    $("dbStatus").textContent = data.ok ? "Connected" : "Unavailable";
    $("dbStatus").className = "status-value " + (data.ok ? "good" : "bad");
  } catch (error) {
    $("apiStatus").textContent = "Offline";
    $("apiStatus").className = "status-value bad";
    $("apiDetail").textContent = error.message;
    $("dbStatus").textContent = "Unavailable";
    $("dbStatus").className = "status-value bad";
  }
}

async function refreshMetrics() {
  try {
    const data = await api("/api/demo/metrics");
    const c = data.counts || {};
    $("metricStudents").textContent = c.students || 0;
    $("metricEnrolments").textContent = c.enrolments || 0;
    $("metricAttendance").textContent = c.attendance || 0;
    $("metricOutbox").textContent = c.pendingOutbox || 0;
    $("metricsUpdated").textContent = "Updated " + new Date().toLocaleTimeString();
  } catch (error) {
    $("metricsUpdated").textContent = "Metrics unavailable: " + error.message;
  }
}

async function requestOtp(event) {
  if (event) event.preventDefault();
  if (busy) return;
  const matric = $("matric").value.trim().toUpperCase();
  const email = $("email").value.trim().toLowerCase();
  if (!/^MSDEMO\d{5}$/.test(matric) || !/^[^@\s]+@example\.invalid$/i.test(email)) {
    setMessage($("registerMessage"), "Use a seeded demo matric number and matching example.invalid email.", "error");
    return;
  }

  // Show the OTP panel before waiting for the network response.
  $("otpPanel").hidden = false;
  $("otpStatus").textContent = "The code entry box is ready. Requesting the demo challenge…";
  $("otpCode").value = "";
  $("otpCode").focus();
  const button = $("requestOtpButton");
  button.dataset.originalLabel = "Send demo verification code";
  setBusy(button, true, "Requesting…");
  setMessage($("registerMessage"), "Request submitted. The OTP field is already available below.", "");

  try {
    const data = await api("/api/auth/request-otp", {
      method: "POST",
      body: { matric: matric, email: email }
    });
    activeChallengeId = data.challengeId;
    $("otpStatus").textContent = "Demo challenge ready. Use code " + data.demoCode + ". No email was sent.";
    $("otpCode").value = data.demoCode;
    setMessage($("registerMessage"), "Demo OTP challenge created. Continue with verification.", "success");
  } catch (error) {
    $("otpStatus").textContent = "The OTP field remains available. " + error.message;
    setMessage($("registerMessage"), error.message + (error.requestId ? " Request ID: " + error.requestId : ""), "error");
  } finally {
    setBusy(button, false);
  }
}

async function verifyOtp() {
  if (busy) return;
  const matric = $("matric").value.trim().toUpperCase();
  const code = $("otpCode").value.trim();
  if (!activeChallengeId) {
    setMessage($("registerMessage"), "Request a fresh demo code first.", "error");
    return;
  }
  const button = $("verifyOtpButton");
  button.dataset.originalLabel = "Verify and continue";
  setBusy(button, true, "Verifying…");
  try {
    const data = await api("/api/auth/verify-otp", {
      method: "POST",
      body: { matric: matric, challengeId: activeChallengeId, code: code }
    });
    deviceToken = data.token;
    sessionStorage.setItem("sakms_cloudflare_demo_token", deviceToken);
    activeChallengeId = "";
    await loadStudent();
    setMessage($("registerMessage"), "Demo device verified.", "success");
  } catch (error) {
    setMessage($("registerMessage"), error.message + (error.requestId ? " Request ID: " + error.requestId : ""), "error");
  } finally {
    setBusy(button, false);
  }
}

async function loadStudent() {
  const data = await api("/api/me", { token: deviceToken });
  $("studentName").textContent = data.student.name;
  $("studentMeta").textContent = data.student.matric;
  $("studentClasses").replaceChildren();
  (data.student.classes || []).forEach(function (classCode) {
    const chip = document.createElement("span");
    chip.className = "class-chip";
    chip.textContent = classCode;
    $("studentClasses").appendChild(chip);
  });
  $("registerCard").hidden = true;
  $("studentPanel").hidden = false;
  $("receiptPanel").hidden = true;
  await loadSessions();
}

async function loadSessions() {
  const container = $("sessionsList");
  container.replaceChildren();
  try {
    const data = await api("/api/sessions", { token: deviceToken });
    if (!data.sessions.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "No open demo sessions are assigned to this student.";
      container.appendChild(empty);
      return;
    }
    data.sessions.forEach(function (session) {
      const card = document.createElement("article");
      card.className = "session-card";
      const title = document.createElement("h4");
      title.textContent = session.label;
      const meta = document.createElement("p");
      meta.className = "session-meta";
      meta.textContent = session.class_code + " · " + session.session_type;
      const button = document.createElement("button");
      button.className = "button primary";
      button.type = "button";
      button.textContent = "Check in (synthetic location)";
      button.addEventListener("click", function () { checkIn(session.id, button); });
      card.append(title, meta, button);
      container.appendChild(card);
    });
  } catch (error) {
    const item = document.createElement("p");
    item.className = "form-message error";
    item.textContent = error.message;
    container.appendChild(item);
  }
}

async function checkIn(sessionId, button) {
  if (busy) return;
  button.disabled = true;
  const oldLabel = button.textContent;
  button.textContent = "Recording…";
  try {
    const data = await api("/api/attendance/check-in", {
      method: "POST",
      token: deviceToken,
      body: {
        sessionId: sessionId,
        lat: 0,
        lng: 0,
        accuracy: 10
      }
    });
    $("receiptTitle").textContent = data.status === "RECORDED" ? "Attendance recorded" : "Already recorded";
    $("receiptMessage").textContent = data.message;
    $("receiptSync").textContent = data.bkp.message;
    $("receiptDetails").replaceChildren();
    const details = [
      ["Status", data.attendance.status],
      ["Session", data.attendance.session_id],
      ["Matric", data.attendance.matric],
      ["Recorded at", new Date(data.attendance.checked_in_at).toLocaleString()],
      ["GPS accuracy", data.attendance.accuracy_m + " m"],
      ["Distance", data.attendance.distance_m + " m"]
    ];
    details.forEach(function (pair) {
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = pair[0];
      dd.textContent = pair[1];
      $("receiptDetails").append(dt, dd);
    });
    $("receiptPanel").hidden = false;
    $("studentPanel").hidden = true;
    await refreshMetrics();
  } catch (error) {
    alert(error.message + (error.requestId ? "\nRequest ID: " + error.requestId : ""));
  } finally {
    button.disabled = false;
    button.textContent = oldLabel;
  }
}

function signOut() {
  sessionStorage.removeItem("sakms_cloudflare_demo_token");
  deviceToken = "";
  activeChallengeId = "";
  $("studentPanel").hidden = true;
  $("receiptPanel").hidden = true;
  $("registerCard").hidden = false;
  $("otpPanel").hidden = true;
  $("otpCode").value = "";
}

async function initialise() {
  await Promise.all([refreshHealth(), refreshMetrics()]);
  if (deviceToken) {
    try {
      await loadStudent();
    } catch (error) {
      signOut();
    }
  }
}

$("requestOtpForm").addEventListener("submit", requestOtp);
$("verifyOtpButton").addEventListener("click", verifyOtp);
$("signOutButton").addEventListener("click", signOut);
$("refreshSessionsButton").addEventListener("click", loadSessions);
$("refreshMetricsButton").addEventListener("click", refreshMetrics);
$("backToSessionsButton").addEventListener("click", function () {
  $("receiptPanel").hidden = true;
  $("studentPanel").hidden = false;
  loadSessions();
});
initialise();
