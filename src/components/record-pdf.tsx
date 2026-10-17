"use client";

import { useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { FileText, Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { candidateChecks, selfDirection, SOURCES, type ResultVerification, type VerificationSummary } from "@/components/verification";
import { locusText, ninePad } from "@/lib/variant/format";
import { MODE_LABEL, type KazusaMode } from "@/lib/variant/kazusa";
import { numberingNote, planEntries, pointNote, requestPoint, spanText, type EntryPlan, type PlannedEntry } from "@/lib/variant/request-form";
import type { ConversionResult, ResultCandidate } from "@/lib/variant/types";

/** What was written into Kazusa request forms, for the record. */
export interface FormRecord {
  files: { name: string; label: string; entries: PlannedEntry[] }[];
  skipped: EntryPlan["skipped"];
  left: PlannedEntry[];
  leftReason?: string;
}

export interface DataMeta {
  builtAt: string;
  mane: string;
  transcripts: number;
}

const STATUS_LABEL = { ok: "変換成功", warning: "要確認", error: "エラー" } as const;

const SUMMARY_LABEL: Record<VerificationSummary, string> = {
  none: "—",
  pending: "照合中",
  unchecked: "未照合",
  match: "一致",
  partial: "一部のみ確認",
  unavailable: "確認不可",
  mismatch: "不一致",
};

const OUTCOME_LABEL = { match: "一致", mismatch: "不一致", unavailable: "確認不可" } as const;

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function sourceText(v: ResultVerification | undefined, ci: number, source: (typeof SOURCES)[number]["id"]): string {
  const s = candidateChecks(v, ci)[source];
  if (!s) return "未照合";
  if (s.state === "pending") return "照合中";
  if (s.state === "error") return "接続エラー";
  if (!s.check) return "対象外";
  const parts = [
    s.check.forward && `順 ${OUTCOME_LABEL[s.check.forward.status]}`,
    s.check.reverse && `逆 ${OUTCOME_LABEL[s.check.reverse.status]}`,
  ].filter(Boolean);
  return parts.join("・") || "—";
}

function shortHgvs(s: string): string {
  return s.replace(/^[A-Z]{2}_\d+(\.\d+)?:/, "");
}

function selfText(c: ResultCandidate): string {
  if (!c.selfCheck) return "—";
  const label = (ok: boolean) => (ok ? "一致" : "不一致");
  return `順 ${label(selfDirection(c.selfCheck, "forward"))}・逆 ${label(selfDirection(c.selfCheck, "reverse"))}`;
}

export function RecordPdf({
  results,
  mode,
  statuses,
  summaries,
  verification,
  formRecord,
  meta,
  version,
  checking,
}: {
  results: ConversionResult[];
  mode: KazusaMode;
  statuses: ConversionResult["status"][];
  summaries: VerificationSummary[];
  verification: Record<number, ResultVerification>;
  formRecord: FormRecord | null;
  meta: DataMeta | null;
  version: string;
  /** external checks still running */
  checking: { done: number; total: number } | null;
}) {
  const [refId, setRefId] = useState("");
  const [printedAt, setPrintedAt] = useState<Date | null>(null);
  const unchecked = summaries.filter((s) => s === "unchecked").length;

  function print() {
    const now = new Date();
    flushSync(() => setPrintedAt(now));
    const title = document.title;
    document.title = `hgvs-record-${stamp(now)}`;
    document.body.classList.add("print-record");
    window.addEventListener(
      "afterprint",
      () => {
        document.title = title;
        document.body.classList.remove("print-record");
      },
      { once: true },
    );
    window.print();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="size-5" />
          記録用 PDF
        </CardTitle>
        <CardDescription>
          入力・変換結果・照合結果・依頼書への記入内容を 1 つの PDF にまとめます。ボタンを押すと印刷画面が開くので、送信先（プリンター）で「PDF に保存」を選んで保存してください。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-sm">
            <span className="font-medium">照合用の番号（任意）</span>
            <Input
              value={refId}
              onChange={(e) => setRefId(e.target.value)}
              placeholder="例: 検体番号・依頼番号"
              maxLength={40}
              className="w-64"
            />
          </label>
          <Button size="lg" onClick={print} disabled={!!checking}>
            {checking ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Printer data-icon="inline-start" />}
            {checking ? `外部照合中…（${checking.done}/${checking.total} 件完了）` : "記録用 PDF を作る"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          氏名・カルテ番号など、患者を特定できる情報は入れないでください。番号は PDF の中に書くだけで、どこにも送信しません。作成日時は自動で入ります。
        </p>
        {checking ? (
          <p className="text-sm text-muted-foreground">外部照合が終わると、PDF を作れるようになります。</p>
        ) : (
          unchecked > 0 && (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              外部照合が済んでいない結果が {unchecked} 件あります。PDF には「未照合」と書かれます。
            </p>
          )
        )}
        {!formRecord && (
          <p className="text-sm text-muted-foreground">依頼書に記入した場合は、記入した内容も PDF に入ります。</p>
        )}
      </CardContent>
      {createPortal(
        <RecordSheet
          results={results}
          mode={mode}
          statuses={statuses}
          summaries={summaries}
          verification={verification}
          formRecord={formRecord}
          meta={meta}
          version={version}
          refId={refId.trim()}
          printedAt={printedAt}
        />,
        document.body,
      )}
    </Card>
  );
}

function RecordSheet({
  results,
  mode,
  statuses,
  summaries,
  verification,
  formRecord,
  meta,
  version,
  refId,
  printedAt,
}: {
  results: ConversionResult[];
  mode: KazusaMode;
  statuses: ConversionResult["status"][];
  summaries: VerificationSummary[];
  verification: Record<number, ResultVerification>;
  formRecord: FormRecord | null;
  meta: DataMeta | null;
  version: string;
  refId: string;
  printedAt: Date | null;
}) {
  const plan = planEntries(
    results,
    mode,
    results.map((_, i) => ({ warning: statuses[i] === "warning", mismatch: summaries[i] === "mismatch" })),
  );
  const th = "border border-neutral-400 bg-neutral-100 px-1.5 py-1 text-left font-semibold";
  const td = "border border-neutral-400 px-1.5 py-1 align-top";

  return (
    <div className="record-sheet hidden bg-white text-[9pt] leading-snug text-black">
      <h1 className="text-[14pt] font-bold">HGVS–GRCh38 座標変換の記録</h1>
      <table className="mt-2 w-full border-collapse">
        <tbody>
          <tr>
            <th className={`${th} w-32`}>作成日時</th>
            <td className={td}>{printedAt?.toLocaleString("ja-JP")}</td>
            <th className={`${th} w-32`}>照合用の番号</th>
            <td className={`${td} font-mono`}>{refId || "（記入なし）"}</td>
          </tr>
          <tr>
            <th className={th}>検査の区分</th>
            <td className={td}>{MODE_LABEL[mode]}</td>
            <th className={th}>ツール</th>
            <td className={td}>シングルサイト解析のための HGVS–GRCh38 座標自動変換ツール v{version}</td>
          </tr>
          <tr>
            <th className={th}>使用データ</th>
            <td className={td} colSpan={3}>
              UCSC Genome Browser hg38 の NCBI RefSeq アライメント
              {meta && `、${meta.mane}、転写産物アライメント ${meta.transcripts.toLocaleString()} 件（${new Date(meta.builtAt).toLocaleDateString("ja-JP")} 取得）`}
            </td>
          </tr>
        </tbody>
      </table>

      <h2 className="mt-4 mb-1 text-[11pt] font-bold">1. 入力と依頼書に書く内容</h2>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={`${th} w-6`}>#</th>
            <th className={th}>入力</th>
            <th className={th}>遺伝子</th>
            <th className={th}>{mode === "sanger" ? "依頼書に書く内容（1行）" : "hg38 の位置（9 桁）"}</th>
            <th className={th}>変換</th>
            <th className={th}>外部照合</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r, i) => {
            const entry = plan.entries.find((e) => e.index === i);
            const skip = plan.skipped.find((s) => s.index === i);
            const top = r.candidates[0];
            const point = entry?.point ?? (top ? requestPoint(top) : undefined);
            return (
              <tr key={i} className="break-inside-avoid">
                <td className={td}>{i + 1}</td>
                <td className={`${td} font-mono break-all`}>{r.input}</td>
                <td className={`${td} font-semibold`}>{entry?.gene ?? top?.gene ?? "—"}</td>
                <td className={td}>
                  <span className={`font-mono font-semibold break-all ${entry ? "" : "text-gray-500"}`}>
                    {entry
                      ? mode === "sanger"
                        ? entry.text
                        : ninePad(entry.pos)
                      : point
                        ? mode === "sanger" || point.chrom === "chrM"
                          ? `${point.chrom}:${point.pos}`
                          : ninePad(point.pos)
                        : "—"}
                  </span>
                  {point?.span && <span className="block font-mono">{spanText(point)}</span>}
                  {numberingNote(top) && <span className="block">{numberingNote(top)}</span>}
                  {(r.status === "error" ? r.message : skip?.reason) && (
                    <span className="block">{r.status === "error" ? r.message : skip?.reason}</span>
                  )}
                  {!entry && point && pointNote(point) && <span className="block">{pointNote(point)}</span>}
                </td>
                <td className={`${td} whitespace-nowrap`}>{STATUS_LABEL[statuses[i]]}</td>
                <td className={`${td} whitespace-nowrap`}>{SUMMARY_LABEL[summaries[i]]}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h2 className="mt-4 mb-1 text-[11pt] font-bold">2. 変換結果と照合結果</h2>
      <p className="mb-1">
        照合は 3 つの計算 × 2 方向（順: c. → hg38、逆: hg38 → c.）の 6 通りです。本ツール: UCSC のアライメントで両方向に計算し直した結果。外部データベース検証（NCBI・Ensembl）: UCSC を使わない独立した計算との照合結果。hg38 の位置は、上が座標、下が依頼書用の 9 桁です。2 つ目以降の候補は簡潔に表示し、位置が先頭の候補と同じときは「同上」としています。
      </p>
      {results.map((r, i) => (
        <section key={i} className="mt-2">
          <div className="font-semibold break-after-avoid">
            #{i + 1} <span className="font-mono">{r.input}</span>
            <span className="ml-2 font-normal">
              {r.formatLabel && `${r.formatLabel} / `}
              {STATUS_LABEL[statuses[i]]}
            </span>
          </div>
          {r.message && <p>{r.message}</p>}
          {r.candidates.length > 0 && (
            <table className="mt-0.5 w-full border-collapse">
              <thead>
                <tr>
                  <th rowSpan={2} className={th}>転写産物</th>
                  <th rowSpan={2} className={th}>遺伝子</th>
                  <th rowSpan={2} className={th}>hg38 の位置</th>
                  <th rowSpan={2} className={th}>c. / p. 表記</th>
                  <th rowSpan={2} className={`${th} whitespace-nowrap`}>本ツール</th>
                  <th colSpan={SOURCES.length} className={th}>外部データベース検証</th>
                </tr>
                <tr>
                  {SOURCES.map((s) => (
                    <th key={s.id} className={th}>
                      {s.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.candidates.map((c, ci) => {
                  const first = r.candidates[0];
                  const same = ci > 0 && c.chrom === first.chrom && c.start === first.start && c.end === first.end;
                  return (
                    <tr key={ci} className={ci > 0 ? "break-inside-avoid text-[8pt]" : "break-inside-avoid"}>
                      <td className={`${td} font-mono whitespace-nowrap`}>
                        {c.transcript || "—"}
                        {ci === 0 && c.hgvsP && c.protein && <span className="block">{c.protein}</span>}
                        {c.mane && <span className="block font-sans">{c.mane}</span>}
                        {c.historical && <span className="block font-sans">旧バージョン</span>}
                      </td>
                      <td className={td}>{c.gene || "—"}</td>
                      <td className={`${td} font-mono whitespace-nowrap`}>
                        {same ? (
                          <span className="font-sans">同上</span>
                        ) : (
                          <>
                            {locusText(c.chrom, c.start, c.end)}
                            <span className="block font-semibold">
                              {ninePad(c.start)}
                              {c.end !== c.start && `–${ninePad(c.end)}`}
                            </span>
                          </>
                        )}
                      </td>
                      <td className={`${td} font-mono break-words`}>
                        {c.hgvsC ? shortHgvs(c.hgvsC) : "—"}
                        {ci === 0 && c.hgvsP && <span className="block">{shortHgvs(c.hgvsP)}</span>}
                      </td>
                      <td className={`${td} whitespace-nowrap`}>{selfText(c)}</td>
                      {SOURCES.map((s) => (
                        <td key={s.id} className={td}>
                          {sourceText(verification[i], ci, s.id)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {[...r.notes, ...new Set(r.candidates.flatMap((c) => c.warnings))].map((n) => (
            <p key={n} className="mt-0.5">
              ・{n}
            </p>
          ))}
        </section>
      ))}

      <h2 className="mt-4 mb-1 text-[11pt] font-bold">3. かずさ遺伝子検査室の検査依頼書への記入</h2>
      {!formRecord ? (
        <p>依頼書への記入は行っていません。</p>
      ) : (
        <>
          {formRecord.files.some((f) => f.entries.some((e) => e.alerts?.length)) && (
            <p className="mb-1 border-2 border-black p-1.5 font-bold">
              ⚠ 依頼書に表示される転写産物では解析の対象範囲から外れる可能性がある変異があります。送付前に、かずさ遺伝子検査室に確認してください。
            </p>
          )}
          {formRecord.files.map((f) => (
            <div key={f.name} className="mt-1 break-inside-avoid">
              <div className="font-semibold">
                {f.label}: <span className="font-mono font-normal">{f.name}</span>
              </div>
              <ul className="pl-4">
                {f.entries.map((e, i) => (
                  <li key={`${e.input}-${i}`} className="list-disc">
                    <span className="font-mono font-semibold">
                      {e.gene} {ninePad(e.pos)}
                      {e.text && ` — ${e.text}`}
                    </span>
                    （入力: <span className="font-mono">{e.input}</span>）
                    {e.alerts?.map((n) => (
                      <span key={n} className="block font-bold">
                        ⚠ {n}
                      </span>
                    ))}
                    {[...e.review, ...e.notes, ...(e.info ?? [])].map((n) => (
                      <span key={n} className="block">
                        {n}
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {formRecord.left.length > 0 && (
            <div className="mt-1">
              <div className="font-semibold">記入しきれなかった変異 {formRecord.left.length} 件</div>
              <p>{formRecord.leftReason}</p>
              <ul className="pl-4">
                {formRecord.left.map((e, i) => (
                  <li key={`${e.input}-${i}`} className="list-disc font-mono">
                    {e.input}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {formRecord.skipped.length > 0 && (
            <div className="mt-1">
              <div className="font-semibold">記入しなかった入力 {formRecord.skipped.length} 件</div>
              <ul className="pl-4">
                {formRecord.skipped.map((s, i) => (
                  <li key={`${s.input}-${i}`} className="list-disc">
                    <span className="font-mono">{s.input}</span>：{s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <p className="mt-4 border-t border-neutral-400 pt-1 text-[8pt]">
        本記録は、HGVS 表記のバリアントの GRCh38 座標を求める作業の記録です。出力結果は UCSC Genome Browser 等で確認のうえ使用し、検査依頼を含む最終的な判断は利用者が行ってください。
      </p>
    </div>
  );
}
