-- Synthetic records only. Every email uses the reserved example.invalid domain.
-- Every location is the synthetic coordinate 0,0, not the KMS campus.

WITH RECURSIVE seq(n) AS (
  SELECT 1
  UNION ALL
  SELECT n + 1 FROM seq WHERE n < 300
)
INSERT OR IGNORE INTO students (matric, full_name, email, status, created_at)
SELECT
  'MSDEMO' || printf('%05d', n),
  'Demo Student ' || printf('%03d', n),
  'student' || printf('%03d', n) || '@example.invalid',
  'ACTIVE',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM seq;

INSERT OR IGNORE INTO enrolments (matric, class_code, status, created_at)
SELECT s.matric, c.class_code, 'ACTIVE', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM students s
CROSS JOIN (
  SELECT 'S1K3T2' AS class_code
  UNION ALL SELECT 'S2K2T4'
  UNION ALL SELECT 'S3K2T3'
) c
WHERE s.matric LIKE 'MSDEMO%';

INSERT OR IGNORE INTO sessions (
  id, class_code, session_type, label, starts_at, ends_at, status,
  geofence_lat, geofence_lng, radius_m, max_accuracy_m, created_at
)
VALUES
(
  'DEMO-LECTURE-01', 'S1K3T2', 'LECTURE', 'Demo lecture session',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+7 days'),
  'OPEN', 0.0, 0.0, 500, 100, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
),
(
  'DEMO-TUTORIAL-01', 'S2K2T4', 'TUTORIAL', 'Demo tutorial session',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+7 days'),
  'OPEN', 0.0, 0.0, 500, 100, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
),
(
  'DEMO-PRACTICAL-01', 'S3K2T3', 'PRACTICAL', 'Demo practical session',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+7 days'),
  'OPEN', 0.0, 0.0, 500, 100, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);
