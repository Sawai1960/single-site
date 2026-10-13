"use client";

import { CheckCircle2, Copy, ExternalLink, TriangleAlert, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { VerificationPanel, type candidateChecks } from "@/components/verification";
import { cn } from "@/lib/utils";
import { formatPos, ninePad } from "@/lib/variant/format";
import type { ResultCandidate } from "@/lib/variant/types";

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label}をコピーしました`, { description: text });
  } catch {
    toast.error("コピーできませんでした");
  }
}

function NineDigits({ value, label }: { value: number; label: string }) {
  const digits = ninePad(value);
  return (
    <div className="flex items-center gap-2">
      <span className="w-8 shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="flex" aria-label={`${label} ${digits}`}>
        {digits.split("").map((d, i) => (
          <span
            key={i}
            className={cn(
              "flex h-8 w-6 items-center justify-center border-y border-r bg-background font-mono text-sm font-semibold tabular-nums first:rounded-l-md first:border-l last:rounded-r-md sm:w-7",
              i % 3 === 0 && i > 0 && "border-l-foreground/30",
            )}
          >
            {d}
          </span>
        ))}
      </div>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => copy(digits, `${label}（9桁）`)}
              aria-label={`${label}の9桁表記をコピー`}
            />
          }
        >
          <Copy />
        </TooltipTrigger>
        <TooltipContent>9桁表記をコピー</TooltipContent>
      </Tooltip>
    </div>
  );
}

function Field({ label, value, mono = true }: { label: string; value?: string; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("text-sm break-all", mono && "font-mono")}>{value}</dd>
    </div>
  );
}

export function CandidateView({
  c,
  dimmed = false,
  checks,
  onVerify,
}: {
  c: ResultCandidate;
  dimmed?: boolean;
  checks?: ReturnType<typeof candidateChecks>;
  onVerify?: () => void;
}) {
  const externalMismatch = Object.values(checks ?? {}).some(
    (s) => s.state === "done" && (s.check?.forward?.status === "mismatch" || s.check?.reverse?.status === "mismatch"),
  );
  const locus = c.start === c.end ? `${c.chrom}:${formatPos(c.start)}` : `${c.chrom}:${formatPos(c.start)}-${formatPos(c.end)}`;
  const plainLocus = c.start === c.end ? `${c.chrom}:${c.start}` : `${c.chrom}:${c.start}-${c.end}`;
  const len = c.end - c.start + 1;

  return (
    <div className={cn("rounded-xl border bg-card p-4 shadow-xs", dimmed && "opacity-70")}>
      <div className="flex flex-wrap items-center gap-2">
        {c.transcript ? (
          <span className="font-mono text-sm font-semibold">{c.transcript}</span>
        ) : c.chrom === "chrM" ? (
          <Badge variant="secondary">ミトコンドリア DNA（rCRS）</Badge>
        ) : (
          <span className="text-sm text-muted-foreground">転写産物なし</span>
        )}
        {c.gene && <span className="text-sm font-medium">{c.gene}</span>}
        {c.protein && <span className="font-mono text-xs text-muted-foreground">{c.protein}</span>}
        {c.mane === "MANE Select" && (
          <Badge className="bg-emerald-600 text-white">MANE Select</Badge>
        )}
        {c.mane === "MANE Plus Clinical" && (
          <Badge className="bg-sky-600 text-white">MANE Plus Clinical</Badge>
        )}
        {c.historical && (
          <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400">
            旧バージョン
          </Badge>
        )}
        {c.transcript && (
          <Badge variant="secondary">{c.strand === "+" ? "+鎖" : "−鎖"}</Badge>
        )}
        {c.refCheck &&
          (c.refCheck.ok ? (
            <Badge variant="outline" className="border-emerald-500 text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 data-icon="inline-start" />
              {c.refCheck.label}一致
            </Badge>
          ) : (
            <Badge variant="destructive">
              <XCircle data-icon="inline-start" />
              {c.refCheck.label}不一致
            </Badge>
          ))}
        {externalMismatch && (
          <Badge variant="destructive">
            <XCircle data-icon="inline-start" />
            外部データベースと不一致
          </Badge>
        )}
      </div>

      <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="space-y-3">
          <div>
            <div className="text-xs text-muted-foreground">hg38 ゲノム位置{len > 1 ? `（${len} 塩基）` : ""}</div>
            <div className="flex flex-wrap items-center gap-1">
              <span className="font-mono text-xl font-bold tracking-tight">{locus}</span>
              <Button variant="ghost" size="icon-sm" onClick={() => copy(plainLocus, "ゲノム位置")} aria-label="ゲノム位置をコピー">
                <Copy />
              </Button>
            </div>
          </div>
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <Field label="c. 表記" value={c.hgvsC} />
            <Field label="p. 表記" value={c.hgvsP} />
            <Field label={c.chrom === "chrM" ? "m. 表記（rCRS）" : "g. 表記（hg38）"} value={c.hgvsG} />
            {c.region !== undefined && <Field label="ミトコンドリアの領域" value={c.region} mono={false} />}
            <Field
              label="リファレンス塩基（+鎖）"
              value={c.genomicRef ? (c.genomicRef.length > 40 ? `${c.genomicRef.slice(0, 40)}…` : c.genomicRef) : undefined}
            />
            <Field label="コドン（転写産物の向き）" value={c.codon} />
            {c.refCheck && (
              <Field
                label={`${c.refCheck.label}の照合`}
                value={`入力 ${c.refCheck.expected} / hg38 ${c.refCheck.observed}`}
              />
            )}
          </dl>
        </div>
        <div className="space-y-2 rounded-lg bg-muted/60 p-3">
          <div className="text-xs font-medium">依頼書用（9桁・ゼロ埋め）</div>
          <NineDigits value={c.start} label={len > 1 ? "開始" : "位置"} />
          {len > 1 && <NineDigits value={c.end} label="終了" />}
          <a
            href={c.ucscUrl}
            target="_blank"
            rel="noreferrer"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full")}
          >
            <ExternalLink data-icon="inline-start" />
            UCSC Genome Browser で確認
          </a>
        </div>
      </div>

      {c.snvCandidates && c.snvCandidates.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-xs font-medium text-muted-foreground">
            このアミノ酸変化を起こす 1 塩基置換の候補
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-1.5 text-left font-medium">c. 表記</th>
                  <th className="px-3 py-1.5 text-left font-medium">コドン</th>
                  <th className="px-3 py-1.5 text-left font-medium">hg38 位置</th>
                  <th className="px-3 py-1.5 text-left font-medium">9桁</th>
                  <th className="px-3 py-1.5 text-left font-medium">+鎖の変化</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {c.snvCandidates.map((s) => (
                  <tr key={s.hgvsC} className="border-t">
                    <td className="px-3 py-1.5">{s.hgvsC}</td>
                    <td className="px-3 py-1.5">{s.codonChange}</td>
                    <td className="px-3 py-1.5">
                      {c.chrom}:{formatPos(s.genomicPos)}
                    </td>
                    <td className="px-3 py-1.5">
                      <button
                        type="button"
                        className="underline decoration-dotted underline-offset-4 hover:text-primary"
                        onClick={() => copy(ninePad(s.genomicPos), "9桁表記")}
                      >
                        {ninePad(s.genomicPos)}
                      </button>
                    </td>
                    <td className="px-3 py-1.5">
                      {s.genomicRef}&gt;{s.genomicAlt}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {c.warnings.length > 0 && (
        <ul className="mt-3 space-y-1">
          {c.warnings.map((w) => (
            <li key={w} className="flex gap-2 text-sm text-amber-800 dark:text-amber-300">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span>{w}</span>
            </li>
          ))}
        </ul>
      )}

      {c.verify && c.transcript && <VerificationPanel plan={c.verify} checks={checks ?? {}} onRun={onVerify} />}
    </div>
  );
}
