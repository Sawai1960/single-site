# Claude Code 向けの案内

設計方針・未完了の課題・利用者との約束は `HANDOVER.md` にまとめてある。作業の前に必ず読む。
`HANDOFF.md` は 2026-10-14 時点の古い記録で、`HANDOVER.md` と食い違うときは `HANDOVER.md` が正しい。

@AGENTS.md
@HANDOVER.md

## 作業場所

- 作業フォルダーは `D:\claude-dev\single-site`（2026-11-08 に OneDrive の外へ移した）。
- 元の OneDrive のフォルダー（`…\OneDrive\ドキュメント\AI\AI_Cursor\シングルサイト換算ツール\hgvs-genomic-converter-1`）は確認用に残しているだけで、編集・コミットしない。消すかどうかはユーザーと相談して決める。
- UMIN の通知書は `UMIN\`、かずさの依頼書・案内は `docs\kazusa\` にある（どちらもコミットしない）。

## コマンド（Windows / PowerShell では `npm` ではなく `npm.cmd`）

- 開発サーバー: `npm.cmd run dev` → http://localhost:43127/single-site/ （127.0.0.1 のみで待ち受け）
- テスト: `npm.cmd test`
- 型検査: `npm.cmd run typecheck`
- lint: `npm.cmd run lint`
- 公開と同じ形での確認: `npm.cmd run build` のあと `npm.cmd run preview` → http://localhost:43128/single-site/ （院内 LAN の別端末から確認するため、全アドレスで待ち受け）
- UMIN への送信は、利用者に頼まれたときだけ `npm.cmd run publish -- --skip-data`
