-- 観測記録テーブル（Cloudflare D1 / SQLite）
CREATE TABLE IF NOT EXISTS records (
  id           TEXT PRIMARY KEY,          -- 端末側で生成（オフライン再送しても二重登録されない）
  uid          TEXT NOT NULL,             -- 記録した端末のID（削除の本人確認用）
  user         TEXT NOT NULL,             -- 名前（GPXファイル名と合わせる）
  age          TEXT NOT NULL,
  grp          TEXT NOT NULL,             -- グループ（group は予約語のため grp）
  gender       TEXT NOT NULL,
  count_min    INTEGER NOT NULL,
  count_max    INTEGER NOT NULL,
  note         TEXT NOT NULL DEFAULT '',
  client_time  INTEGER NOT NULL,          -- 「記録する」を押した瞬間（UNIXミリ秒）
  client_iso   TEXT,                      -- 同じ時刻の現地表記
  tz_offset    INTEGER,
  lat REAL, lng REAL, acc REAL,           -- 端末の位置情報（任意）
  gpx_lat REAL, gpx_lng REAL, gpx_diff_sec REAL, gpx_interp INTEGER, gpx_file TEXT,
  server_time  INTEGER NOT NULL,          -- サーバーが受け取った時刻
  updated_at   INTEGER NOT NULL,          -- 差分取得用
  deleted      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_records_client_time ON records (client_time);
CREATE INDEX IF NOT EXISTS idx_records_updated_at  ON records (updated_at);

-- 軌跡（アプリの「開始」「終了」ボタンで記録）。サーバーが最初に使うときにも自動で作られます
CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY, uid TEXT NOT NULL, user TEXT NOT NULL,
  started_at INTEGER NOT NULL, ended_at INTEGER, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0
);
-- 地点はまとめて（チャンクごとに）JSONで保存： [[時刻ms, 緯度, 経度, 誤差m], ...]
CREATE TABLE IF NOT EXISTS track_chunks (
  track_id TEXT NOT NULL, seq INTEGER NOT NULL, t0 INTEGER, t1 INTEGER, n INTEGER, points TEXT NOT NULL,
  PRIMARY KEY (track_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_tracks_started ON tracks (started_at);
