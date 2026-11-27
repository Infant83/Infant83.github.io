CREATE TABLE profile_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  started_at TEXT NOT NULL
);
INSERT INTO profile_meta(id, started_at) VALUES(1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

CREATE TABLE profile_daily (
  day TEXT PRIMARY KEY,
  pageviews INTEGER NOT NULL DEFAULT 0 CHECK(pageviews >= 0),
  cv_downloads INTEGER NOT NULL DEFAULT 0 CHECK(cv_downloads >= 0)
);

CREATE TABLE profile_visitor_days (
  day TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 0 CHECK(event_count >= 0),
  PRIMARY KEY(day, visitor_hash)
);

CREATE TABLE profile_events (
  event_hash TEXT PRIMARY KEY,
  visitor_hash TEXT NOT NULL,
  day TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('pageview', 'cv_download')),
  processed INTEGER NOT NULL DEFAULT 0 CHECK(processed IN (0, 1)),
  created_at INTEGER NOT NULL
);
CREATE INDEX profile_events_expiry ON profile_events(created_at);
