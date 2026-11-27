PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS students (
  matric TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS enrolments (
  matric TEXT NOT NULL,
  class_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (matric, class_code),
  FOREIGN KEY (matric) REFERENCES students(matric)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  class_code TEXT NOT NULL,
  session_type TEXT NOT NULL CHECK (session_type IN ('LECTURE', 'TUTORIAL', 'PRACTICAL')),
  label TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED', 'CANCELLED')),
  geofence_lat REAL NOT NULL,
  geofence_lng REAL NOT NULL,
  radius_m REAL NOT NULL DEFAULT 300,
  max_accuracy_m REAL NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS otp_challenges (
  id TEXT PRIMARY KEY,
  matric TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  code_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'VERIFIED', 'CONSUMED', 'EXPIRED', 'LOCKED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  ip_hash TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  verified_at TEXT,
  FOREIGN KEY (matric) REFERENCES students(matric)
);

CREATE TABLE IF NOT EXISTS devices (
  token_hash TEXT PRIMARY KEY,
  matric TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (matric) REFERENCES students(matric)
);

CREATE TABLE IF NOT EXISTS attendance (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  matric TEXT NOT NULL,
  device_token_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PRESENT' CHECK (status IN ('PRESENT')),
  checked_in_at TEXT NOT NULL,
  accuracy_m REAL NOT NULL,
  distance_m REAL NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (sync_status IN ('PENDING', 'SYNCED', 'REVIEW')),
  UNIQUE (session_id, matric),
  FOREIGN KEY (session_id) REFERENCES sessions(id),
  FOREIGN KEY (matric) REFERENCES students(matric),
  FOREIGN KEY (device_token_hash) REFERENCES devices(token_hash)
);

CREATE TABLE IF NOT EXISTS sync_outbox (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PROCESSING', 'SYNCED', 'RETRY', 'REVIEW')),
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  next_attempt_at TEXT NOT NULL,
  completed_at TEXT,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_students_email ON students(email);
CREATE INDEX IF NOT EXISTS idx_enrolments_class_status ON enrolments(class_code, status);
CREATE INDEX IF NOT EXISTS idx_sessions_class_window ON sessions(class_code, status, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_otp_matric_created ON otp_challenges(matric, created_at);
CREATE INDEX IF NOT EXISTS idx_otp_status_expiry ON otp_challenges(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_devices_matric ON devices(matric, revoked_at);
CREATE INDEX IF NOT EXISTS idx_attendance_matric_time ON attendance(matric, checked_in_at);
CREATE INDEX IF NOT EXISTS idx_outbox_status_next ON sync_outbox(status, next_attempt_at);
