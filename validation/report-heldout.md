# ClinVar を正解とした検証レポート

- 実行日時: 2026-10-13T15:47:40.098Z
- 正解データ: https://ftp.ncbi.nlm.nih.gov/pub/clinvar/tab_delimited/variant_summary.txt.gz (Last-Modified: Mon, 12 Oct 2026 22:21:13 GMT; seed 777, excluding 3919 genes from clinvar-sample.tsv)
- サンプル: 9,000 件（`validation/clinvar-sample-heldout.tsv`、種類別に層化抽出）
- 所要時間: 113 秒

| 検証項目 | 区分 | 一致 | 不一致 | 対象外 | 一致率 |
| --- | --- | ---: | ---: | ---: | ---: |
| 画面と同じ処理（convertOne）: 位置・リファレンス照合 | — | 300 | 0 | 0 | 100.00% |
| 形式1（逆変換）: hg38 位置 → c. 表記 | cds:substitution | 2998 | 1 | 0 | 99.97% |
| 形式1（逆変換）: hg38 位置 → c. 表記 | intron:substitution | 1497 | 2 | 0 | 99.87% |
| 形式1（逆変換）: hg38 位置 → c. 表記 | utr3:substitution | 497 | 0 | 0 | 100.00% |
| 形式1（逆変換）: hg38 位置 → c. 表記 | utr5:substitution | 500 | 0 | 0 | 100.00% |
| 形式2: NM_:c. → hg38 位置 | any:deletion | 1499 | 0 | 1 | 100.00% |
| 形式2: NM_:c. → hg38 位置 | any:delins | 499 | 1 | 0 | 99.80% |
| 形式2: NM_:c. → hg38 位置 | any:duplication | 999 | 0 | 1 | 100.00% |
| 形式2: NM_:c. → hg38 位置 | any:insertion | 496 | 3 | 1 | 99.40% |
| 形式2: NM_:c. → hg38 位置 | cds:substitution | 2998 | 1 | 1 | 99.97% |
| 形式2: NM_:c. → hg38 位置 | intron:substitution | 1497 | 2 | 1 | 99.87% |
| 形式2: NM_:c. → hg38 位置 | utr3:substitution | 497 | 0 | 3 | 100.00% |
| 形式2: NM_:c. → hg38 位置 | utr5:substitution | 500 | 0 | 0 | 100.00% |
| 形式3: NP_:p. → コドン範囲に正解位置を含むか | missense | 2649 | 0 | 0 | 100.00% |
| 形式3（配列照合）: 参照アミノ酸の一致と 1 塩基置換候補に正解を含むか | missense | 300 | 0 | 0 | 100.00% |
| 形式4: 遺伝子名:c. → 候補に正解位置を含むか | cds:substitution | 2995 | 0 | 5 | 100.00% |
| 形式4: 遺伝子名:c. → 候補に正解位置を含むか | intron:substitution | 1496 | 2 | 2 | 99.87% |
| 形式4: 遺伝子名:c. → 候補に正解位置を含むか | utr3:substitution | 497 | 0 | 3 | 100.00% |
| 形式4: 遺伝子名:c. → 候補に正解位置を含むか | utr5:substitution | 500 | 0 | 0 | 100.00% |
| **合計** | | **23214** | **12** | | **99.95%** |

欠失・重複・挿入・欠失挿入のうち 1678 件は、ClinVar の Start/Stop と範囲が一致しませんでした。ClinVar の座標は VCF 方式（左寄せ・前後の塩基を含む）で、HGVS の c. 表記は 3' 側寄せのため、反復配列では表記上の位置がずれます。そこで、hg38 の参照配列に両方の変異を適用し、変異後の配列が完全に同一になることを確認したものを「一致」としました。

「対象外」は、正解との比較が成り立たないケースです（ClinVar の NM_ バージョンが UCSC のデータにない、遺伝子名で入力すると現行版の転写産物で計算するため ClinVar の旧版と 5'UTR の長さが違う、など）。

## 対象外の理由

- 形式2: NM_:c. → hg38 位置（any:deletion）: このバージョンの NM_ が UCSC hg38 アライメントに存在しない — 1 件
- 形式2: NM_:c. → hg38 位置（any:duplication）: このバージョンの NM_ が UCSC hg38 アライメントに存在しない — 1 件
- 形式2: NM_:c. → hg38 位置（any:insertion）: このバージョンの NM_ が UCSC hg38 アライメントに存在しない — 1 件
- 形式2: NM_:c. → hg38 位置（cds:substitution）: このバージョンの NM_ が UCSC hg38 アライメントに存在しない — 1 件
- 形式2: NM_:c. → hg38 位置（intron:substitution）: このバージョンの NM_ が UCSC hg38 アライメントに存在しない — 1 件
- 形式2: NM_:c. → hg38 位置（utr3:substitution）: NM_ のアライメントが別の染色体のみ — 3 件
- 形式4: 遺伝子名:c. → 候補に正解位置を含むか（cds:substitution）: 遺伝子名が RefSeq データに無い（ClinVar の遺伝子名が複数遺伝子など） — 4 件
- 形式4: 遺伝子名:c. → 候補に正解位置を含むか（cds:substitution）: ClinVar の NM_ と現行版のバージョンが異なり、位置がずれる — 1 件
- 形式4: 遺伝子名:c. → 候補に正解位置を含むか（intron:substitution）: 遺伝子名が RefSeq データに無い（ClinVar の遺伝子名が複数遺伝子など） — 2 件
- 形式4: 遺伝子名:c. → 候補に正解位置を含むか（utr3:substitution）: ClinVar の NM_ が遺伝子の現行転写産物に含まれない — 3 件

## 不一致の一覧

### 形式1（逆変換）: hg38 位置 → c. 表記（cds:substitution） — 1 件

- chrX:49581667 → 本ツール undefined, ClinVar c.96（NM_001098411.3）

### 形式1（逆変換）: hg38 位置 → c. 表記（intron:substitution） — 2 件

- chr20:37129327 → 本ツール c.1680-160, ClinVar c.1651-160（NM_152503.8）
- chr17:32480636 → 本ツール c.1269+5, ClinVar c.*1269+5（NM_002815.4）

### 形式2: NM_:c. → hg38 位置（any:delins） — 1 件

- NM_003923.2:c.2041_2044delinsGAAG — c.2041 はコード領域（c.1〜c.1098）を超えています。3'UTR は c.*N で指定してください（ClinVar chr8:144473293-144473295）

### 形式2: NM_:c. → hg38 位置（any:insertion） — 3 件

- NM_001291281.3:c.1159_1160insCCCGCCCTGGGGCGCTGCCCGCGCTGCTGCCGCCGCCGCCGCCCGCGCCGGGACGCCCGCCTACTTCGGCGGCTGCAAGGGCGGCGCCTACGGCGGGGGCGGGGGCTTCGGGCCGCCGGCGATGGGCGCTCTGCGCCGTCTGCCCATGCAGACCATCCAGGAGAACAAGCAGGCCAGCTTCGTGCCGGCCGCGGCGCCCT — NM_001291281.3 の転写産物位置 1656 はゲノムにアライメントされていません（転写産物配列とゲノム配列の差異領域）（ClinVar chr1:41382200-41382201）
- NM_001012511.3:c.-32_-31insCCAGAGCCAG — 本ツール chr17:46923161-46923162, ClinVar chr17:46923155-46923156（VCF 46923155 A>AAGCCAG）
- NM_032790.3:c.309-306_309-305insAGAAAAGAAAA — 本ツール chr12:121640740-121640741, ClinVar chr12:121640731-121640732（VCF 121640731 A>AAAAAAGAAAAG）

### 形式2: NM_:c. → hg38 位置（cds:substitution） — 1 件

- NM_001098411.3:c.96T>G — 本ツール chrX:49333301+, ClinVar chrX:49581667 T>G

### 形式2: NM_:c. → hg38 位置（intron:substitution） — 2 件

- NM_152503.8:c.1651-160G>T — 本ツール chr20:37137998-, ClinVar chr20:37129327 C>A
- NM_002815.4:c.*1269+5G>T — 本ツール chr17:32482026+, ClinVar chr17:32480636 G>T

### 形式4: 遺伝子名:c. → 候補に正解位置を含むか（intron:substitution） — 2 件

- MROH8:c.1651-160G>T — 正解 chr20:37129327 が候補に無い
- PSMD11:c.*1269+5G>T — 正解 chr17:32480636 が候補に無い
