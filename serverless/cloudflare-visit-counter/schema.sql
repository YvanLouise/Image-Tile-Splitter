CREATE TABLE IF NOT EXISTS unique_visits (
  ip_hash TEXT PRIMARY KEY,
  first_seen TEXT NOT NULL
);
