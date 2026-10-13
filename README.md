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
- **UCSC に無いバージョン**: UCSC がアライメントしていない NM_/NP_ のバージョン（UCSC より新しい版も含む）は、NCBI からその版の配列を取得します。UCSC にある別の版と配列を照合し、両者で配列が同じ部分だけ位置を求めます。配列が違う部分や、その境界から 10 塩基以内は、推測せずにエラーにします。
- **バージョン番号なしの NM_/NP_**: `NM_004333:c.100G>A` のようにバージョンが無い場合は、全バージョンで計算して位置を比べます（FoundationOne の報告書など、NM 番号にバージョンが書かれていないことがあるため）。UCSC のデータに無い途中の版は NCBI の配列で補います。すべて同じ位置なら「変換成功」、版によって位置が違えば「要確認」とし、版ごとの位置を表で示します。
- **外部データベースとの照合**: 各候補について、UCSC のアライメントを使わない NCBI Variation Services と Ensembl VEP（RefSeq 転写産物）で同じ変換を行い、本ツールの結果と並べて「一致／不一致／確認不可」を示します。c. → hg38（順変換）と hg38 → c.（逆変換）の両方向を照合します。不一致の候補があれば結果を「要確認」にします。
- **スプライシング型不明（形式 4）**: 遺伝子の全転写産物で計算し、MANE Select を先頭に表示します。ゲノム位置が転写産物によって何通りに分かれるかも示します。遺伝子の別名（例: `VEGFR2` → `KDR`）にも対応します。
- **形式 1 の確認**: hg38 の参照塩基と、その位置に重なる転写産物の c. 表記を表示します。hg19 の位置は Ensembl の assembly mapping で hg38 に変換します。
- **依頼書向けの注意表示**: 欠失の範囲指定、20 塩基を超える変異、相同領域のある遺伝子（PMS2・BMPR1A・SDHD・CHEK2・NF1）、シグナル配列の番号表記について注意を表示します。
- **複数コピーの遺伝子**: コード領域の半分以上が、配列が 95% 以上同一の重複領域（UCSC `genomicSuperDups`）にある遺伝子（GAGE、GSTT2、SMN1、CYP2D6、OPN1LW など約 1,000 遺伝子）では、もう一方のコピーの位置と遺伝子名を示して注意を出します。データベースによって対応付けるコピーが違うことがあり、塩基の照合では区別できないためです。
- **転写産物と hg38 の挿入・欠失の差**: 位置の近くで転写産物と hg38 に挿入・欠失の差がある場合は、反復配列の中で位置がずれうることを注意します。
- **遠い上流・下流**: `c.-N` / `c.*N` が転写産物の外にある場合は、100 kb までゲノム上で延長して計算します（DMD の上流プロモーターなど）。
- **出力**: 9 桁表記のコピー、UCSC Genome Browser（hg38、該当位置をハイライト）へのリンク、CSV ダウンロード（Excel で開ける UTF-8 BOM 付き）。

## 起動方法

Node.js 20 以上が必要です。

```bash
npm install
npm run dev
```

ブラウザで <http://localhost:43127> を開きます。

初回の `npm run dev` で、転写産物データ（約 50 MB）を UCSC と NCBI からダウンロードし、`data/refseq-hg38.json.gz` を作ります。2 回目以降はそのデータを使います。データの形式が古い場合は自動で作り直します。最新データに更新するときは次を実行します。

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
- **重複領域**: UCSC の `genomicSuperDups`（分節重複、95% 以上同一のもの）を使います。
- **UCSC に無いバージョン**: NCBI E-utilities（efetch）でその版の配列と CDS を取得します。UCSC にある同じ番号の版の mRNA 配列と照合し、その版の hg38 アライメントに重ねて位置を求めます。NP_ の場合は、NCBI のレコードからコードする NM_ を求めます。環境変数 `NCBI_API_KEY` を設定すると、NCBI へのアクセス上限が 3 回/秒から 10 回/秒になります（任意）。
- **参照配列**: 照合用の塩基は UCSC API から取得します（取得できない場合は Ensembl REST）。
- **hg19 → hg38**: Ensembl REST の assembly mapping を使います。
- **外部データベースとの照合**（`/api/verify`、結果の表示後に非同期で実行）:
  - NCBI 順変換: `hgvs/{c.}/contextuals` で転写産物上の SPDI を求め、`spdi/{SPDI}/all_equivalent_contextual` で hg38（NC_）上の同じ変異を得ます。
  - NCBI 逆変換: hg38 の各塩基を SPDI にして `all_equivalent_contextual` で転写産物上の位置を得て、NCBI のレコードの CDS 範囲から c. 位置に直します。
  - Ensembl: VEP の `hgvs`（順変換）と `region`（逆変換、`hgvs=1`）を `refseq=1` で呼びます。
  - 欠失・重複・挿入は書き方（左寄せ・右寄せ、dup と ins）が違っても、hg38 の参照配列に適用した結果が同じなら一致とします。
  - NCBI はイントロン内の変異に対応していません。逆変換で返すのは現行版の NM_ だけです。Ensembl は現行版の NM_ しか持っておらず、応答に数十秒かかったり一時的なエラーを返したりします（自動で再試行します）。照合できない場合は理由つきで「確認不可」と表示します。
  - 画面では、先頭 5 件の結果を自動で照合します。それ以降は候補ごとの「照合する」から実行します。

座標計算はサーバー内で行います。インターネット接続が必要なのは、参照塩基の照合、hg19 からの変換、UCSC に無いバージョンの配列取得、外部データベースとの照合だけです。接続できない場合も位置は計算されますが、照合は行われません。UCSC に無いバージョンは、NCBI に接続できないと別の版で計算し、その旨を表示します。

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

- 本ツールのデータにある旧版では、3,689 / 3,781 件（97.57%）が一致しました。不一致 92 件に座標計算の誤りはありませんでした。79 件は GAGE・GSTT2 など、ほぼ同じ配列のコピーを持つ遺伝子で、UCSC が NCBI とは別のコピーに対応付けています。現在はこの 79 件すべてに分節重複の注意が出ます。
- データに無い版は、NCBI の配列で照合して 659 / 703 件（93.7%）が一致しました。以前の方法（別の版で代わりに計算）では 514 / 704 件（73.0%）でした。残りは、計算を断るエラー（37 件）、注意付きの結果（6 件）、ClinVar の誤り（1 件）です。**注意なしに誤った位置を出したケースはありませんでした。**

外部データベースとの照合そのものも検証しました（[`report-external.md`](validation/report-external.md)）。旧版サンプルから 536 件を選んで照合したところ、NCBI が本ツールの正しい結果を「不一致」とした誤警報は 1 件だけでした（ORAI1、もともと注意が出るケース）。一方、配列が同一の重複コピー（GSTT2 など）の取り違えは、NCBI も同じコピーを選ぶため外部照合では検出できません。旧版やイントロン内の変異は「確認不可」になりやすいです。詳しくは [`validation/ANALYSIS.md`](validation/ANALYSIS.md) を参照してください。

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

# 外部データベースとの照合の検証（NCBI のみなら --ensembl を外す。30 分ほどかかります）
npx tsx validation/validate-external.ts --ensembl
```

### 2. 回帰テスト（`npm test`）

`tests/` に 134 件のテストがあります。

- `parse.test.ts`: 色々な書き方の入力（全角文字、ClinVar 形式、1 文字・3 文字のアミノ酸記号、エラー入力）の解析
- `mapping.test.ts`: ClinVar の正解値を使った座標計算（両方の鎖、イントロン、UTR、欠失・挿入、遠い上流、修正した不具合の再発防止）
- `seqalign.test.ts`: バージョン間の配列照合（延長、置換、欠失、ゲノムのアライメントとの合成）
- `convert.test.ts`: Web API と同じ処理全体（リファレンス照合、注意表示、複数コピーの遺伝子、UCSC に無いバージョン、バージョン番号なしの全版比較、候補の並び順、hg19 からの変換、エラー表示）
- `verify.test.ts`: NCBI・Ensembl との照合（一致、位置をずらすと不一致になること、重複コピーの検出、イントロン、dup と ins の等価判定、Ensembl に無い旧版）

外部 API の応答は `tests/fixtures/remote.json` と `tests/fixtures/external.json` に保存したものを再生します。そのため、テストはオフラインでも同じ結果になります。テストケースを追加したときは、`RECORD_FIXTURES=1 npm test` で応答を記録し直してください。

## API

```bash
curl -X POST http://localhost:43127/api/convert \
  -H 'Content-Type: application/json' \
  -d '{"queries": ["NM_002253.2:c.889G>A", "KRAS p.G12D"]}'
```

`/api/convert` の各候補の `verify` を `/api/verify` に渡すと、外部データベースと照合します（`source` は `ncbi` か `ensembl`）。

```bash
curl -X POST http://localhost:43127/api/verify \
  -H 'Content-Type: application/json' \
  -d '{"source": "ncbi", "items": [{"transcript": "NM_002253.4", "chrom": "chr4", "plan": <候補の verify>}]}'
```

## 注意

変換結果は参考情報です。依頼書に記入する前に、ゲノムブラウザで目的の変異であることを必ず確認してください。
古くから知られる変異は、シグナル配列を除いた成熟型タンパク質の番号で表記されていることがあります。その場合は、シグナル配列を含む番号に直してから入力してください。
