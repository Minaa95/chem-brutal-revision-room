const DEMO_OTP = "246810";
const DEMO_MATRIC = /^MSDEMO\d{5}$/;
const DEMO_EMAIL = /^[^@\s]+@example\.invalid$/i;

function response(data, status, requestId, started) {
  const elapsed = Math.max(0, Math.round(performance.now() - started));
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, max-age=0",
      "pragma": "no-cache",
      "x-content-type-options": "nosniff",
      "x-request-id": requestId,
      "server-timing": "app;dur=" + elapsed
    }
  });
}

function fail(message, status, requestId, started, code) {
  return response({ ok: false, error: code || "REQUEST_FAILED", message: message, requestId: requestId }, status, requestId, started);
}

async function readJson(request) {
  const raw = await request.text();
  if (raw.length > 8192) throw new Error("Request body is too large.");
  if (!raw) return {};
  return JSON.parse(raw);
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map(function (b) {
    return b.toString(16).padStart(2, "0");
  }).join("");
}

function randomHex(byteCount) {
  const bytes = new Uint8Array(byteCount || 32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(function (b) {
    return b.toString(16).padStart(2, "0");
  }).join("");
}

function pepper(env) {
  return env.TOKEN_PEPPER || "DEMO_ONLY_REPLACE_BEFORE_PRODUCTION";
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const rad = function (n) { return n * Math.PI / 180; };
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function deviceFromRequest(request, env) {
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) return null;
  const rawToken = header.slice(7).trim();
  if (rawToken.length < 32 || rawToken.length > 256) return null;
  const tokenHash = await sha256(rawToken + ":" + pepper(env));
  return await env.DB.prepare(
    "SELECT d.token_hash, d.matric, s.full_name " +
    "FROM devices d JOIN students s ON s.matric = d.matric " +
    "WHERE d.token_hash = ? AND d.revoked_at IS NULL AND s.status = 'ACTIVE'"
  ).bind(tokenHash).first();
}

async function requestOtp(request, env, requestId, started) {
  const body = await readJson(request);
  const matric = String(body.matric || "").trim().toUpperCase();
  const email = String(body.email || "").trim().toLowerCase();

  if (!DEMO_MATRIC.test(matric) || !DEMO_EMAIL.test(email)) {
    return fail("Use a seeded demo matric number and its example.invalid email address.", 400, requestId, started, "INVALID_DEMO_IDENTITY");
  }

  const student = await env.DB.prepare(
    "SELECT matric, email FROM students WHERE matric = ? AND email = ? COLLATE NOCASE AND status = 'ACTIVE'"
  ).bind(matric, email).first();

  if (!student) {
    return fail("The demo matric number and email do not match our synthetic student list.", 404, requestId, started, "DEMO_STUDENT_NOT_FOUND");
  }

  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const challengeId = crypto.randomUUID();
  const codeHash = await sha256(challengeId + ":" + DEMO_OTP + ":" + pepper(env));
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();

  // Enforce the per-student rate limit inside the INSERT itself. This avoids
  // a check-then-insert race when several OTP requests arrive together.
  const inserted = await env.DB.prepare(
    "INSERT INTO otp_challenges (id, matric, email, code_hash, status, attempts, created_at, expires_at) " +
    "SELECT ?, ?, ?, ?, 'PENDING', 0, ?, ? " +
    "WHERE (SELECT COUNT(*) FROM otp_challenges WHERE matric = ? AND created_at >= ?) < 3"
  ).bind(challengeId, matric, email, codeHash, createdAt, expiresAt, matric, cutoff).run();

  if (Number(inserted && inserted.meta && inserted.meta.changes || 0) !== 1) {
    return fail("Too many demo OTP requests for this student. Wait 15 minutes before trying again.", 429, requestId, started, "OTP_RATE_LIMITED");
  }

  return response({
    ok: true,
    challengeId: challengeId,
    expiresAt: expiresAt,
    deliveryMode: "DEMO_SIMULATED",
    demoCode: DEMO_OTP,
    message: "Demo challenge created. No email was sent."
  }, 200, requestId, started);
}

async function verifyOtp(request, env, requestId, started) {
  const body = await readJson(request);
  const matric = String(body.matric || "").trim().toUpperCase();
  const challengeId = String(body.challengeId || "").trim();
  const code = String(body.code || "").trim().toUpperCase();

  if (!DEMO_MATRIC.test(matric) || !/^[0-9a-f-]{36}$/i.test(challengeId) || !/^\d{6}$/.test(code)) {
    return fail("Enter the demo matric number, challenge and six-digit code.", 400, requestId, started, "INVALID_OTP_INPUT");
  }

  const challenge = await env.DB.prepare(
    "SELECT id, matric, code_hash, status, attempts, expires_at FROM otp_challenges WHERE id = ? AND matric = ?"
  ).bind(challengeId, matric).first();

  if (!challenge) return fail("This demo OTP request was not found. Request a new code.", 404, requestId, started, "OTP_NOT_FOUND");
  if (challenge.status !== "PENDING") return fail("This OTP request is no longer active. Request a new code.", 409, requestId, started, "OTP_NOT_ACTIVE");

  const nowMs = Date.now();
  if (Date.parse(challenge.expires_at) <= nowMs) {
    await env.DB.prepare("UPDATE otp_challenges SET status = 'EXPIRED' WHERE id = ? AND status = 'PENDING'")
      .bind(challengeId).run();
    return fail("This OTP has expired. Request a new code.", 410, requestId, started, "OTP_EXPIRED");
  }

  if (Number(challenge.attempts || 0) >= 5) {
    return fail("This OTP request is locked. Request a new code.", 423, requestId, started, "OTP_LOCKED");
  }

  const suppliedHash = await sha256(challengeId + ":" + code + ":" + pepper(env));
  if (suppliedHash !== challenge.code_hash) {
    await env.DB.prepare(
      "UPDATE otp_challenges SET attempts = attempts + 1, " +
      "status = CASE WHEN attempts + 1 >= 5 THEN 'LOCKED' ELSE 'PENDING' END " +
      "WHERE id = ? AND status = 'PENDING' AND attempts < 5"
    ).bind(challengeId).run();
    return fail("Incorrect demo code. Check the six digits and try again.", 400, requestId, started, "OTP_INCORRECT");
  }

  const rawToken = randomHex(32);
  const tokenHash = await sha256(rawToken + ":" + pepper(env));
  const verifiedAt = new Date().toISOString();

  // D1 batch() executes sequentially as one transaction. The conditional
  // state changes ensure that a challenge can issue only one device token.
  const results = await env.DB.batch([
    env.DB.prepare(
      "UPDATE otp_challenges SET status = 'VERIFIED', verified_at = ? " +
      "WHERE id = ? AND matric = ? AND status = 'PENDING' AND expires_at > ? AND attempts < 5 AND code_hash = ?"
    ).bind(verifiedAt, challengeId, matric, verifiedAt, suppliedHash),
    env.DB.prepare(
      "INSERT INTO devices (token_hash, matric, created_at, last_seen_at) " +
      "SELECT ?, matric, ?, ? FROM otp_challenges " +
      "WHERE id = ? AND matric = ? AND status = 'VERIFIED' AND verified_at = ? " +
      "ON CONFLICT(token_hash) DO NOTHING"
    ).bind(tokenHash, verifiedAt, verifiedAt, challengeId, matric, verifiedAt),
    env.DB.prepare(
      "UPDATE otp_challenges SET status = 'CONSUMED' " +
      "WHERE id = ? AND matric = ? AND status = 'VERIFIED' AND verified_at = ?"
    ).bind(challengeId, matric, verifiedAt)
  ]);

  const deviceCreated = Number(results[1] && results[1].meta && results[1].meta.changes || 0);
  if (deviceCreated !== 1) {
    return fail("This OTP was already used or is no longer valid. Request a new code.", 409, requestId, started, "OTP_ALREADY_USED");
  }

  return response({
    ok: true,
    token: rawToken,
    matric: matric,
    message: "Demo device registered."
  }, 200, requestId, started);
}

async function getMe(request, env, requestId, started) {
  const device = await deviceFromRequest(request, env);
  if (!device) return fail("Register this demo device again to continue.", 401, requestId, started, "DEVICE_NOT_REGISTERED");

  const classes = await env.DB.prepare(
    "SELECT class_code FROM enrolments WHERE matric = ? AND status = 'ACTIVE' ORDER BY class_code"
  ).bind(device.matric).all();

  return response({
    ok: true,
    student: {
      matric: device.matric,
      name: device.full_name,
      classes: (classes.results || []).map(function (row) { return row.class_code; })
    }
  }, 200, requestId, started);
}

async function getSessions(request, env, requestId, started) {
  const device = await deviceFromRequest(request, env);
  if (!device) return fail("Register this demo device again to continue.", 401, requestId, started, "DEVICE_NOT_REGISTERED");

  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    "SELECT DISTINCT s.id, s.class_code, s.session_type, s.label, s.starts_at, s.ends_at " +
    "FROM sessions s JOIN enrolments e ON e.class_code = s.class_code " +
    "WHERE e.matric = ? AND e.status = 'ACTIVE' AND s.status = 'OPEN' " +
    "AND s.starts_at <= ? AND s.ends_at >= ? ORDER BY s.session_type, s.class_code"
  ).bind(device.matric, now, now).all();

  return response({ ok: true, sessions: result.results || [] }, 200, requestId, started);
}

async function checkIn(request, env, requestId, started) {
  const device = await deviceFromRequest(request, env);
  if (!device) return fail("Register this demo device again to continue.", 401, requestId, started, "DEVICE_NOT_REGISTERED");

  const body = await readJson(request);
  const sessionId = String(body.sessionId || "").trim();
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  const accuracy = Number(body.accuracy);

  if (!sessionId || !Number.isFinite(lat) || !Number.isFinite(lng) ||
      !Number.isFinite(accuracy) || lat < -90 || lat > 90 || lng < -180 || lng > 180 ||
      accuracy < 0 || accuracy > 1000) {
    return fail("The demo location details are invalid.", 400, requestId, started, "INVALID_LOCATION");
  }

  const session = await env.DB.prepare(
    "SELECT id, class_code, session_type, label, starts_at, ends_at, status, " +
    "geofence_lat, geofence_lng, radius_m, max_accuracy_m FROM sessions WHERE id = ?"
  ).bind(sessionId).first();

  if (!session || session.status !== "OPEN") {
    return fail("This demo session is not open.", 404, requestId, started, "SESSION_NOT_OPEN");
  }

  const now = new Date().toISOString();
  if (Date.parse(session.starts_at) > Date.now() || Date.parse(session.ends_at) < Date.now()) {
    return fail("This demo session is outside its attendance window.", 409, requestId, started, "SESSION_OUTSIDE_WINDOW");
  }

  const distance = haversineMeters(lat, lng, Number(session.geofence_lat), Number(session.geofence_lng));
  if (accuracy > Number(session.max_accuracy_m)) {
    return fail("The demo location accuracy is too low. Try again with a more accurate location.", 422, requestId, started, "LOCATION_ACCURACY_LOW");
  }
  if (distance > Number(session.radius_m)) {
    return fail("The demo location is outside the synthetic geofence.", 403, requestId, started, "OUTSIDE_GEOFENCE");
  }

  const attendanceId = crypto.randomUUID();
  const outboxId = crypto.randomUUID();

  // Attendance and the BKP outbox event are committed in one D1 batch.
  // The unique(session_id, matric) constraint makes repeat taps idempotent.
  const results = await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO attendance (id, session_id, matric, device_token_hash, status, checked_in_at, accuracy_m, distance_m, sync_status) " +
      "SELECT ?, s.id, ?, ?, 'PRESENT', ?, ?, ?, 'PENDING' " +
      "FROM sessions s JOIN enrolments e ON e.class_code = s.class_code " +
      "WHERE s.id = ? AND s.status = 'OPEN' AND s.starts_at <= ? AND s.ends_at >= ? " +
      "AND e.matric = ? AND e.status = 'ACTIVE' AND ? <= s.max_accuracy_m AND ? <= s.radius_m " +
      "ON CONFLICT(session_id, matric) DO NOTHING"
    ).bind(attendanceId, device.matric, device.token_hash, now, accuracy, distance,
      sessionId, now, now, device.matric, accuracy, distance),
    env.DB.prepare(
      "SELECT id, session_id, matric, status, checked_in_at, accuracy_m, distance_m, sync_status " +
      "FROM attendance WHERE session_id = ? AND matric = ?"
    ).bind(sessionId, device.matric),
    env.DB.prepare(
      "INSERT OR IGNORE INTO sync_outbox " +
      "(id, dedupe_key, event_type, payload_json, status, attempts, created_at, next_attempt_at) " +
      "SELECT ?, 'attendance:' || a.id, 'BKP_MARK_PRESENT', " +
      "json_object('attendanceId', a.id, 'matric', a.matric, 'sessionId', a.session_id, " +
      "'classCode', s.class_code, 'checkedInAt', a.checked_in_at), " +
      "'PENDING', 0, ?, ? FROM attendance a JOIN sessions s ON s.id = a.session_id " +
      "WHERE a.session_id = ? AND a.matric = ?"
    ).bind(outboxId, now, now, sessionId, device.matric)
  ]);

  const attendance = results[1] && results[1].results && results[1].results[0];
  if (!attendance) {
    return fail("No attendance was recorded. Check that you are enrolled in this session.", 409, requestId, started, "ATTENDANCE_NOT_ELIGIBLE");
  }

  const inserted = Number(results[0] && results[0].meta && results[0].meta.changes || 0) === 1;
  return response({
    ok: true,
    status: inserted ? "RECORDED" : "ALREADY_RECORDED",
    attendance: attendance,
    bkp: {
      status: "PENDING",
      message: "Attendance is saved. The separate BKP sync job is pending in this prototype."
    },
    message: inserted ? "Attendance recorded successfully." : "Attendance was already recorded for this session."
  }, inserted ? 201 : 200, requestId, started);
}

async function metrics(env, requestId, started) {
  const result = await env.DB.prepare(
    "SELECT 'students' AS metric, COUNT(*) AS total FROM students " +
    "UNION ALL SELECT 'enrolments', COUNT(*) FROM enrolments " +
    "UNION ALL SELECT 'sessions', COUNT(*) FROM sessions " +
    "UNION ALL SELECT 'attendance', COUNT(*) FROM attendance " +
    "UNION ALL SELECT 'sync_outbox', COUNT(*) FROM sync_outbox " +
    "UNION ALL SELECT 'otp_challenges', COUNT(*) FROM otp_challenges " +
    "UNION ALL SELECT 'pendingOutbox', COUNT(*) FROM sync_outbox WHERE status IN ('PENDING', 'RETRY', 'PROCESSING')"
  ).all();
  const counts = {};
  (result.results || []).forEach(function (row) { counts[row.metric] = Number(row.total || 0); });
  return response({ ok: true, demoOnly: true, counts: counts }, 200, requestId, started);
}

export async function onRequest(context) {
  const request = context.request;
  const env = context.env;
  const started = performance.now();
  const requestId = crypto.randomUUID();
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const path = url.pathname;

  try {
    if (!env.DB) return fail("D1 binding DB is not configured.", 503, requestId, started, "DATABASE_NOT_CONFIGURED");

    if (method === "GET" && path === "/api/health") {
      const row = await env.DB.prepare("SELECT 1 AS ok").first();
      return response({
        ok: Number(row && row.ok) === 1,
        app: "SMART ATTENDANCE KMS Cloudflare POC",
        environment: env.APP_ENV || "unknown",
        demoMode: env.DEMO_MODE === "true",
        emailDelivery: "disabled",
        realStudentData: false
      }, 200, requestId, started);
    }

    if (env.DEMO_MODE !== "true" || env.APP_ENV !== "demo") {
      return fail("This build is a dummy-data prototype and is disabled outside demo mode.", 503, requestId, started, "DEMO_MODE_REQUIRED");
    }

    if (method === "GET" && path === "/api/demo/metrics") {
      return await metrics(env, requestId, started);
    }
    if (method === "POST" && path === "/api/auth/request-otp") {
      return await requestOtp(request, env, requestId, started);
    }
    if (method === "POST" && path === "/api/auth/verify-otp") {
      return await verifyOtp(request, env, requestId, started);
    }
    if (method === "GET" && path === "/api/me") {
      return await getMe(request, env, requestId, started);
    }
    if (method === "GET" && path === "/api/sessions") {
      return await getSessions(request, env, requestId, started);
    }
    if (method === "POST" && path === "/api/attendance/check-in") {
      return await checkIn(request, env, requestId, started);
    }

    return fail("API endpoint not found.", 404, requestId, started, "NOT_FOUND");
  } catch (error) {
    if (error && error.name === "SyntaxError") {
      return fail("The request body is not valid JSON.", 400, requestId, started, "INVALID_JSON");
    }
    if (error && error.message === "Request body is too large.") {
      return fail("The request body exceeds the prototype limit.", 413, requestId, started, "BODY_TOO_LARGE");
    }
    console.error("Sakms POC request failed", requestId, error && error.name ? error.name : "Error");
    return fail("The prototype could not complete this request. Check the request ID in the developer logs.", 500, requestId, started, "INTERNAL_ERROR");
  }
}
