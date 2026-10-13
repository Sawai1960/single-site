# 変異位置 → hg38 ゲノム座標 変換ツール

がん関連シングルサイト解析の依頼書に記入する **hg38 のゲノム位置**を求めるための Web ツールです。
次の 4 形式の位置情報を入力すると、hg38 上の位置と依頼書用の **9 桁ゼロ埋め表記**を出力します。

| 形式 | 内容 | 入力例 |
| --- | --- | --- |
| 1 | リファレンスゲノムバージョンとゲノム位置 | `hg38, chr1:195507262` / `hg19 chr7:55259515 T>G` / `NC_000004.12:g.55113391C>T` |
| 2 | スプライシング型指定のコーディング DNA 位置 | `NM_002253.2:c.889G>A` / `NM_002253.2, c.889G>A` / `NM_000546.6:c.375+1G>A` |
| 3 | スプライシング型指定のタンパク質アミノ酸位置 | `NP_443086.1:p.Asp509Glyfs` / `NP_004976.2:p.G12D` |
| 4 | スプライシング型不明（遺伝子名 + c. / p.） | `KDR:c.889G>A` / `EGFR p.Leu858Arg` |

## 主な機能

- **c. → ゲノム**: エクソン、イントロン（`c.375+1`）、5'UTR（`c.-30`）、3'UTR（`c.*10`）、範囲指定（`c.68_69delAG`）に対応します。
- **p. → ゲノム**: 指定したアミノ酸のコドン 3 塩基のゲノム範囲を出力します。ミスセンス・ナンセンス変異の場合は、そのアミノ酸変化を起こす **1 塩基置換の候補**（c. 表記と hg38 位置）を一覧表示します。
- **リファレンス照合**: 入力した参照塩基やアミノ酸が hg38 と一致するかを確認します。不一致の候補は末尾に分けて表示します。
- **旧バージョンの NM 番号**: `NM_002253.2` のような旧版も、UCSC の RefSeq Historical アライメントを使って変換します。
- **スプライシング型不明（形式 4）**: 遺伝子の全転写産物で計算し、MANE Select を先頭に表示します。ゲノム位置が転写産物によって何通りに分かれるかも示します。遺伝子の別名（例: `VEGFR2` → `KDR`）にも対応します。
- **形式 1 の確認**: hg38 の参照塩基と、その位置に重なる転写産物の c. 表記を表示します。hg19 の位置は Ensembl の assembly mapping で hg38 に変換します。
- **依頼書向けの注意表示**: 欠失の範囲指定、20 塩基を超える変異、相同領域のある遺伝子（PMS2・BMPR1A・SDHD・CHEK2・NF1）、シグナル配列の番号表記について注意を表示します。
- **出力**: 9 桁表記のコピー、UCSC Genome Browser（hg38、該当位置をハイライト）へのリンク、CSV ダウンロード（Excel で開ける UTF-8 BOM 付き）。

## 起動方法

Node.js 20 以上が必要です。

```bash
npm install
npm run dev
```

ブラウザで <http://localhost:43127> を開きます。

初回の `npm run dev` で、転写産物データ（約 45 MB）を UCSC と NCBI からダウンロードし、`data/refseq-hg38.json.gz` を作ります。2 回目以降はそのデータを使います。最新データに更新するときは次を実行します。

```bash
npm run data
```

本番用のビルドと起動:

```bash
npm run build
npm start
```

## 仕組み

- **転写産物の構造**: UCSC hg38 の `ncbiRefSeqPsl` / `ncbiRefSeqPslHistorical`（RefSeq 転写産物のゲノムへのアライメント）、`ncbiRefSeqCds`（CDS 範囲）、`ncbiRefSeqLink`（遺伝子名と NP 番号）を使います。アライメントのブロック単位で座標を計算するため、転写産物とゲノムの間に小さな差異があっても正しく対応付けられます。
- **MANE**: NCBI の MANE summary（GRCh38）を使います。
- **参照配列**: 照合用の塩基は UCSC API から取得します（取得できない場合は Ensembl REST）。
- **hg19 → hg38**: Ensembl REST の assembly mapping を使います。

座標計算はサーバー内で行います。インターネット接続が必要なのは、参照塩基の照合と hg19 からの変換だけです。接続できない場合も位置は計算されますが、照合は行われません。

## 正しさの検証

### 1. ClinVar を正解とした大規模検証（`npm run validate`）

ClinVar の `variant_summary.txt.gz`（GRCh38）から、NM_ の c. 表記と hg38 の位置がそろった変異を 9,000 件抽出しました。変異の種類ごとに層化抽出しています（エクソン内の置換 3,000、イントロン 1,500、5'UTR 500、3'UTR 500、欠失 1,500、重複 1,000、挿入 500、欠失挿入 500）。このサンプルで、本ツールと同じ関数の結果を照合します。

| 検証項目 | 内容 |
| --- | --- |
| 形式2 | `NM_:c.` から求めた hg38 位置が ClinVar と一致するか。置換は塩基の鎖の向きも確認します。欠失・挿入は、hg38 の参照配列に両方の変異を適用し、変異後の配列が同一かで判定します |
| 形式1（逆変換） | ClinVar の hg38 位置から求めた c. 位置が ClinVar の表記と一致するか |
| 形式3 | ミスセンス・ナンセンス変異の `NP_:p.` から求めたコドン範囲に正解位置が含まれるか。一部（300 件）は参照アミノ酸と 1 塩基置換の結果も照合します |
| 形式4 | `遺伝子名:c.` の候補に正解位置が含まれるか |
| 画面と同じ処理 | 300 件を Web API と同じ処理全体（リファレンス照合を含む）で確認します |

サンプルは 2 つあります。1 つ目（開発用）は、見つかった不具合の修正に使いました。2 つ目（評価用）は、開発用に含まれた 3,919 遺伝子をすべて除外して抽出した、**一度も見ていない遺伝子だけ**のサンプルです。

| サンプル | 一致 / 照合件数 | 一致率 |
| --- | ---: | ---: |
| 開発用（[`report.md`](validation/report.md)） | 22,894 / 22,900 | 99.97% |
| 評価用・未見の遺伝子（[`report-heldout.md`](validation/report-heldout.md)） | 23,214 / 23,226 | 99.95% |

不一致 18 件はすべて原因を調べました。本ツールが警告なしに誤った位置を出したケースはありませんでした。大半は、hg38 の参照配列の欠損（SHANK3、MROH8）か ClinVar 側の表記誤りです。いずれも NCBI の転写産物配列と直接比べて確認しました。検証で見つかった不具合 4 件は修正済みで、回帰テストに含めています。詳しくは [`validation/ANALYSIS.md`](validation/ANALYSIS.md) を参照してください。

旧バージョンの NM 番号だけを集めた 3 つ目のサンプル（4,827 件、[`report-historical.md`](validation/report-historical.md)）でも検証しました。

- 本ツールのデータにある旧版では、3,687 / 3,781 件（97.51%）が一致しました。不一致 94 件に座標計算の誤りはありませんでした。79 件は GAGE・GSTT2 など、ほぼ同じ配列のコピーを持つ遺伝子です。UCSC が NCBI とは別のコピーに対応付けています。
- データに無い版を別の版で代替した場合は、514 / 704 件（73.0%）しか一致しません。本ツールは代替時に必ず警告を出します。**この警告が出たら、結果を正しいものとして扱わないでください。**

ClinVar のサンプルは、次のコマンドで最新版から取り直せます（約 450 MB をストリーミングで読み込みます。保存はしません）。

```bash
npm run validate:fetch   # validation/clinvar-sample.tsv を再作成
npm run validate         # validation/report.md を更新（外部 API で一部の参照配列を取得します）

# 評価用: 開発用サンプルの遺伝子を除外し、乱数シードを変えて抽出・検証
node validation/fetch-clinvar.mjs --seed 777 \
  --exclude-genes-from validation/clinvar-sample.tsv --out validation/clinvar-sample-heldout.tsv
npx tsx validation/validate-clinvar.ts \
  --sample validation/clinvar-sample-heldout.tsv --report validation/report-heldout.md

# 旧バージョンの NM 番号だけを抽出・検証
node validation/fetch-clinvar.mjs --seed 4242 --historical-only --out validation/clinvar-sample-historical.tsv
npx tsx validation/validate-clinvar.ts \
  --sample validation/clinvar-sample-historical.tsv --report validation/report-historical.md
```

### 2. 回帰テスト（`npm test`）

`tests/` に 97 件のテストがあります。

- `parse.test.ts`: 色々な書き方の入力（全角文字、ClinVar 形式、1 文字・3 文字のアミノ酸記号、エラー入力）の解析
- `mapping.test.ts`: ClinVar の正解値を使った座標計算（両方の鎖、イントロン、UTR、欠失・挿入、修正した不具合の再発防止）
- `convert.test.ts`: Web API と同じ処理全体（リファレンス照合、注意表示、候補の並び順、hg19 からの変換、エラー表示）

外部 API の応答は `tests/fixtures/remote.json` に保存したものを再生します。そのため、テストはオフラインでも同じ結果になります。テストケースを追加したときは、`RECORD_FIXTURES=1 npm test` で応答を記録し直してください。

## API

```bash
curl -X POST http://localhost:43127/api/convert \
  -H 'Content-Type: application/json' \
  -d '{"queries": ["NM_002253.2:c.889G>A", "KRAS p.G12D"]}'
```

## 注意

変換結果は参考情報です。依頼書に記入する前に、ゲノムブラウザで目的の変異であることを必ず確認してください。
古くから知られる変異は、シグナル配列を除いた成熟型タンパク質の番号で表記されていることがあります。その場合は、シグナル配列を含む番号に直してから入力してください。
