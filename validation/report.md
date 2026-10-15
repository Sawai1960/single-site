# ClinVar を正解とした検証レポート

- 実行日時: 2026-10-14T12:51:47.575Z
- 正解データ: https://ftp.ncbi.nlm.nih.gov/pub/clinvar/tab_delimited/variant_summary.txt.gz (Last-Modified: Mon, 12 Oct 2026 22:21:13 GMT)
- サンプル: 9,000 件（`validation/clinvar-sample.tsv`、種類別に層化抽出）
- 所要時間: 2466 秒

| 検証項目 | 区分 | 一致 | 不一致 | 対象外 | 一致率 |
| --- | --- | ---: | ---: | ---: | ---: |
| 画面と同じ処理（convertOne）: 位置・リファレンス照合 | — | 300 | 0 | 0 | 100.00% |
| 形式1（逆変換）: hg38 位置 → c. 表記 | cds:substitution | 3000 | 0 | 0 | 100.00% |
| 形式1（逆変換）: hg38 位置 → c. 表記 | intron:substitution | 1499 | 1 | 0 | 99.93% |
| 形式1（逆変換）: hg38 位置 → c. 表記 | utr3:substitution | 500 | 0 | 0 | 100.00% |
| 形式1（逆変換）: hg38 位置 → c. 表記 | utr5:substitution | 500 | 0 | 0 | 100.00% |
| 形式2: NM_:c. → hg38 位置 | any:deletion | 1499 | 1 | 0 | 99.93% |
| 形式2: NM_:c. → hg38 位置 | any:delins | 500 | 0 | 0 | 100.00% |
| 形式2: NM_:c. → hg38 位置 | any:duplication | 1000 | 0 | 0 | 100.00% |
| 形式2: NM_:c. → hg38 位置 | any:insertion | 498 | 2 | 0 | 99.60% |
| 形式2: NM_:c. → hg38 位置 | cds:substitution | 3000 | 0 | 0 | 100.00% |
| 形式2: NM_:c. → hg38 位置 | intron:substitution | 1499 | 1 | 0 | 99.93% |
| 形式2: NM_:c. → hg38 位置 | utr3:substitution | 500 | 0 | 0 | 100.00% |
| 形式2: NM_:c. → hg38 位置 | utr5:substitution | 500 | 0 | 0 | 100.00% |
| 形式3: NP_:p. → コドン範囲に正解位置を含むか | missense | 2307 | 0 | 0 | 100.00% |
| 形式3（配列照合）: 参照アミノ酸の一致と 1 塩基置換候補に正解を含むか | missense | 300 | 0 | 0 | 100.00% |
| 形式4: 遺伝子名:c. → 候補に正解位置を含むか | cds:substitution | 2998 | 0 | 2 | 100.00% |
| 形式4: 遺伝子名:c. → 候補に正解位置を含むか | intron:substitution | 1499 | 1 | 0 | 99.93% |
| 形式4: 遺伝子名:c. → 候補に正解位置を含むか | utr3:substitution | 500 | 0 | 0 | 100.00% |
| 形式4: 遺伝子名:c. → 候補に正解位置を含むか | utr5:substitution | 495 | 0 | 5 | 100.00% |
| **合計** | | **22894** | **6** | | **99.97%** |

欠失・重複・挿入・欠失挿入のうち 1630 件は、ClinVar の Start/Stop と範囲が一致しませんでした。ClinVar の座標は VCF 方式（左寄せ・前後の塩基を含む）で、HGVS の c. 表記は 3' 側寄せのため、反復配列では表記上の位置がずれます。そこで、hg38 の参照配列に両方の変異を適用し、変異後の配列が完全に同一になることを確認したものを「一致」としました。

「対象外」は、正解との比較が成り立たないケースです（ClinVar の NM_ バージョンが UCSC のデータにない、遺伝子名で入力すると現行版の転写産物で計算するため ClinVar の旧版と 5'UTR の長さが違う、など）。

## 対象外の理由

- 形式4: 遺伝子名:c. → 候補に正解位置を含むか（cds:substitution）: 遺伝子名が RefSeq データに無い（ClinVar の遺伝子名が複数遺伝子など） — 2 件
- 形式4: 遺伝子名:c. → 候補に正解位置を含むか（utr5:substitution）: ClinVar の NM_ と現行版のバージョンが異なり、位置がずれる — 4 件
- 形式4: 遺伝子名:c. → 候補に正解位置を含むか（utr5:substitution）: ClinVar の NM_ が遺伝子の現行転写産物に含まれない — 1 件

## 不一致の原因分析

### SHANK3（NM_001372044.2）

NM_001372044.2 は c.1528〜c.1566 の 39 塩基が hg38 ゲノムに存在しません（GRCh38 の SHANK3 領域の既知の配列欠損）。
NCBI から取得した NM_001372044.2 の配列（CDS 371..5791）と hg38 を直接比べると、chr22:50698690 から始まる配列は転写産物の c.1724 と完全に一致し、ClinVar が使う c.1689 とは一致しません。
したがって、この転写産物での不一致は ClinVar 側の番号のずれ（ゲノムの欠損に引きずられた番号付け）で、本ツールの計算は転写産物の配列どおりです。
本ツールはこの転写産物に対して「hg38 ゲノム配列と完全には一致しません」という警告を表示します。

## 不一致の一覧

### 形式1（逆変換）: hg38 位置 → c. 表記（intron:substitution） — 1 件

- chr22:50698689 → 本ツール c.1724-1, ClinVar c.1689-1（NM_001372044.2）

### 形式2: NM_:c. → hg38 位置（any:deletion） — 1 件

- NM_001372044.2:c.1530-9_1530-6del — NM_001372044.2 の転写産物位置 1900 はゲノムにアライメントされていません（転写産物配列とゲノム配列の差異領域）（ClinVar chr22:50697548-50697551）

### 形式2: NM_:c. → hg38 位置（any:insertion） — 2 件

- NM_001372044.2:c.2540+50_2540+51insTATGGCTGGGCTGTGGGGCTGCATGGGGTGGGGAGGAACGGGGCTGGGG — 本ツール chr22:50715768-50715769, ClinVar chr22:50715763-50715764（VCF 50715763 C>CGCTGTGGGGCTGCATGGGGTGGGGAGGAACGGGGCTGGGGTATGGCTGG）
- NM_001372044.2:c.2220-196_2220-195insCCCAC — 本ツール chr22:50704866-50704867, ClinVar chr22:50705875-50705876（VCF 50705875 C>CCCCCA）

### 形式2: NM_:c. → hg38 位置（intron:substitution） — 1 件

- NM_001372044.2:c.1689-1G>A — 本ツール chr22:50697680+, ClinVar chr22:50698689 G>A

### 形式4: 遺伝子名:c. → 候補に正解位置を含むか（intron:substitution） — 1 件

- SHANK3:c.1689-1G>A — 正解 chr22:50698689 が候補に無い
