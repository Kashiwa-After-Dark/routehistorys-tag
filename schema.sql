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
