# ゼミ観測ログ — Cloudflare版 セットアップ手順

スマホで「年齢・グループ・性別・人数（?人〜?人）・場所/状況」をタップで記録し、全員の記録を共有するWebアプリです。
ルートヒストリーで書き出したGPXと時刻で照合し、記録した瞬間の位置を求められます。

**しくみ**：Cloudflare Pages が画面（`public/`）を配信し、API（`src/worker.js`）を Pages Functions として動かし、データは Cloudflare D1（SQLiteのデータベース）に保存します。
すべてCloudflareアカウント1つで完結し、無料プランの範囲で動きます。

`public/index.html` をブラウザで直接開くと **デモモード**（その端末の中だけに保存）で操作感を確かめられます。

---

## フォルダ構成

| ファイル | 役割 |
|---|---|
| `public/index.html` | 画面と処理（入力・記録一覧・地図/GPX照合） |
| `public/sw.js` `manifest.webmanifest` `icons/` | ホーム画面への追加・オフライン起動 |
| `src/worker.js` | API（記録の追加・取得・削除、GPX照合結果の保存） |
| `functions/api/[[path]].js` | Pages から API（src/worker.js）を呼び出す入口 |
| `schema.sql` | データベースの表 |
| `wrangler.jsonc` | Cloudflareの設定 |

---

## 公開手順（初回のみ）

Cloudflare Pages で公開します（URL は `https://<プロジェクト名>.pages.dev`）。PCで、Node.js 18以上がある状態で行います。

```bash
cd fieldlog
npm install
npx wrangler login
npx wrangler d1 create fieldlog                       # 表示された database_id を wrangler.jsonc に貼る
npx wrangler d1 execute fieldlog --remote --file=schema.sql
npx wrangler pages project create reitaku-fieldlog --production-branch=main
npx wrangler pages deploy
```

- プロジェクト名（`reitaku-fieldlog`）を変える場合は、`wrangler.jsonc` の `name` も同じにします
- 更新するときは `npx wrangler pages deploy` だけでOK
- 手元で試すとき：`npx wrangler d1 execute fieldlog --local --file=schema.sql` → `.dev.vars` に `TEAM_KEY=test` → `npx wrangler pages dev`

> 合言葉なしで使える設定です。URLはゼミの中だけで共有してください。

---

## メンバーへの配り方

1. URLを共有
2. 開くと「名前」を聞かれます
   - **名前はローマ字で、GPXのファイル名と同じに**（例：`takumi` → `takumi.gpx` / `takumi_1014.gpx`）すると照合時に自動で割り当てられます
3. ホーム画面に追加するとアプリのように使えます
   - iPhone：Safariで開く → 共有 → 「ホーム画面に追加」
   - Android：Chromeのメニュー → 「ホーム画面に追加」

---

## 使い方

### 入力
年齢・グループ・性別を1つずつタップ → 人数を「最小〜最大」で選ぶ → 必要ならメモ → **記録する**

- 人数：−/＋をタップで1ずつ、長押しで連続して変わります。下のスライダーで2つのつまみを動かしてもOK
  - ちょうど5人なら最小・最大とも5（最小を上げると最大も自動で追従します）
- 記録時刻は「記録する」を押した瞬間（ミリ秒まで）。端末の時刻とサーバーが受け取った時刻の両方を保存します
- 記録直後の5秒間は「取り消す」で取り消せます
- 電波がなくても記録できます。「送信待ち」と表示され、つながったら自動で送られます（同じ記録が二重に登録されることはありません）

### 記録
全員の記録が数秒ごとに自動で更新されます。期間・全員/自分・グループで絞り込めます。自分の記録はゴミ箱アイコンで削除できます。

### 地図・GPX（PCでの作業がおすすめ）
1. ルートヒストリーで観測中の移動を記録 → GPXファイルとして書き出す
2. 「GPXファイルを選ぶ」で読み込み（複数可）→ 「誰の記録？」を確認
3. **照合する**：記録時刻の直前・直後のGPX地点から、記録した瞬間の位置を時間の比率で補間します
4. **照合結果をみんなのデータに保存** で、全員の地図に表示されます
5. **CSVをダウンロード** でExcel・Python・QGISなどの分析に使えます

---

## CSVの列

| 列 | 内容 |
|---|---|
| `datetime_local` | 記録時刻（日本時間、ミリ秒まで） |
| `epoch_ms` | 同じ時刻のUNIXミリ秒（計算用） |
| `age` / `group` / `gender` / `note` | 入力内容 |
| `count_min` / `count_max` | 人数の範囲（ちょうどの場合は同じ値） |
| `device_lat` / `device_lng` / `device_acc_m` | スマホの位置情報（オンにした場合） |
| `gpx_lat` / `gpx_lng` / `gpx_diff_sec` / `gpx_file` | GPX照合の結果（`gpx_diff_sec` は最も近いGPX地点との時間差・秒） |
| `server_time` | サーバーが受け取った時刻 |

## タグを変えたいとき

`public/index.html` の `TAGS` と、`src/worker.js` の `AGES` / `GROUPS` / `GENDERS` を同じ内容に直して `npx wrangler pages deploy` してください。

## 注意

- 無料プランの D1 は1日あたり読み取り500万行・書き込み10万行まで。15人で数秒ごとに更新しても、前回からの差分だけを取りに行く作りなので十分収まります
- 時刻は各自のスマホの時計に依存します。「日付と時刻を自動設定」がオンか確認してください

---

## 管理・集計ページ

`https://<プロジェクト名>.pages.dev/admin.html` を開くと、集まったデータの集計が見られます（PC推奨）。

- 期間・メンバー・グループ・年齢で絞り込み
- 記録数・観測人数・メンバー数・位置がわかる記録の割合
- 時間帯ごとの観測人数、グループ別・年齢層別、グループ×年齢層のクロス集計
- メンバー別の記録数とGPX照合の状況、地図、記録一覧（検索つき）
- 表示中の条件でCSVダウンロード（`group_label` 列に日本語名つき）
- 20秒ごとに自動更新

誰の記録でも削除できるようにするには、管理用パスワードを設定します。

```bash
npx wrangler pages secret put ADMIN_KEY --project-name=<プロジェクト名>
```

## 性別について

入力欄はありません。CSVの `gender` 列はグループから自動で入ります（女の子のグループ・女の子1人＝F、男の子のグループ・男の子1人＝M、それ以外は空欄）。
