const BASE_URL = (process.env.BASE_URL || "").replace(/\/+$/, "");
const COUNT = Math.max(1, Math.min(300, Number(process.env.COUNT || 50)));
const CONCURRENCY = Math.max(1, Math.min(COUNT, Number(process.env.CONCURRENCY || 50)));
const SESSION_ID = process.env.SESSION_ID || "DEMO-LECTURE-01";

if (!BASE_URL) {
  console.error("Set BASE_URL to the isolated Cloudflare Pages preview URL.");
  process.exit(1);
}

const measurements = [];
const failures = [];
let nextIndex = 1;

async function timedRequest(path, options, label) {
  const started = performance.now();
  const response = await fetch(BASE_URL + path, options);
  const elapsed = Math.round(performance.now() - started);
  measurements.push({ label: label, ms: elapsed, status: response.status });
  const data = await response.json().catch(function () { return {}; });
  if (!response.ok || data.ok === false) {
    throw new Error(label + " failed with HTTP " + response.status + ": " + (data.message || "unknown error"));
  }
  return data;
}

async function testStudent(index) {
  const matric = "MSDEMO" + String(index).padStart(5, "0");
  const email = "student" + String(index).padStart(3, "0") + "@example.invalid";

  const challenge = await timedRequest("/api/auth/request-otp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ matric: matric, email: email })
  }, "request-otp");

  const verified = await timedRequest("/api/auth/verify-otp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      matric: matric,
      challengeId: challenge.challengeId,
      code: challenge.demoCode
    })
  }, "verify-otp");

  const me = await timedRequest("/api/me", {
    headers: { authorization: "Bearer " + verified.token }
  }, "student-profile");

  const sessions = await timedRequest("/api/sessions", {
    headers: { authorization: "Bearer " + verified.token }
  }, "list-sessions");

  if (!sessions.sessions.some(function (s) { return s.id === SESSION_ID; })) {
    throw new Error("The selected demo session is not assigned to " + matric + ".");
  }

  const checkInOptions = {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + verified.token
    },
    body: JSON.stringify({
      sessionId: SESSION_ID,
      lat: 0,
      lng: 0,
      accuracy: 10
    })
  };
  const attendance = await timedRequest("/api/attendance/check-in", checkInOptions, "check-in");
  const duplicate = await timedRequest("/api/attendance/check-in", checkInOptions, "duplicate-check-in");
  if (duplicate.status !== "ALREADY_RECORDED") {
    throw new Error("Duplicate check-in was not idempotent for " + matric + ".");
  }

  return {
    matric: me.student.matric,
    status: attendance.status,
    duplicateStatus: duplicate.status
  };
}

async function worker() {
  while (true) {
    const index = nextIndex++;
    if (index > COUNT) return;
    try {
      await testStudent(index);
    } catch (error) {
      failures.push({ student: index, message: error.message });
    }
  }
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = values.slice().sort(function (a, b) { return a - b; });
  const position = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, position)];
}

(async function main() {
  const started = performance.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const totalMs = Math.round(performance.now() - started);
  const byLabel = {};

  measurements.forEach(function (item) {
    if (!byLabel[item.label]) byLabel[item.label] = [];
    byLabel[item.label].push(item.ms);
  });

  const latency = {};
  Object.keys(byLabel).forEach(function (label) {
    const values = byLabel[label];
    latency[label] = {
      requests: values.length,
      p50_ms: percentile(values, 0.50),
      p95_ms: percentile(values, 0.95),
      max_ms: Math.max.apply(null, values)
    };
  });

  const report = {
    baseUrl: BASE_URL,
    sessionId: SESSION_ID,
    requestedStudents: COUNT,
    concurrency: CONCURRENCY,
    successfulStudents: COUNT - failures.length,
    failedStudents: failures.length,
    totalRequests: measurements.length,
    totalElapsedMs: totalMs,
    latency: latency,
    failures: failures.slice(0, 30)
  };

  console.log(JSON.stringify(report, null, 2));
  if (failures.length) process.exitCode = 1;
})();
