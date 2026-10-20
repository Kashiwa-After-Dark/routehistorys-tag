// ゼミ観測ログ API（Cloudflare Workers + D1）
// 画面ファイルは assets から配信され、/api/* だけここに来る

// タグの候補（index.html の TAGS と合わせる）
const AGES = ["15-18", "19-22", "23-34", "35-64", "65+"];
const GROUPS = ["CP", "FM", "GG", "BG", "XG", "MX", "G", "B"];   // カップル/家族/女の子G/男の子G/男女混合/年齢差/女の子1人/男の子1人
const COUNT_MIN = 1, COUNT_MAX = 30;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const bad = (msg, status = 400) => json({ error: msg }, status);

// D1の行 → アプリで使う形
const toRecord = r => ({
  id: r.id, uid: r.uid, user: r.user, age: r.age, group: r.grp, gender: r.gender,
  countMin: r.count_min, countMax: r.count_max, note: r.note,
  clientTime: r.client_time, clientISO: r.client_iso, tzOffsetMin: r.tz_offset,
  lat: r.lat, lng: r.lng, acc: r.acc,
  gpxLat: r.gpx_lat, gpxLng: r.gpx_lng, gpxDiffSec: r.gpx_diff_sec, gpxInterp: r.gpx_interp == null ? null : !!r.gpx_interp, gpxFile: r.gpx_file,
  serverTime: r.server_time, updatedAt: r.updated_at, deleted: !!r.deleted,
});

// 性別は入力せず、グループから自動で決める（女の子→F、男の子→M、それ以外は空欄）
const genderOf = g => (g === "GG" || g === "G") ? "F" : (g === "BG" || g === "B") ? "M" : "";

const isStr = (v, max) => typeof v === "string" && v.length <= max;
const isInt = v => Number.isInteger(v);
const numOrNull = v => (typeof v === "number" && Number.isFinite(v) ? v : null);

// ---- 軌跡（アプリの「開始」「終了」ボタンで記録） ----
// 表が無ければ最初のリクエストで自動で作る（schema.sql を流し直さなくてよい）
let tracksReady = null;
const ensureTracks = env => tracksReady ??= env.DB.batch([
  env.DB.prepare(`CREATE TABLE IF NOT EXISTS tracks (id TEXT PRIMARY KEY, uid TEXT NOT NULL, user TEXT NOT NULL,
    started_at INTEGER NOT NULL, ended_at INTEGER, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0)`),
  env.DB.prepare(`CREATE TABLE IF NOT EXISTS track_chunks (track_id TEXT NOT NULL, seq INTEGER NOT NULL, t0 INTEGER, t1 INTEGER,
    n INTEGER, points TEXT NOT NULL, PRIMARY KEY (track_id, seq))`),
  env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_tracks_started ON tracks (started_at)"),
]).catch(e => { tracksReady = null; throw e; });

async function listTracks(env, from, to, user){
  await ensureTracks(env);
  const q = await env.DB.prepare(
    `SELECT * FROM tracks WHERE deleted = 0 AND started_at <= ?2 AND COALESCE(ended_at, updated_at) >= ?1 ${user ? "AND user = ?3" : ""} ORDER BY started_at LIMIT 300`
  ).bind(from, to, ...(user ? [user] : [])).all();
  const tracks = q.results;
  if (!tracks.length) return [];
  const ids = tracks.map(x => x.id);
  const chunks = [];
  for (let k = 0; k < ids.length; k += 50) {
    const part = ids.slice(k, k + 50);
    const r = await env.DB.prepare(`SELECT track_id, seq, points FROM track_chunks WHERE track_id IN (${part.map((_, i) => "?" + (i + 1)).join(",")}) ORDER BY track_id, seq`).bind(...part).all();
    chunks.push(...r.results);
  }
  const byId = Object.fromEntries(tracks.map(x => [x.id, { id: x.id, uid: x.uid, user: x.user, startedAt: x.started_at, endedAt: x.ended_at, updatedAt: x.updated_at, points: [] }]));
  for (const c of chunks) { try { byId[c.track_id]?.points.push(...JSON.parse(c.points)); } catch {} }
  for (const x of Object.values(byId)) x.points.sort((a, b) => a[0] - b[0]);
  return Object.values(byId);
}
const validPoint = p => Array.isArray(p) && p.length >= 3 && isInt(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2])
  && Math.abs(p[1]) <= 90 && Math.abs(p[2]) <= 180;

function validate(b) {
  if (!isStr(b.id, 64) || !/^[\w-]{8,64}$/.test(b.id)) return "id";
  if (!isStr(b.uid, 64) || !b.uid) return "uid";
  if (!isStr(b.user, 40) || !b.user.trim()) return "user";
  if (!AGES.includes(b.age)) return "age";
  if (!GROUPS.includes(b.group)) return "group";
  if (!isInt(b.countMin) || !isInt(b.countMax) || b.countMin < COUNT_MIN || b.countMax > COUNT_MAX || b.countMin > b.countMax) return "count";
  if (!isStr(b.note ?? "", 500)) return "note";
  if (!isInt(b.clientTime)) return "clientTime";
  return null;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);


    const path = url.pathname.replace(/\/+$/, "");
    const now = Date.now();

    try {
      if (path === "/api/health") return json({ ok: true, time: now });

      // 名前がすでに別のスマホで使われているか（大文字・小文字は区別しない）
      if (path === "/api/names" && req.method === "GET") {
        const name = (url.searchParams.get("name") || "").trim(), uid = url.searchParams.get("uid") || "";
        if (!name) return json({ others: 0 });
        const r = await env.DB.prepare("SELECT COUNT(DISTINCT uid) AS n, MAX(client_time) AS last FROM records WHERE lower(user) = lower(?1) AND uid != ?2 AND deleted = 0")
          .bind(name, uid).first();
        return json({ others: r?.n || 0, last: r?.last || null });
      }

      // 一覧：期間指定（from/to）または差分取得（after = 前回の updatedAt）
      if (path === "/api/records" && req.method === "GET") {
        const from = Number(url.searchParams.get("from") ?? 0);
        const to = Number(url.searchParams.get("to") ?? 8.64e15);
        const after = url.searchParams.get("after");
        let rows;
        if (after != null) {
          rows = await env.DB.prepare(
            "SELECT * FROM records WHERE updated_at > ?1 AND client_time >= ?2 AND client_time <= ?3 ORDER BY updated_at LIMIT 1000"
          ).bind(Number(after), from, to).all();
        } else {
          rows = await env.DB.prepare(
            "SELECT * FROM records WHERE client_time >= ?1 AND client_time <= ?2 AND deleted = 0 ORDER BY client_time DESC LIMIT 5000"
          ).bind(from, to).all();
        }
        return json({ records: rows.results.map(toRecord), now });
      }

      // 追加（同じ id を再送しても二重にならない）
      if (path === "/api/records" && req.method === "POST") {
        const b = await req.json();
        const err = validate(b);
        if (err) return bad("invalid " + err);
        await env.DB.prepare(
          `INSERT OR IGNORE INTO records (id, uid, user, age, grp, gender, count_min, count_max, note, client_time, client_iso, tz_offset, lat, lng, acc, server_time, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?16)`
        ).bind(b.id, b.uid, b.user.trim(), b.age, b.group, genderOf(b.group), b.countMin, b.countMax, (b.note ?? "").trim(),
          b.clientTime, isStr(b.clientISO, 40) ? b.clientISO : null, isInt(b.tzOffsetMin) ? b.tzOffsetMin : null,
          numOrNull(b.lat), numOrNull(b.lng), numOrNull(b.acc), now).run();
        const row = await env.DB.prepare("SELECT * FROM records WHERE id = ?1").bind(b.id).first();
        return json({ record: row && toRecord(row) }, 201);
      }

      // GPX照合の結果をまとめて保存（誰でも可。GPXの列だけ書き換える）
      if (path === "/api/records/gpx" && req.method === "POST") {
        const { items } = await req.json();
        if (!Array.isArray(items) || items.length > 2000) return bad("invalid items");
        const stmt = env.DB.prepare(
          "UPDATE records SET gpx_lat = ?2, gpx_lng = ?3, gpx_diff_sec = ?4, gpx_interp = ?5, gpx_file = ?6, updated_at = ?7 WHERE id = ?1 AND deleted = 0"
        );
        const batch = items.filter(i => isStr(i.id, 64)).map(i =>
          stmt.bind(i.id, numOrNull(i.gpxLat), numOrNull(i.gpxLng), numOrNull(i.gpxDiffSec), i.gpxInterp ? 1 : 0, isStr(i.gpxFile, 200) ? i.gpxFile : null, now));
        for (let k = 0; k < batch.length; k += 100) await env.DB.batch(batch.slice(k, k + 100));
        return json({ updated: batch.length });
      }

      // ---- 軌跡 ----
      if (path === "/api/tracks" && req.method === "GET") {
        const from = Number(url.searchParams.get("from") ?? 0), to = Number(url.searchParams.get("to") ?? 8.64e15);
        return json({ tracks: await listTracks(env, from, to), now });
      }
      if (path === "/api/tracks" && req.method === "POST") {
        await ensureTracks(env);
        const b = await req.json();
        if (!isStr(b.id, 64) || !/^[\w-]{8,64}$/.test(b.id) || !isStr(b.uid, 64) || !b.uid || !isStr(b.user, 40) || !b.user.trim() || !isInt(b.startedAt)) return bad("invalid track");
        await env.DB.prepare("INSERT OR IGNORE INTO tracks (id, uid, user, started_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)")
          .bind(b.id, b.uid, b.user.trim(), b.startedAt, now).run();
        return json({ ok: true }, 201);
      }
      // ルートヒストリーのGPXを軌跡として取り込む（同じGPXを何度送っても1本だけ）
      if (path === "/api/tracks/import" && req.method === "POST") {
        await ensureTracks(env);
        const b = await req.json();
        if (!isStr(b.user, 40) || !b.user.trim() || !Array.isArray(b.points) || b.points.length < 2 || b.points.length > 50000) return bad("invalid import");
        const pts = b.points.filter(validPoint).map(p => [p[0], +(+p[1]).toFixed(7), +(+p[2]).toFixed(7), Number.isFinite(p[3]) ? Math.round(p[3]) : null]).sort((x, y) => x[0] - y[0]);
        if (pts.length < 2) return bad("no points");
        const user = b.user.trim(), t0 = pts[0][0], t1 = pts.at(-1)[0];
        let h = 2166136261; for (const c of `${user}|${t0}|${t1}|${pts.length}`) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
        const id = `gpx-${t0}-${h.toString(36)}`;
        const stmts = [
          env.DB.prepare("INSERT OR IGNORE INTO tracks (id, uid, user, started_at, ended_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
            .bind(id, "gpx:" + (isStr(b.file, 200) ? b.file : ""), user, t0, t1, now),
          env.DB.prepare("UPDATE tracks SET deleted = 0, user = ?2, updated_at = ?3 WHERE id = ?1").bind(id, user, now),
          env.DB.prepare("DELETE FROM track_chunks WHERE track_id = ?1").bind(id),
        ];
        for (let k = 0, seq = 0; k < pts.length; k += 2000, seq++) {
          const part = pts.slice(k, k + 2000);
          stmts.push(env.DB.prepare("INSERT INTO track_chunks (track_id, seq, t0, t1, n, points) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
            .bind(id, seq, part[0][0], part.at(-1)[0], part.length, JSON.stringify(part)));
        }
        await env.DB.batch(stmts);
        return json({ ok: true, id, n: pts.length });
      }
      const tm = path.match(/^\/api\/tracks\/([\w-]{8,64})\/(chunks|end)$/);
      if (tm && req.method === "POST") {
        await ensureTracks(env);
        const b = await req.json();
        const tr = await env.DB.prepare("SELECT uid FROM tracks WHERE id = ?1").bind(tm[1]).first();
        if (!tr) return bad("track not found", 404);
        if (tr.uid !== b.uid) return bad("not your track", 403);
        if (tm[2] === "chunks") {
          if (!isInt(b.seq) || !Array.isArray(b.points) || b.points.length > 3000) return bad("invalid chunk");
          const pts = b.points.filter(validPoint).map(p => [p[0], +(+p[1]).toFixed(7), +(+p[2]).toFixed(7), Number.isFinite(p[3]) ? Math.round(p[3]) : null]);
          await env.DB.batch([
            env.DB.prepare("INSERT OR REPLACE INTO track_chunks (track_id, seq, t0, t1, n, points) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
              .bind(tm[1], b.seq, pts[0]?.[0] ?? null, pts.at(-1)?.[0] ?? null, pts.length, JSON.stringify(pts)),
            env.DB.prepare("UPDATE tracks SET updated_at = ?2 WHERE id = ?1").bind(tm[1], Math.max(now, pts.at(-1)?.[0] ?? 0)),
          ]);
          return json({ ok: true, n: pts.length });
        }
        await env.DB.prepare("UPDATE tracks SET ended_at = ?2, updated_at = ?3 WHERE id = ?1").bind(tm[1], isInt(b.endedAt) ? b.endedAt : now, now).run();
        return json({ ok: true });
      }

      // ---- ここから管理ページ用（ADMIN_KEY が必要） ----
      const adminErr = () => !env.ADMIN_KEY ? bad("ADMIN_KEY が設定されていません", 403)
        : req.headers.get("x-admin-key") !== env.ADMIN_KEY ? bad("管理用パスワードが違います", 401) : null;
      if (path === "/api/admin/records" && req.method === "GET") {
        const e = adminErr(); if (e) return e;
        const from = Number(url.searchParams.get("from") ?? 0), to = Number(url.searchParams.get("to") ?? 8.64e15);
        const rows = await env.DB.prepare("SELECT * FROM records WHERE client_time >= ?1 AND client_time <= ?2 AND deleted = 0 ORDER BY client_time DESC LIMIT 20000").bind(from, to).all();
        return json({ records: rows.results.map(toRecord), now });
      }

      if (path === "/api/admin/tracks" && req.method === "GET") {
        const e = adminErr(); if (e) return e;
        const from = Number(url.searchParams.get("from") ?? 0), to = Number(url.searchParams.get("to") ?? 8.64e15);
        return json({ tracks: await listTracks(env, from, to), now });
      }
      const atm = path.match(/^\/api\/admin\/tracks\/([\w-]{8,64})$/);
      if (atm && req.method === "DELETE") {
        const e = adminErr(); if (e) return e;
        await ensureTracks(env);
        const r = await env.DB.prepare("UPDATE tracks SET deleted = 1, updated_at = ?2 WHERE id = ?1").bind(atm[1], now).run();
        return r.meta.changes ? json({ ok: true }) : bad("not found", 404);
      }

      // 管理ページからの削除
      const am = path.match(/^\/api\/admin\/records\/([\w-]{8,64})$/);
      if (am && req.method === "DELETE") {
        const e = adminErr(); if (e) return e;
        const r = await env.DB.prepare("UPDATE records SET deleted = 1, updated_at = ?2 WHERE id = ?1").bind(am[1], now).run();
        return r.meta.changes ? json({ ok: true }) : bad("not found", 404);
      }
      if (path === "/api/admin/check" && req.method === "POST") {
        const e = adminErr(); return e || json({ ok: true });
      }

      // 削除（記録した端末だけ。差分取得で他の端末にも伝わるよう論理削除）
      const m = path.match(/^\/api\/records\/([\w-]{8,64})$/);
      if (m && req.method === "DELETE") {
        const uid = url.searchParams.get("uid") || "";
        const r = await env.DB.prepare("UPDATE records SET deleted = 1, updated_at = ?3 WHERE id = ?1 AND uid = ?2").bind(m[1], uid, now).run();
        return r.meta.changes ? json({ ok: true }) : bad("not found or not yours", 404);
      }

      return bad("not found", 404);
    } catch (e) {
      return bad("server error: " + (e.message || e), 500);
    }
  },
};
