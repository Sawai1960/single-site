# ClinVar を正解とした検証レポート

- 実行日時: 2026-10-13T15:58:51.063Z
- 正解データ: https://ftp.ncbi.nlm.nih.gov/pub/clinvar/tab_delimited/variant_summary.txt.gz (Last-Modified: Mon, 12 Oct 2026 22:21:13 GMT; seed 4242, historical NM_ versions only)
- サンプル: 4,827 件（`validation/clinvar-sample-historical.tsv`、種類別に層化抽出）
- 所要時間: 53 秒

| 検証項目 | 区分 | 一致 | 不一致 | 対象外 | 一致率 |
| --- | --- | ---: | ---: | ---: | ---: |
| 画面と同じ処理（convertOne）: 位置・リファレンス照合 | — | 232 | 5 | 0 | 97.89% |
| 形式1（逆変換）: hg38 位置 → c. 表記 | cds:substitution | 1895 | 81 | 0 | 95.90% |
| 形式1（逆変換）: hg38 位置 → c. 表記 | intron:substitution | 69 | 0 | 0 | 100.00% |
| 形式1（逆変換）: hg38 位置 → c. 表記 | utr3:substitution | 488 | 1 | 0 | 99.80% |
| 形式1（逆変換）: hg38 位置 → c. 表記 | utr5:substitution | 497 | 0 | 0 | 100.00% |
| 形式2: NM_:c. → hg38 位置 | any:deletion | 496 | 5 | 16 | 99.00% |
| 形式2: NM_:c. → hg38 位置 | any:delins | 24 | 1 | 2 | 96.00% |
| 形式2: NM_:c. → hg38 位置 | any:duplication | 170 | 0 | 14 | 100.00% |
| 形式2: NM_:c. → hg38 位置 | any:insertion | 51 | 1 | 3 | 98.08% |
| 形式2: NM_:c. → hg38 位置 | cds:substitution | 1892 | 84 | 968 | 95.75% |
| 形式2: NM_:c. → hg38 位置 | intron:substitution | 69 | 0 | 31 | 100.00% |
| 形式2: NM_:c. → hg38 位置 | utr3:substitution | 488 | 1 | 11 | 99.80% |
| 形式2: NM_:c. → hg38 位置 | utr5:substitution | 497 | 2 | 1 | 99.60% |
| 形式2（旧版がデータに無く、別バージョンで代替計算） | any:deletion | 12 | 3 | 1 | 80.00% |
| 形式2（旧版がデータに無く、別バージョンで代替計算） | any:delins | 2 | 0 | 0 | 100.00% |
| 形式2（旧版がデータに無く、別バージョンで代替計算） | any:duplication | 12 | 2 | 0 | 85.71% |
| 形式2（旧版がデータに無く、別バージョンで代替計算） | any:insertion | 2 | 1 | 0 | 66.67% |
| 形式2（旧版がデータに無く、別バージョンで代替計算） | cds:substitution | 473 | 182 | 313 | 72.21% |
| 形式2（旧版がデータに無く、別バージョンで代替計算） | intron:substitution | 6 | 2 | 23 | 75.00% |
| 形式2（旧版がデータに無く、別バージョンで代替計算） | utr3:substitution | 6 | 0 | 5 | 100.00% |
| 形式2（旧版がデータに無く、別バージョンで代替計算） | utr5:substitution | 1 | 0 | 0 | 100.00% |
| 形式3: NP_:p. → コドン範囲に正解位置を含むか | missense | 1083 | 0 | 0 | 100.00% |
| 形式3（配列照合）: 参照アミノ酸の一致と 1 塩基置換候補に正解を含むか | missense | 298 | 2 | 0 | 99.33% |
| 形式4: 遺伝子名:c. → 候補に正解位置を含むか | cds:substitution | 588 | 0 | 2356 | 100.00% |
| 形式4: 遺伝子名:c. → 候補に正解位置を含むか | intron:substitution | 19 | 0 | 81 | 100.00% |
| 形式4: 遺伝子名:c. → 候補に正解位置を含むか | utr3:substitution | 487 | 0 | 13 | 100.00% |
| 形式4: 遺伝子名:c. → 候補に正解位置を含むか | utr5:substitution | 453 | 0 | 47 | 100.00% |
| **合計** | | **9796** | **183** | | **98.17%** |

欠失・重複・挿入・欠失挿入のうち 465 件は、ClinVar の Start/Stop と範囲が一致しませんでした。ClinVar の座標は VCF 方式（左寄せ・前後の塩基を含む）で、HGVS の c. 表記は 3' 側寄せのため、反復配列では表記上の位置がずれます。そこで、hg38 の参照配列に両方の変異を適用し、変異後の配列が完全に同一になることを確認したものを「一致」としました。

「対象外」は、正解との比較が成り立たないケースです（ClinVar の NM_ バージョンが UCSC のデータにない、遺伝子名で入力すると現行版の転写産物で計算するため ClinVar の旧版と 5'UTR の長さが違う、など）。

「形式2（旧版がデータに無く、別バージョンで代替計算）」は、入力された旧バージョンの NM_ が UCSC のデータに無いため、本ツールが同じ番号の別バージョンで計算した場合に、ClinVar の正解位置と一致した割合です。バージョン間で 5'UTR やエクソン構造が変わると位置がずれるのは仕様上避けられない（本ツールは代替時に警告を出す）ため、合計には含めていません。

## 対象外の理由

- 形式2: NM_:c. → hg38 位置（any:deletion）: このバージョンの NM_ が UCSC hg38 アライメントに存在しない — 16 件
- 形式2: NM_:c. → hg38 位置（any:delins）: このバージョンの NM_ が UCSC hg38 アライメントに存在しない — 2 件
- 形式2: NM_:c. → hg38 位置（any:duplication）: このバージョンの NM_ が UCSC hg38 アライメントに存在しない — 14 件
- 形式2: NM_:c. → hg38 位置（any:insertion）: このバージョンの NM_ が UCSC hg38 アライメントに存在しない — 3 件
- 形式2: NM_:c. → hg38 位置（cds:substitution）: このバージョンの NM_ が UCSC hg38 アライメントに存在しない — 968 件
- 形式2: NM_:c. → hg38 位置（intron:substitution）: このバージョンの NM_ が UCSC hg38 アライメントに存在しない — 31 件
- 形式2: NM_:c. → hg38 位置（utr3:substitution）: このバージョンの NM_ が UCSC hg38 アライメントに存在しない — 11 件
- 形式2: NM_:c. → hg38 位置（utr5:substitution）: このバージョンの NM_ が UCSC hg38 アライメントに存在しない — 1 件
- 形式2（旧版がデータに無く、別バージョンで代替計算）（any:deletion）: どのバージョンの NM_ もデータに無い — 1 件
- 形式2（旧版がデータに無く、別バージョンで代替計算）（cds:substitution）: どのバージョンの NM_ もデータに無い — 313 件
- 形式2（旧版がデータに無く、別バージョンで代替計算）（intron:substitution）: どのバージョンの NM_ もデータに無い — 23 件
- 形式2（旧版がデータに無く、別バージョンで代替計算）（utr3:substitution）: どのバージョンの NM_ もデータに無い — 5 件
- 形式4: 遺伝子名:c. → 候補に正解位置を含むか（cds:substitution）: 遺伝子名が RefSeq データに無い（ClinVar の遺伝子名が複数遺伝子など） — 1447 件
- 形式4: 遺伝子名:c. → 候補に正解位置を含むか（cds:substitution）: ClinVar の NM_ と現行版のバージョンが異なり、位置がずれる — 712 件
- 形式4: 遺伝子名:c. → 候補に正解位置を含むか（cds:substitution）: ClinVar の NM_ が遺伝子の現行転写産物に含まれない — 197 件
- 形式4: 遺伝子名:c. → 候補に正解位置を含むか（intron:substitution）: ClinVar の NM_ と現行版のバージョンが異なり、位置がずれる — 3 件
- 形式4: 遺伝子名:c. → 候補に正解位置を含むか（intron:substitution）: ClinVar の NM_ が遺伝子の現行転写産物に含まれない — 3 件
- 形式4: 遺伝子名:c. → 候補に正解位置を含むか（intron:substitution）: 遺伝子名が RefSeq データに無い（ClinVar の遺伝子名が複数遺伝子など） — 75 件
- 形式4: 遺伝子名:c. → 候補に正解位置を含むか（utr3:substitution）: 遺伝子名が RefSeq データに無い（ClinVar の遺伝子名が複数遺伝子など） — 11 件
- 形式4: 遺伝子名:c. → 候補に正解位置を含むか（utr3:substitution）: ClinVar の NM_ と現行版のバージョンが異なり、位置がずれる — 1 件
- 形式4: 遺伝子名:c. → 候補に正解位置を含むか（utr3:substitution）: ClinVar の NM_ が遺伝子の現行転写産物に含まれない — 1 件
- 形式4: 遺伝子名:c. → 候補に正解位置を含むか（utr5:substitution）: ClinVar の NM_ と現行版のバージョンが異なり、位置がずれる — 47 件

## 不一致の一覧

### 画面と同じ処理（convertOne）: 位置・リファレンス照合（） — 5 件

- NM_000854.3:c.331G>A — chr22:23982758-23982758, 照合 {"expected":"G","observed":"G","ok":true,"label":"リファレンス塩基（転写産物の向き）"}
- NM_001098411.3:c.185G>A — chrX:49333390-49333390, 照合 {"expected":"G","observed":"G","ok":true,"label":"リファレンス塩基（転写産物の向き）"}
- NM_001098407.1:c.224G>C — chrX:49565516-49565516, 照合 {"expected":"G","observed":"G","ok":true,"label":"リファレンス塩基（転写産物の向き）"}
- NM_001127200.1:c.158C>T — chrX:49562622-49562622, 照合 {"expected":"C","observed":"C","ok":true,"label":"リファレンス塩基（転写産物の向き）"}
- NM_000106.5:c.*264G>A — chr22:42126310-42126310, 照合 {"expected":"G","observed":"G","ok":true,"label":"リファレンス塩基（転写産物の向き）"}

### 形式1（逆変換）: hg38 位置 → c. 表記（cds:substitution） — 81 件

- chr5:150056112 → 本ツール c.2468, ClinVar c.2467（NM_005211.3）
- chr14:75103855 → 本ツール c.1718, ClinVar c.1817（NM_033116.4）
- chr22:23958564 → 本ツール c.-21634, ClinVar c.338（NM_000854.3）
- chrX:49584634 → 本ツール undefined, ClinVar c.241（NM_001472.2）
- chrX:49584627 → 本ツール undefined, ClinVar c.234（NM_001472.2）
- chrX:49336249 → 本ツール undefined, ClinVar c.205（NM_001098407.1）
- chrX:49581122 → 本ツール undefined, ClinVar c.19（NM_001472.2）
- chrX:49581687 → 本ツール undefined, ClinVar c.116（NM_001472.2）
- chrX:49581125 → 本ツール undefined, ClinVar c.22（NM_001472.2）
- chrX:49584613 → 本ツール undefined, ClinVar c.220（NM_001472.2）
- chrX:49553056 → 本ツール c.-7902, ClinVar c.145（NM_001127200.1）
- chrX:49336330 → 本ツール undefined, ClinVar c.286（NM_001098407.1）
- chrX:49581135 → 本ツール undefined, ClinVar c.29（NM_001472.2）
- chrX:49581138 → 本ツール undefined, ClinVar c.32（NM_001472.2）
- chrX:49581155 → 本ツール undefined, ClinVar c.49（NM_001472.2）
- chrX:49581122 → 本ツール undefined, ClinVar c.19（NM_001472.2）
- chrX:49333383 → 本ツール undefined, ClinVar c.178（NM_001127200.1）
- chrX:49581147 → 本ツール undefined, ClinVar c.41（NM_001472.2）
- chrX:49581762 → 本ツール undefined, ClinVar c.191（NM_001098411.3）
- chrX:49581149 → 本ツール undefined, ClinVar c.43（NM_001098411.3）
- chrX:49581667 → 本ツール undefined, ClinVar c.96（NM_001098411.3）
- chrX:49584599 → 本ツール undefined, ClinVar c.206（NM_001472.2）
- chrX:49584614 → 本ツール undefined, ClinVar c.221（NM_001472.2）
- chrX:49584625 → 本ツール undefined, ClinVar c.232（NM_001472.2）
- chrX:49581150 → 本ツール undefined, ClinVar c.44（NM_001472.2）
- chrX:49333324 → 本ツール undefined, ClinVar c.119（NM_001127200.1）
- chrX:49333393 → 本ツール undefined, ClinVar c.188（NM_001127200.1）
- chrX:49332765 → 本ツール undefined, ClinVar c.25（NM_001127200.1）
- chr22:23960309 → 本ツール c.-19889, ClinVar c.185（NM_000854.3）
- chr22:23958621 → 本ツール c.-21577, ClinVar c.281（NM_000854.3）
- chr22:23958576 → 本ツール c.-21622, ClinVar c.326（NM_000854.3）
- chr22:23958571 → 本ツール c.-21627, ClinVar c.331（NM_000854.3）
- chr22:23958583 → 本ツール c.-21615, ClinVar c.319（NM_000854.3）
- chrX:49581123 → 本ツール undefined, ClinVar c.20（NM_001098411.3）
- chrX:49581716 → 本ツール undefined, ClinVar c.145（NM_001472.2）
- chrX:49581156 → 本ツール undefined, ClinVar c.50（NM_001472.2）
- chrX:49552495 → 本ツール c.-8463, ClinVar c.49（NM_001098407.1）
- chrX:49332772 → 本ツール undefined, ClinVar c.32（NM_001127200.1）
- chrX:49581756 → 本ツール undefined, ClinVar c.185（NM_001098411.3）
- chrX:49584599 → 本ツール undefined, ClinVar c.206（NM_001472.2）
- chrX:49581179 → 本ツール undefined, ClinVar c.73（NM_001472.2）
- chrX:49581749 → 本ツール undefined, ClinVar c.178（NM_001472.2）
- chrX:49552452 → 本ツール c.-8506, ClinVar c.9（NM_001098407.1）
- chrX:49552515 → 本ツール c.-8443, ClinVar c.69（NM_001098407.1）
- chrX:49333297 → 本ツール undefined, ClinVar c.92（NM_001127200.1）
- chr22:23960366 → 本ツール c.-19832, ClinVar c.128（NM_000854.3）
- chrX:49581137 → 本ツール undefined, ClinVar c.31（NM_001098411.3）
- chrX:49581695 → 本ツール undefined, ClinVar c.124（NM_001098411.3）
- chrX:49581132 → 本ツール undefined, ClinVar c.26（NM_001472.2）
- chrX:49581137 → 本ツール undefined, ClinVar c.31（NM_001472.2）
- chrX:49581131 → 本ツール undefined, ClinVar c.25（NM_001472.2）
- chrX:49332777 → 本ツール undefined, ClinVar c.37（NM_001127200.1）
- chrX:49333388 → 本ツール undefined, ClinVar c.183（NM_001127200.1）
- chrX:49581144 → 本ツール undefined, ClinVar c.38（NM_001098411.3）
- chrX:49581725 → 本ツール undefined, ClinVar c.154（NM_001098411.3）
- chrX:49584635 → 本ツール undefined, ClinVar c.242（NM_001472.2）
- chrX:49581165 → 本ツール undefined, ClinVar c.59（NM_001472.2）
- chrX:49584641 → 本ツール undefined, ClinVar c.248（NM_001472.2）
- chrX:49584698 → 本ツール undefined, ClinVar c.305（NM_001472.2）
- chrX:49581744 → 本ツール undefined, ClinVar c.173（NM_001472.2）
- chrX:49555969 → 本ツール c.-4989, ClinVar c.236（NM_001098407.1）
- chrX:49332783 → 本ツール undefined, ClinVar c.43（NM_001127200.1）
- chrX:49333314 → 本ツール undefined, ClinVar c.109（NM_001127200.1）
- chrX:49333347 → 本ツール undefined, ClinVar c.142（NM_001127200.1）
- chrX:49581722 → 本ツール undefined, ClinVar c.151（NM_001098411.3）
- chrX:49584713 → 本ツール undefined, ClinVar c.320（NM_001472.2）
- chrX:49581740 → 本ツール undefined, ClinVar c.169（NM_001472.2）
- chrX:49581150 → 本ツール undefined, ClinVar c.44（NM_001472.2）
- chrX:49555953 → 本ツール c.-5005, ClinVar c.220（NM_001098407.1）
- chrX:49555954 → 本ツール c.-5004, ClinVar c.221（NM_001098407.1）
- chrX:49552505 → 本ツール c.-8453, ClinVar c.59（NM_001098407.1）
- chrX:49555957 → 本ツール c.-5001, ClinVar c.224（NM_001098407.1）
- chrX:49581170 → 本ツール undefined, ClinVar c.64（NM_001472.2）
- chrX:49581158 → 本ツール undefined, ClinVar c.52（NM_001472.2）
- chrX:49581117 → 本ツール undefined, ClinVar c.14（NM_001472.2）
- chrX:49581680 → 本ツール undefined, ClinVar c.109（NM_001472.2）
- chrX:49552504 → 本ツール c.-8454, ClinVar c.58（NM_001098407.1）
- chrX:49333363 → 本ツール undefined, ClinVar c.158（NM_001127200.1）
- chrX:49555951 → 本ツール c.-5007, ClinVar c.218（NM_001098407.1）
- chrX:49332769 → 本ツール undefined, ClinVar c.29（NM_001127200.1）
- chrX:49581146 → 本ツール undefined, ClinVar c.40（NM_001472.2）

### 形式1（逆変換）: hg38 位置 → c. 表記（utr3:substitution） — 1 件

- chr22:42129033 → 本ツール c.505, ClinVar c.*264（NM_000106.5）

### 形式2: NM_:c. → hg38 位置（any:deletion） — 5 件

- NM_020469.2:c.261delG — NM_020469.2 の転写産物位置 286 はゲノムにアライメントされていません（転写産物配列とゲノム配列の差異領域）（ClinVar chr9:83615-83615）
- NM_007248.3:c.1033_1050del — c.1033 はコード領域（c.1〜c.915）を超えています。3'UTR は c.*N で指定してください（ClinVar chr3:48467718-48467735）
- NM_000140.3:c.1078_1137del — 本ツール chr18:57551315-57551374, ClinVar chr18:57551317-57551317（VCF 57551317 T>A）
- NM_020919.3:c.1472_1481delTTTCCCCCAG — 本ツール chr2:201754662-201754671, ClinVar chr2:201754672-201754672（VCF 201754672 C>A）
- NM_003126.2:c.5190_5310del — 本ツール chr1:158636641-158636761, ClinVar chr1:158636763-158636763（VCF 158636763 T>C）

### 形式2: NM_:c. → hg38 位置（any:delins） — 1 件

- NM_003923.2:c.2041_2044delinsGAAG — c.2041 はコード領域（c.1〜c.1098）を超えています。3'UTR は c.*N で指定してください（ClinVar chr8:144473293-144473295）

### 形式2: NM_:c. → hg38 位置（any:insertion） — 1 件

- NM_032790.3:c.309-306_309-305insAGAAAAGAAAA — 本ツール chr12:121640740-121640741, ClinVar chr12:121640731-121640732（VCF 121640731 A>AAAAAAGAAAAG）

### 形式2: NM_:c. → hg38 位置（cds:substitution） — 84 件

- NM_000521.3:c.185C>T — 本ツール chr5:74685445+, ClinVar chr5:74685445 T>T（鎖の向きの不一致）
- NM_198578.3:c.149A>G — 本ツール chr12:40225280+, ClinVar chr12:40225280 G>G（鎖の向きの不一致）
- NM_005211.3:c.2467C>T — 本ツール chr5:150056113-, ClinVar chr5:150056112 G>A
- NM_033116.4:c.1817T>C — 本ツール chr14:75101680-, ClinVar chr14:75103855 A>G
- NM_000854.3:c.338C>T — 本ツール chr22:23982765+, ClinVar chr22:23958564 G>A（鎖の向きの不一致）
- NM_001472.2:c.241C>T — 本ツール chrX:49336285+, ClinVar chrX:49584634 C>T
- NM_001472.2:c.234G>T — 本ツール chrX:49336278+, ClinVar chrX:49584627 G>T
- NM_001098407.1:c.205C>T — 本ツール chrX:49565497+, ClinVar chrX:49336249 C>T
- NM_001472.2:c.19T>G — 本ツール chrX:49332756+, ClinVar chrX:49581122 T>G
- NM_001472.2:c.116C>T — 本ツール chrX:49333321+, ClinVar chrX:49581687 C>T
- NM_001472.2:c.22A>T — 本ツール chrX:49332759+, ClinVar chrX:49581125 A>T
- NM_001472.2:c.220C>G — 本ツール chrX:49336264+, ClinVar chrX:49584613 C>G
- NM_001127200.1:c.145C>A — 本ツール chrX:49562609+, ClinVar chrX:49553056 T>A（鎖の向きの不一致）
- NM_001098407.1:c.286A>G — 本ツール chrX:49565578+, ClinVar chrX:49336330 A>G
- NM_001472.2:c.29G>A — 本ツール chrX:49332769+, ClinVar chrX:49581135 G>A
- NM_001472.2:c.32C>G — 本ツール chrX:49332772+, ClinVar chrX:49581138 C>G
- NM_001472.2:c.49G>T — 本ツール chrX:49332789+, ClinVar chrX:49581155 G>T
- NM_001472.2:c.19T>C — 本ツール chrX:49332756+, ClinVar chrX:49581122 T>C
- NM_001127200.1:c.178G>A — 本ツール chrX:49562642+, ClinVar chrX:49333383 G>A
- NM_001472.2:c.41G>C — 本ツール chrX:49332781+, ClinVar chrX:49581147 G>C
- NM_001098411.3:c.191C>G — 本ツール chrX:49333396+, ClinVar chrX:49581762 C>G
- NM_001098411.3:c.43C>T — 本ツール chrX:49332783+, ClinVar chrX:49581149 C>T
- NM_001098411.3:c.96T>G — 本ツール chrX:49333301+, ClinVar chrX:49581667 T>G
- NM_001472.2:c.206C>G — 本ツール chrX:49336250+, ClinVar chrX:49584599 C>G
- NM_001472.2:c.221A>G — 本ツール chrX:49336265+, ClinVar chrX:49584614 A>G
- NM_001472.2:c.232C>G — 本ツール chrX:49336276+, ClinVar chrX:49584625 C>G
- NM_001472.2:c.44G>A — 本ツール chrX:49332784+, ClinVar chrX:49581150 G>A
- NM_001127200.1:c.119C>T — 本ツール chrX:49562583+, ClinVar chrX:49333324 C>T
- NM_001127200.1:c.188C>G — 本ツール chrX:49562652+, ClinVar chrX:49333393 C>G
- NM_001127200.1:c.25T>C — 本ツール chrX:49562024+, ClinVar chrX:49332765 T>C
- NM_000854.3:c.185T>C — 本ツール chr22:23981020+, ClinVar chr22:23960309 A>G（鎖の向きの不一致）
- NM_000854.3:c.281G>A — 本ツール chr22:23982708+, ClinVar chr22:23958621 C>T（鎖の向きの不一致）
- NM_000854.3:c.326C>T — 本ツール chr22:23982753+, ClinVar chr22:23958576 G>A（鎖の向きの不一致）
- NM_000854.3:c.331G>A — 本ツール chr22:23982758+, ClinVar chr22:23958571 C>T（鎖の向きの不一致）
- NM_000854.3:c.319C>T — 本ツール chr22:23982746+, ClinVar chr22:23958583 G>A（鎖の向きの不一致）
- NM_001098411.3:c.20C>T — 本ツール chrX:49332757+, ClinVar chrX:49581123 C>T
- NM_001472.2:c.145C>T — 本ツール chrX:49333350+, ClinVar chrX:49581716 T>T（鎖の向きの不一致）
- NM_001472.2:c.50T>A — 本ツール chrX:49332790+, ClinVar chrX:49581156 T>A
- NM_001098407.1:c.49G>A — 本ツール chrX:49562048+, ClinVar chrX:49552495 G>A
- NM_001127200.1:c.32C>G — 本ツール chrX:49562031+, ClinVar chrX:49332772 C>G
- NM_001098411.3:c.185G>A — 本ツール chrX:49333390+, ClinVar chrX:49581756 G>A
- NM_001472.2:c.206C>T — 本ツール chrX:49336250+, ClinVar chrX:49584599 C>T
- NM_001472.2:c.73C>A — 本ツール chrX:49332813+, ClinVar chrX:49581179 C>A
- NM_001472.2:c.178G>T — 本ツール chrX:49333383+, ClinVar chrX:49581749 G>T
- NM_001098407.1:c.9G>T — 本ツール chrX:49562005+, ClinVar chrX:49552452 G>T
- NM_001098407.1:c.69T>G — 本ツール chrX:49562068+, ClinVar chrX:49552515 T>G
- NM_001127200.1:c.92T>C — 本ツール chrX:49562556+, ClinVar chrX:49333297 T>C
- NM_000854.3:c.128A>G — 本ツール chr22:23980963+, ClinVar chr22:23960366 T>C（鎖の向きの不一致）
- NM_001098411.3:c.31C>T — 本ツール chrX:49332771+, ClinVar chrX:49581137 C>T
- NM_001098411.3:c.124G>A — 本ツール chrX:49333329+, ClinVar chrX:49581695 G>A
- NM_001472.2:c.26A>G — 本ツール chrX:49332766+, ClinVar chrX:49581132 A>G
- NM_001472.2:c.31C>A — 本ツール chrX:49332771+, ClinVar chrX:49581137 C>A
- NM_001472.2:c.25T>A — 本ツール chrX:49332765+, ClinVar chrX:49581131 T>A
- NM_001127200.1:c.37C>T — 本ツール chrX:49562036+, ClinVar chrX:49332777 C>T
- NM_001127200.1:c.183G>C — 本ツール chrX:49562647+, ClinVar chrX:49333388 G>C
- NM_001098411.3:c.38C>G — 本ツール chrX:49332778+, ClinVar chrX:49581144 C>G
- NM_001098411.3:c.154C>T — 本ツール chrX:49333359+, ClinVar chrX:49581725 C>T
- NM_001472.2:c.242C>A — 本ツール chrX:49336286+, ClinVar chrX:49584635 C>A
- NM_001472.2:c.59C>G — 本ツール chrX:49332799+, ClinVar chrX:49581165 C>G
- NM_001472.2:c.248C>G — 本ツール chrX:49336292+, ClinVar chrX:49584641 C>G
- NM_001472.2:c.305A>G — 本ツール chrX:49336349+, ClinVar chrX:49584698 A>G
- NM_001472.2:c.173G>A — 本ツール chrX:49333378+, ClinVar chrX:49581744 G>A
- NM_001098407.1:c.236G>T — 本ツール chrX:49565528+, ClinVar chrX:49555969 G>T
- NM_001127200.1:c.43C>T — 本ツール chrX:49562042+, ClinVar chrX:49332783 C>T
- NM_001127200.1:c.109C>G — 本ツール chrX:49562573+, ClinVar chrX:49333314 C>G
- NM_001127200.1:c.142C>G — 本ツール chrX:49562606+, ClinVar chrX:49333347 C>G
- NM_001098411.3:c.151G>A — 本ツール chrX:49333356+, ClinVar chrX:49581722 G>A
- NM_001472.2:c.320C>T — 本ツール chrX:49336364+, ClinVar chrX:49584713 C>T
- NM_001472.2:c.169G>A — 本ツール chrX:49333374+, ClinVar chrX:49581740 A>A（鎖の向きの不一致）
- NM_001472.2:c.44G>C — 本ツール chrX:49332784+, ClinVar chrX:49581150 G>C
- NM_001098407.1:c.220G>C — 本ツール chrX:49565512+, ClinVar chrX:49555953 C>C（鎖の向きの不一致）
- NM_001098407.1:c.221A>T — 本ツール chrX:49565513+, ClinVar chrX:49555954 A>T
- NM_001098407.1:c.59C>G — 本ツール chrX:49562058+, ClinVar chrX:49552505 C>G
- NM_001098407.1:c.224G>C — 本ツール chrX:49565516+, ClinVar chrX:49555957 G>C
- NM_207414.2:c.906C>A — 本ツール chr8:141479979-, ClinVar chr8:141479979 A>T（鎖の向きの不一致）
- NM_001472.2:c.64A>G — 本ツール chrX:49332804+, ClinVar chrX:49581170 A>G
- NM_001472.2:c.52G>C — 本ツール chrX:49332792+, ClinVar chrX:49581158 C>C（鎖の向きの不一致）
- NM_001472.2:c.14G>A — 本ツール chrX:49332751+, ClinVar chrX:49581117 G>A
- NM_001472.2:c.109C>G — 本ツール chrX:49333314+, ClinVar chrX:49581680 C>G
- NM_001098407.1:c.58C>G — 本ツール chrX:49562057+, ClinVar chrX:49552504 C>G
- NM_001127200.1:c.158C>T — 本ツール chrX:49562622+, ClinVar chrX:49333363 C>T
- NM_001098407.1:c.218C>T — 本ツール chrX:49565510+, ClinVar chrX:49555951 C>T
- NM_001127200.1:c.29G>T — 本ツール chrX:49562028+, ClinVar chrX:49332769 G>T
- NM_001472.2:c.40A>G — 本ツール chrX:49332780+, ClinVar chrX:49581146 A>G

### 形式2: NM_:c. → hg38 位置（utr3:substitution） — 1 件

- NM_000106.5:c.*264G>A — 本ツール chr22:42126310-, ClinVar chr22:42129033 C>T

### 形式2: NM_:c. → hg38 位置（utr5:substitution） — 2 件

- NM_004006.2:c.-72567T>C — c.-72567 は NM_004006.2（全長 13993 塩基）から離れすぎています（ClinVar chrX:33283879-33283879）
- NM_004006.2:c.-72562A>G — c.-72562 は NM_004006.2（全長 13993 塩基）から離れすぎています（ClinVar chrX:33283874-33283874）

### 形式2（旧版がデータに無く、別バージョンで代替計算）（any:deletion） — 3 件

- NM_032790.4:c.131_141delCACCGCCGCCG（NM_032790.3 で代替） — 本ツール chr12:121626873-121626888, ClinVar chr12:121626878-121626888（VCF 121626877 CCACCGCCGCCG>C）
- NM_032790.4:c.129_133del（NM_032790.3 で代替） — 本ツール chr12:121626871-121626880, ClinVar chr12:121626875-121626879（VCF 121626874 CCGCCA>C）
- NM_032790.1:c.620del（NM_032790.3 で代替） — 本ツール chr12:121641357-121641357, ClinVar chr12:121641545-121641545（VCF 121641544 GT>G）

### 形式2（旧版がデータに無く、別バージョンで代替計算）（any:duplication） — 2 件

- NM_032790.4:c.128_131dup（NM_032790.3 で代替） — 本ツール chr12:121626870-121626873, ClinVar chr12:121626872-121626873（VCF 121626872 C>CCCCG）
- NM_032790.1:c.493dup（NM_032790.3 で代替） — 本ツール chr12:121641230-121641230, ClinVar chr12:121641418-121641419（VCF 121641418 C>CG）

### 形式2（旧版がデータに無く、別バージョンで代替計算）（any:insertion） — 1 件

- NM_032790.4:c.126_127insA（NM_032790.3 で代替） — 本ツール chr12:121626868-121626869, ClinVar chr12:121626873-121626874（VCF 121626873 C>CA）

### 形式2（旧版がデータに無く、別バージョンで代替計算）（cds:substitution） — 182 件

- NM_052892.5:c.4853G>A（NM_052892.4 で代替） — 本ツール chr16:81148258-, ClinVar chr16:81148249 C>T
- NM_052892.5:c.1080C>A（NM_052892.4 で代替） — 本ツール chr16:81202563-, ClinVar chr16:81202554 G>T
- NM_052892.5:c.5993C>T（NM_052892.4 で代替） — 本ツール chr16:81130509-, ClinVar chr16:81130500 G>A
- NM_052892.5:c.2243G>T（NM_052892.4 で代替） — 本ツール chr16:81179662-, ClinVar chr16:81179653 C>A
- NM_052892.5:c.5017G>C（NM_052892.4 で代替） — 本ツール chr16:81147469-, ClinVar chr16:81147460 C>G
- NM_052892.5:c.2267C>G（NM_052892.4 で代替） — 本ツール chr16:81177977-, ClinVar chr16:81177968 G>C
- NM_052892.5:c.3596C>T（NM_052892.4 で代替） — 本ツール chr16:81160787-, ClinVar chr16:81160778 G>A
- NM_052892.5:c.2218T>C（NM_052892.4 で代替） — 本ツール chr16:81179687-, ClinVar chr16:81179678 A>G
- NM_052892.5:c.4601C>T（NM_052892.4 で代替） — 本ツール chr16:81149842-, ClinVar chr16:81149833 G>A
- NM_052892.5:c.5785G>A（NM_052892.4 で代替） — 本ツール chr16:81133635-, ClinVar chr16:81133626 C>T
- NM_052892.5:c.1247G>T（NM_052892.4 で代替） — 本ツール chr16:81198958-, ClinVar chr16:81198949 C>A
- NM_052892.5:c.1746C>A（NM_052892.4 で代替） — 本ツール chr16:81188924-, ClinVar chr16:81188915 G>T
- NM_052892.5:c.4698G>A（NM_052892.4 で代替） — 本ツール chr16:81149745-, ClinVar chr16:81149736 C>T
- NM_052892.5:c.5878C>A（NM_052892.4 で代替） — 本ツール chr16:81130624-, ClinVar chr16:81130615 G>T
- NM_052892.5:c.1435C>G（NM_052892.4 で代替） — 本ツール chr16:81198770-, ClinVar chr16:81198761 G>C
- NM_052892.5:c.1897C>T（NM_052892.4 で代替） — 本ツール chr16:81185592-, ClinVar chr16:81185583 G>A
- NM_052892.5:c.5689C>G（NM_052892.4 で代替） — 本ツール chr16:81137467-, ClinVar chr16:81137458 G>C
- NM_052892.5:c.5902C>T（NM_052892.4 で代替） — 本ツール chr16:81130600-, ClinVar chr16:81130591 G>A
- NM_052892.5:c.4570G>A（NM_052892.4 で代替） — 本ツール chr16:81149873-, ClinVar chr16:81149864 C>T
- NM_052892.5:c.3078C>G（NM_052892.4 で代替） — 本ツール chr16:81167934-, ClinVar chr16:81167925 G>C
- NM_052892.5:c.4438C>G（NM_052892.4 で代替） — 本ツール chr16:81151882-, ClinVar chr16:81151873 G>C
- NM_052892.5:c.5605C>T（NM_052892.4 で代替） — 本ツール chr16:81139525-, ClinVar chr16:81139516 G>A
- NM_052892.5:c.4216A>G（NM_052892.4 で代替） — 本ツール chr16:81154248-, ClinVar chr16:81154239 T>C
- NM_052892.5:c.1300A>G（NM_052892.4 で代替） — 本ツール chr16:81198905-, ClinVar chr16:81198896 T>C
- NM_052892.5:c.1968G>C（NM_052892.4 で代替） — 本ツール chr16:81185521-, ClinVar chr16:81185512 C>G
- NM_052892.5:c.4700T>C（NM_052892.4 で代替） — 本ツール chr16:81149743-, ClinVar chr16:81149734 A>G
- NM_052892.5:c.2576T>C（NM_052892.4 で代替） — 本ツール chr16:81175612-, ClinVar chr16:81174913 A>G
- NM_052892.5:c.1871C>T（NM_052892.4 で代替） — 本ツール chr16:81185618-, ClinVar chr16:81185609 G>A
- NM_052892.5:c.913G>A（NM_052892.4 で代替） — 本ツール chr16:81202730-, ClinVar chr16:81202721 C>T
- NM_052892.5:c.3466G>A（NM_052892.4 で代替） — 本ツール chr16:81163611-, ClinVar chr16:81163602 C>T
- NM_052892.5:c.5568G>A（NM_052892.4 で代替） — 本ツール chr16:81139562-, ClinVar chr16:81139553 C>T
- NM_052892.5:c.5538G>T（NM_052892.4 で代替） — 本ツール chr16:81139592-, ClinVar chr16:81139583 C>A
- NM_052892.5:c.1258C>T（NM_052892.4 で代替） — 本ツール chr16:81198947-, ClinVar chr16:81198938 G>A
- NM_052892.5:c.1031G>T（NM_052892.4 で代替） — 本ツール chr16:81202612-, ClinVar chr16:81202603 C>A
- NM_005396.5:c.805G>C（NM_005396.4 で代替） — 本ツール chr10:116631342+, ClinVar chr10:116631345 G>C
- NM_052892.5:c.2800G>A（NM_052892.4 で代替） — 本ツール chr16:81171053-, ClinVar chr16:81171044 C>T
- NM_052892.5:c.2335C>A（NM_052892.4 で代替） — 本ツール chr16:81177909-, ClinVar chr16:81177900 G>T
- NM_052892.5:c.3238T>C（NM_052892.4 で代替） — 本ツール chr16:81164751-, ClinVar chr16:81164742 A>G
- NM_052892.5:c.4384G>C（NM_052892.4 で代替） — 本ツール chr16:81153983-, ClinVar chr16:81153974 C>G
- NM_052892.5:c.3655G>A（NM_052892.4 で代替） — 本ツール chr16:81160728-, ClinVar chr16:81160719 C>T
- NM_052892.5:c.2863G>T（NM_052892.4 で代替） — 本ツール chr16:81170990-, ClinVar chr16:81170981 C>A
- NM_052892.5:c.1460A>G（NM_052892.4 で代替） — 本ツール chr16:81198745-, ClinVar chr16:81198736 T>C
- NM_052892.5:c.1426C>G（NM_052892.4 で代替） — 本ツール chr16:81198779-, ClinVar chr16:81198770 G>C
- NM_052892.5:c.5872C>G（NM_052892.4 で代替） — 本ツール chr16:81130630-, ClinVar chr16:81130621 G>C
- NM_052892.5:c.4439G>A（NM_052892.4 で代替） — 本ツール chr16:81151881-, ClinVar chr16:81151872 C>T
- NM_052892.5:c.3602T>C（NM_052892.4 で代替） — 本ツール chr16:81160781-, ClinVar chr16:81160772 A>G
- NM_052892.5:c.2087T>G（NM_052892.4 で代替） — 本ツール chr16:81181182-, ClinVar chr16:81181173 A>C
- NM_052892.5:c.2597T>G（NM_052892.4 で代替） — 本ツール chr16:81174901-, ClinVar chr16:81174892 A>C
- NM_052892.5:c.5748C>A（NM_052892.4 で代替） — 本ツール chr16:81133672-, ClinVar chr16:81133663 G>T
- NM_052892.5:c.3946G>A（NM_052892.4 で代替） — 本ツール chr16:81157038-, ClinVar chr16:81157029 C>T
- NM_052892.5:c.3806C>T（NM_052892.4 で代替） — 本ツール chr16:81159712-, ClinVar chr16:81159703 G>A
- NM_052892.5:c.4438C>T（NM_052892.4 で代替） — 本ツール chr16:81151882-, ClinVar chr16:81151873 G>A
- NM_052892.5:c.1525C>A（NM_052892.4 で代替） — 本ツール chr16:81198680-, ClinVar chr16:81198671 G>T
- NM_052892.5:c.1889T>C（NM_052892.4 で代替） — 本ツール chr16:81185600-, ClinVar chr16:81185591 A>G
- NM_052892.5:c.3425G>A（NM_052892.4 で代替） — 本ツール chr16:81163652-, ClinVar chr16:81163643 C>T
- NM_052892.5:c.1741C>G（NM_052892.4 で代替） — 本ツール chr16:81188929-, ClinVar chr16:81188920 G>C
- NM_052892.5:c.4094A>G（NM_052892.4 で代替） — 本ツール chr16:81156890-, ClinVar chr16:81156881 T>C
- NM_052892.5:c.2224G>A（NM_052892.4 で代替） — 本ツール chr16:81179681-, ClinVar chr16:81179672 C>T
- NM_052892.5:c.1025C>T（NM_052892.4 で代替） — 本ツール chr16:81202618-, ClinVar chr16:81202609 G>A
- NM_052892.5:c.923A>C（NM_052892.4 で代替） — 本ツール chr16:81202720-, ClinVar chr16:81202711 T>G
- NM_052892.5:c.4637G>A（NM_052892.4 で代替） — 本ツール chr16:81149806-, ClinVar chr16:81149797 C>T
- NM_052892.5:c.5751G>T（NM_052892.4 で代替） — 本ツール chr16:81133669-, ClinVar chr16:81133660 C>A
- NM_052892.5:c.4520C>T（NM_052892.4 で代替） — 本ツール chr16:81151800-, ClinVar chr16:81151791 G>A
- NM_052892.5:c.4033G>A（NM_052892.4 で代替） — 本ツール chr16:81156951-, ClinVar chr16:81156942 C>T
- NM_005396.5:c.401C>T（NM_005396.4 で代替） — 本ツール chr10:116626931+, ClinVar chr10:116626934 C>T
- NM_052892.5:c.3428G>A（NM_052892.4 で代替） — 本ツール chr16:81163649-, ClinVar chr16:81163640 C>T
- NM_052892.5:c.4402G>A（NM_052892.4 で代替） — 本ツール chr16:81153965-, ClinVar chr16:81151909 C>T
- NM_052892.5:c.3736G>A（NM_052892.4 で代替） — 本ツール chr16:81159782-, ClinVar chr16:81159773 C>T
- NM_052892.5:c.920A>C（NM_052892.4 で代替） — 本ツール chr16:81202723-, ClinVar chr16:81202714 T>G
- NM_052892.5:c.5399C>A（NM_052892.4 で代替） — 本ツール chr16:81141315-, ClinVar chr16:81141306 G>T
- NM_052892.5:c.2432C>G（NM_052892.4 で代替） — 本ツール chr16:81177812-, ClinVar chr16:81175747 G>C
- NM_052892.5:c.1006G>A（NM_052892.4 で代替） — 本ツール chr16:81202637-, ClinVar chr16:81202628 C>T
- NM_052892.5:c.3023G>A（NM_052892.4 で代替） — 本ツール chr16:81167989-, ClinVar chr16:81167980 C>T
- NM_052892.5:c.1259A>C（NM_052892.4 で代替） — 本ツール chr16:81198946-, ClinVar chr16:81198937 T>G
- NM_052892.5:c.1636T>C（NM_052892.4 で代替） — 本ツール chr16:81190700-, ClinVar chr16:81190691 A>G
- NM_052892.5:c.3641A>G（NM_052892.4 で代替） — 本ツール chr16:81160742-, ClinVar chr16:81160733 T>C
- NM_052892.5:c.2189C>T（NM_052892.4 で代替） — 本ツール chr16:81179716-, ClinVar chr16:81179707 G>A
- NM_052892.5:c.5522G>A（NM_052892.4 で代替） — 本ツール chr16:81139608-, ClinVar chr16:81139599 C>T
- NM_052892.5:c.3482G>A（NM_052892.4 で代替） — 本ツール chr16:81160901-, ClinVar chr16:81160892 C>T
- NM_052892.5:c.2642C>T（NM_052892.4 で代替） — 本ツール chr16:81174856-, ClinVar chr16:81174847 G>A
- NM_052892.5:c.1916G>C（NM_052892.4 で代替） — 本ツール chr16:81185573-, ClinVar chr16:81185564 C>G
- NM_052892.5:c.1121T>A（NM_052892.4 で代替） — 本ツール chr16:81202522-, ClinVar chr16:81202513 A>T
- NM_052892.5:c.5803C>A（NM_052892.4 で代替） — 本ツール chr16:81133617-, ClinVar chr16:81133608 G>T
- NM_052892.5:c.3065C>T（NM_052892.4 で代替） — 本ツール chr16:81167947-, ClinVar chr16:81167938 G>A
- NM_005396.5:c.644C>T（NM_005396.4 で代替） — 本ツール chr10:116630006+, ClinVar chr10:116630009 C>T
- NM_052892.5:c.3481C>T（NM_052892.4 で代替） — 本ツール chr16:81160902-, ClinVar chr16:81160893 G>A
- NM_052892.5:c.1165A>G（NM_052892.4 で代替） — 本ツール chr16:81199040-, ClinVar chr16:81199031 T>C
- NM_052892.5:c.4066G>A（NM_052892.4 で代替） — 本ツール chr16:81156918-, ClinVar chr16:81156909 C>T
- NM_052892.5:c.4492G>A（NM_052892.4 で代替） — 本ツール chr16:81151828-, ClinVar chr16:81151819 C>T
- NM_052892.5:c.5585A>G（NM_052892.4 で代替） — 本ツール chr16:81139545-, ClinVar chr16:81139536 T>C
- NM_052892.5:c.3836G>A（NM_052892.4 で代替） — 本ツール chr16:81159682-, ClinVar chr16:81159673 C>T
- NM_052892.5:c.2639C>G（NM_052892.4 で代替） — 本ツール chr16:81174859-, ClinVar chr16:81174850 G>C
- NM_052892.5:c.5524C>A（NM_052892.4 で代替） — 本ツール chr16:81139606-, ClinVar chr16:81139597 G>T
- NM_052892.5:c.5626G>C（NM_052892.4 で代替） — 本ツール chr16:81137530-, ClinVar chr16:81137521 C>G
- NM_052892.5:c.2126A>G（NM_052892.4 で代替） — 本ツール chr16:81179779-, ClinVar chr16:81179770 T>C
- NM_052892.5:c.4214C>T（NM_052892.4 で代替） — 本ツール chr16:81154250-, ClinVar chr16:81154241 G>A
- NM_052892.5:c.4853G>C（NM_052892.4 で代替） — 本ツール chr16:81148258-, ClinVar chr16:81148249 C>G
- NM_052892.5:c.4583A>T（NM_052892.4 で代替） — 本ツール chr16:81149860-, ClinVar chr16:81149851 T>A
- NM_052892.5:c.2219C>T（NM_052892.4 で代替） — 本ツール chr16:81179686-, ClinVar chr16:81179677 G>A
- NM_052892.5:c.2496C>A（NM_052892.4 で代替） — 本ツール chr16:81175692-, ClinVar chr16:81175683 G>T
- …ほか 82 件

### 形式2（旧版がデータに無く、別バージョンで代替計算）（intron:substitution） — 2 件

- NM_000265.3:c.1351+1G>A — c.1351 はコード領域（c.1〜c.1173）を超えています。3'UTR は c.*N で指定してください（ClinVar chr7:74789339-74789339）
- NM_000854.1:c.200+1G>A（NM_000854.3 で代替） — 本ツール chr22:23981036+, ClinVar chr22:23960293 C>T（鎖の向きの不一致）

### 形式3（配列照合）: 参照アミノ酸の一致と 1 塩基置換候補に正解を含むか（missense） — 2 件

- NP_000512.1:p.Ser62Leu — コドン TTG（L）→ TTG（L）
- NP_940980.3:p.His50Arg — コドン CGC（R）→ CGC（R）
