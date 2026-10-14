# 引継書: シングルサイト解析のための HGVS–GRCh38 座標自動変換ツール

作成: 2026-10-14（クラウドの Cursor エージェントから、PC 内の Cursor への引き継ぎ）
更新: 2026-10-14（題名・免責事項の追加、UMIN SQUARE で公開するための作り替え）

この文書は、次に作業する Cursor エージェント（と利用者本人）向けです。使い方と仕組みの詳細は `README.md`、検証の詳細は `validation/ANALYSIS.md` にあります。ここでは、それらに書いていない「経緯・決めたこと・作業の進め方・残作業」をまとめます。

---

## 1. 作業の進め方（利用者のルール。必ず守る）

- 回答は日本語で行う。
- 前置きのお世辞は書かない。
- 質問されたら、まず自分の意見を述べる。
- **ユーザーが明示的に「OK」と言うまで、コードを書いたりタスクを実行したりしない。** まず内容を提案し、了解を得てから着手する。
- **ファイルの削除・移動・名前の変更・上書きは、必ず事前に許可を得る。**
- 説明は専門用語を避け、手順は 1 行ずつ具体的に書く（利用者は Windows・PowerShell を使用。git やターミナルには不慣れ）。
- 質問は AskQuestion を使ってよいが、**提案の文面は必ずメッセージ本文に書く**（AskQuestion の選択肢だけでは案が見えないと指摘された）。

## 2. このツールの目的

シングルサイト解析（既知の変異 1 か所だけを調べる検査）の依頼書に記入する **hg38 のゲノム位置**を求める Web ツール。がん関連に加え、難病の遺伝子パネル検査で見つかった変異の家系解析にも使う。

もとになった依頼書の仕様（かずさ DNA 研究所の資料）から決めたこと:

- 入力は 4 形式: 形式 1 ゲノム位置（hg38/hg19、NC_ g.、ミトコンドリアの m.）、形式 2 `NM_:c.`、形式 3 `NP_:p.`、形式 4 遺伝子名 + c./p.
- 出力は hg38 の位置と、依頼書用の **9 桁ゼロ埋め**表記。
- 候補の NM_ はすべて表示する（MANE Select を先頭）。
- 2 塩基以上の欠失は範囲内のどこを指定してもよい。内容は依頼書の特記事項欄に書く旨を表示。
- 位置は UCSC Genome Browser（genome-asia）で確認するよう案内。
- シグナル配列を除いた成熟型タンパク質の番号に注意を表示。
- NGS で確認できるのは 1〜20 塩基程度。相同領域のある遺伝子（PMS2・BMPR1A・SDHD・CHEK2・NF1）は注意を表示。

## 3. 現在の状態

- `5308b95`: 計算方法の表示（旧 7-1）、題名・説明の変更、「利用上の注意と免責事項」と作成者（兵庫医科大学 澤井英明）の追加。
- その次: **UMIN SQUARE で公開するための作り替え**（サーバー不要の静的サイト化）。詳細は「4-2. 公開の仕組み」。
- テスト 149 件すべて成功（`npm test`、約 5 秒）。型チェック・lint も問題なし。
- 作り替えの前後で結果が変わらないことを、ClinVar の検証用データから作った 13,805 件の入力で確認済み（差 0 件）。
- 書き出したサイトを手元（`npm.cmd run preview`）で開き、変換と外部照合が動くことを確認済み。**UMIN への実際の送信は未確認**（アカウント未作成のため）。
- これまでのコードは Cursor の Origin（`sawai/hgvs-genomic-converter`、非公開）にある。**今後は利用者が GitHub に上げたリポジトリを本体とする**予定。利用者の手元のフォルダーは ZIP から展開したもので、コミット履歴は含まれていない。

## 4. Windows での起動（利用者の環境で確認済み）

PowerShell では、実行ポリシーのため `npm` が動かない。**`npm.cmd` を使う。**

```powershell
npm.cmd install
npm.cmd run dev
```

- ブラウザで <http://localhost:43127/single-site/> を開く（公開先と同じ `/single-site/` が付く）。
- 初回の `npm.cmd run dev` は、元データ（`data/raw/`）を UCSC と NCBI からダウンロードし、`public/data/` に分割したデータを作るので数分かかる。`data/`、`public/data/`、`out/`、`node_modules/` は `.gitignore` 済み。
- 旧形式の `data/refseq-hg38.json.gz` は使わなくなった（削除は利用者の許可待ち。消さなくても動作に影響はない）。
- フォルダーは OneDrive の外に置くのが望ましい（`node_modules` の同期で重くなる）。利用者には `C:\Users\sawai` などを勧めている。
- スクリプト内でファイルの場所を求めるときは `fileURLToPath(import.meta.url)` を使う。`new URL(import.meta.url).pathname` は Windows で `C:\C:\…` になり、日本語のフォルダー名も壊れる（実際に起きた不具合）。

## 4-2. 公開の仕組み（UMIN SQUARE）

- 公開先: <https://square.umin.ac.jp/single-site/>。アカウント名 `single-site` は利用者が申請予定（2026-10-14 時点で未作成。UMIN の新規受付は 10 月第 3 週から）。アカウント名は後から変えられない。
- UMIN SQUARE は静的ファイルだけを置ける（CGI 不可）。PLAZA は CGI（Perl/PHP）が使えるが Node.js は無い。そのため、**サーバーを使わずブラウザだけで動く形**に作り替えた。
  - `next.config.ts`: `output: "export"`、`basePath: "/single-site"`（環境変数 `BASE_PATH` で変更可）、`trailingSlash: true`。書き出し方式では Cache Components（PPR）が使えないので外した。
  - `src/app/api/*` は削除。変換（`convertMany`）と外部照合（`verifyItems`）は画面のコードから直接呼ぶ。
  - 外部サービス（UCSC API、Ensembl REST、NCBI E-utilities、NCBI Variation Services）はすべてブラウザからの直接呼び出しを許可している（確認済み）。NCBI の API キーはブラウザでは隠せないので使わない（NCBI へは 350 ms 間隔で送る）。
- **データの分割**（`scripts/build-data.mjs`、データ形式 v5）: `public/data/index.json.gz`（目次、約 1.5 MB）と `public/data/b/0000〜1023.json.gz`（束、合計約 12 MB、最大 42 KB）。
  - 束の振り分けは、NM_ 番号ごとに現行版の遺伝子名のハッシュで決める。同じ NM_ 番号の全バージョンは同じ束に入る。
  - 目次には、NM_ 番号・NP_ 番号・遺伝子名・別名・ゲノム範囲から束を引く表と、分節重複の表が入っている。
  - `src/lib/variant/refseq.ts` の `ensureTarget`／`ensureAccessions`／`ensureRegion`／`ensureDuplicateContext` が必要な束だけを読み込む。`ensureAll` は全部読む（検証スクリプト・一部のテスト用）。
  - テストと検証スクリプトは `tests/setup.ts` でファイルから直接読む（`setDataReader`）。
- **公開の手順**: `npm.cmd run publish`（データ更新 → 書き出し → sftp で `html/` に送信。途中で UMIN のパスワードを入力）。`-- --skip-data` でデータ更新を省略、`-- --no-upload` で書き出しのみ。`npm.cmd run preview` で <http://localhost:43128/single-site/> に書き出し結果を表示できる。データ更新は半年に 1 回程度でよいと利用者に説明済み。
- 注意点:
  - `single-site.umin.jp`（バーチャルホスト）や `~single-site` の住所では動かない（`/single-site/` 前提で書き出しているため）。
  - sftp の `put` は古いファイルを消さないので、更新のたびに `html/_next/` に古いファイルがたまる（動作に影響はない。気になれば WinSCP で整理）。
  - Windows 標準の sftp が UMIN の暗号方式に対応していない場合は、WinSCP で `out/` の中身を送る。

## 5. 技術構成と主なファイル

- Next.js 16（App Router）+ TypeScript + Tailwind + shadcn/ui（Base UI）。テストは Vitest。
- **Next.js 16 は従来版と API が違う。** コードを書く前に `node_modules/next/dist/docs/` を確認する（`AGENTS.md` 参照）。

| ファイル | 役割 |
| --- | --- |
| `scripts/build-data.mjs` | UCSC hg38 の `ncbiRefSeqPsl`／`ncbiRefSeqPslHistorical`／`ncbiRefSeqCds`／`ncbiRefSeqLink`、NCBI の MANE、UCSC の `genomicSuperDups` から転写産物データを作る |
| `src/lib/variant/parse.ts` | 入力の解析（全角文字、ClinVar 形式、m. 表記など） |
| `src/lib/variant/mapping.ts` | 座標計算の中心。アライメントのブロック `[転写産物位置, ゲノム位置, 長さ]` で c. ↔ ゲノムを換算 |
| `src/lib/variant/convert.ts` | 入力 1 件の変換全体（`convertOne`）。注意表示、バージョン比較、ミトコンドリア |
| `src/lib/variant/refseq.ts` | 転写産物データの読み込み（必要な束だけ）と検索（`byBase`／`byProtBase`／`byAcc`） |
| `src/lib/variant/bridge.ts`, `seqalign.ts` | UCSC に無い NM_ のバージョンを、NCBI の配列と照合して既存の版に重ねる |
| `src/lib/variant/remote.ts` | 外部取得（参照塩基、hg19→hg38、NCBI efetch、ミトコンドリアの遺伝子） |
| `src/lib/variant/external-api.ts`, `verify.ts` | NCBI Variation Services と Ensembl VEP による外部照合 |
| `src/lib/variant/format.ts` | CSV 出力 |
| `src/components/*` | 画面（`converter.tsx` が全体、`candidate-view.tsx` が候補 1 件、`verification.tsx` が外部照合） |
| `scripts/publish.mjs`, `preview.mjs` | UMIN への公開、書き出し結果の手元表示 |
| `validation/*` | ClinVar を正解とした大規模検証と外部照合の検証（結果は `validation/ANALYSIS.md`） |

## 6. これまでに決めた仕様の要点

- **バージョンなしの NM_／NP_**: 全バージョンで計算して位置を比べる。UCSC に無い途中の版は NCBI の配列で補う（最大 8 版）。全部同じ位置なら「変換成功」、違えば「要確認」にして版ごとの表を出す。
- **UCSC に無い版**: NCBI から配列を取り、UCSC にある別の版と照合。配列が同じ部分だけ位置を求め、違う部分とその境界から 10 塩基以内はエラーにする（推測しない）。
- **外部照合**: c.→hg38（順変換）と hg38→c.（逆変換）を NCBI と Ensembl で行い、一致／不一致／確認不可を表示。不一致があれば「要確認」。画面では先頭 5 件を自動で照合する。欠失・挿入は参照配列に適用した結果で比べる（左寄せ・右寄せ、dup と ins の違いを吸収）。
  - NCBI はイントロン内の変異に非対応。Ensembl は現行版の NM_ しか持たず、応答が遅い・不安定（150 秒まで再試行）。パッチ領域の結果は「確認不可」にする。
- **重複領域**: コード領域の半分以上が 95% 以上同一の分節重複にある遺伝子（GSTT2、SMN1、CYP21A2 など）は、もう一方のコピーを示して注意を出す。外部照合でもコピーの取り違えは見分けられない。
- **ミトコンドリア**: m. の番号は rCRS（NC_012920.1）＝ hg38 の chrM。遺伝子と領域は NCBI の NC_012920.1 の GenBank レコードから取る。ヘテロプラスミーと NUMT の注意を出す。hg19 の chrM は UCSC では NC_001807（番号が違う）なので注意を出す。p. 表記には対応していない（通常 m. で報告されるため）。外部照合の対象外。
- **対象外の変異**（README に記載）: エクソン単位以上の欠失・重複（CNV）、リピート病、偽遺伝子のある遺伝子の受け入れ可否は検査会社が判断。

## 7. 残作業（未着手。必ず利用者の OK を得てから）

### 7-1. UMIN SQUARE への初回公開（アカウント作成待ち）

- 利用者が UMIN SQUARE のアカウント `single-site` を作成したら、`npm.cmd run publish` で送信し、<https://square.umin.ac.jp/single-site/> で変換と外部照合が動くか確認する。
- sftp で送れない場合は WinSCP の手順を案内する。UMIN がすでに圧縮を解いて返す場合も読めるようにしてある（`readJson` で判定）が、実際の UMIN では未確認。

### 7-2. その他の候補（利用者からの依頼はまだない）

- CSV の注意事項の列の先頭に「計算方法: UCSC hg38 RefSeq アライメント」を入れる（旧 7-1 の任意項目。未実施）。
- 旧形式のデータ `data/refseq-hg38.json.gz` の削除（許可が必要）。

## 8. 確認・テストの方法

```powershell
npm.cmd test          # 回帰テスト（外部 API の応答は tests/fixtures の記録を再生するのでオフラインで動く）
npm.cmd run typecheck
npm.cmd run lint
```

テストケースを追加して外部 API の応答を記録し直すときは、`RECORD_FIXTURES=1` を付けて実行する（PowerShell では `$env:RECORD_FIXTURES="1"; npm.cmd test`）。
