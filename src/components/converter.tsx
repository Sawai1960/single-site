"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRightLeft, ChevronDown, Download, Eraser, Info, Loader2, OctagonX, PencilLine } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { RecordPdf, type DataMeta, type FormRecord } from "@/components/record-pdf";
import { RequestFormFiller } from "@/components/request-form";
import { effectiveStatus, ResultCard } from "@/components/result-card";
import { SummaryTable } from "@/components/summary-table";
import {
  fetchSourceChecks,
  SOURCES,
  verifiableIndexes,
  verificationSummary,
  verificationText,
  type ResultVerification,
  type SourceState,
} from "@/components/verification";
import { cn } from "@/lib/utils";
import { convertMany } from "@/lib/variant/convert";
import { resultsToCsv } from "@/lib/variant/format";
import { CANCER60_GENES, MODE_LABEL, SANGER_SITES_PER_FORM, type KazusaMode } from "@/lib/variant/kazusa";
import { getIndex } from "@/lib/variant/refseq";
import type { ConversionResult, VerifySource } from "@/lib/variant/types";

const EXAMPLES: Record<KazusaMode, { label: string; value: string }[]> = {
  cancer60: [
    { label: "形式1", value: "hg38, chr17:7675088" },
    { label: "形式2", value: "NM_007294.4:c.68_69del" },
    { label: "形式2", value: "NM_000249.4:c.350C>T" },
    { label: "形式4（p.）", value: "TP53 p.Arg175His" },
    { label: "hg19", value: "hg19, chr17:7578406" },
  ],
  sanger: [
    { label: "形式1", value: "hg38, chrX:37783542 T>G" },
    { label: "形式2", value: "NM_000397.4:c.194T>G" },
    { label: "形式2", value: "NM_000053.3:c.2903T>C" },
    { label: "形式4（p.）", value: "CYBB p.Met65Arg" },
    { label: "hg19", value: "hg19, chr13:52520577" },
  ],
};

const MODES: { id: KazusaMode; sub: string; form: string }[] = [
  { id: "cancer60", sub: "NGS によるシングルサイト解析（対象は 60 遺伝子）", form: "依頼書: 遺伝子名＋9桁の位置" },
  { id: "sanger", sub: "上記以外の遺伝子", form: "依頼書: 遺伝子名・位置・NM 番号・c. 表記を1行で" },
];

const MAX_LINES = 200;
/** External checks start automatically for the first results only, to stay within NCBI/Ensembl rate limits. */
const AUTO_VERIFY_RESULTS = 5;

export function Converter({ version }: { version: string }) {
  const [mode, setMode] = useState<KazusaMode | null>(null);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ConversionResult[] | null>(null);
  const [resultsKey, setResultsKey] = useState(0);
  const [verification, setVerification] = useState<Record<number, ResultVerification>>({});
  const [revealed, setRevealed] = useState(false);
  const runId = useRef(0);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const details = useRef<HTMLDivElement>(null);
  const [meta, setMeta] = useState<DataMeta | null>(null);
  const [formRecord, setFormRecord] = useState<FormRecord | null>(null);

  useEffect(() => {
    getIndex()
      .then((idx) => setMeta({ builtAt: idx.builtAt, mane: idx.sources.mane, transcripts: idx.count }))
      .catch(() => {});
  }, []);

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  async function run() {
    if (!mode || !lines.length || loading) return;
    if (lines.length > MAX_LINES) {
      setError(`一度に変換できるのは ${MAX_LINES} 行までです（現在 ${lines.length} 行）`);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await getIndex();
      const list = await convertMany(lines);
      const run = ++runId.current;
      setResults(list);
      setResultsKey((k) => k + 1);
      setVerification({});
      setRevealed(false);
      list
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => verifiableIndexes(r).length)
        .slice(0, AUTO_VERIFY_RESULTS)
        .forEach(({ r, i }) => verify(r, i, run));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function verify(r: ConversionResult, i: number, run = runId.current) {
    const update = (source: VerifySource, s: SourceState) => {
      if (run !== runId.current) return;
      setVerification((v) => ({ ...v, [i]: { ...v[i], [source]: s } }));
    };
    for (const { id } of SOURCES) {
      update(id, { state: "pending" });
      fetchSourceChecks(r, id).then((s) => update(id, s));
    }
  }

  function backToInput() {
    textarea.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    textarea.current?.focus({ preventScroll: true });
  }

  function reveal() {
    setRevealed(true);
    requestAnimationFrame(() => details.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function addExample(v: string) {
    setText((t) => (t.trim() ? `${t.replace(/\s+$/, "")}\n${v}` : v));
  }

  function downloadCsv() {
    if (!results || !mode) return;
    const blob = new Blob(
      [
        resultsToCsv(
          results.map((r, i) => ({ ...r, status: effectiveStatus(r, verification[i], mode) })),
          mode,
          (ri, ci) => verificationText(verification[ri], ci),
        ),
      ],
      { type: "text/csv;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    a.href = url;
    a.download = `hg38_positions_${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const statuses = results?.map((r, i) => effectiveStatus(r, verification[i], mode));
  const summaries = results?.map((r, i) => verificationSummary(r, verification[i]));
  const started = summaries?.filter((s) => s !== "none" && s !== "unchecked").length ?? 0;
  const checking = summaries?.filter((s) => s === "pending").length ?? 0;
  const unverified = summaries?.flatMap((s, i) => (s === "unchecked" ? [i] : [])) ?? [];

  const lastCheck = useRef({ key: resultsKey, checking: 0 });
  useEffect(() => {
    const prev = lastCheck.current;
    if (prev.key === resultsKey && prev.checking > 0 && checking === 0) {
      toast.success("外部照合が完了しました。依頼書に記入できます");
    }
    lastCheck.current = { key: resultsKey, checking };
  }, [resultsKey, checking]);
  const counts =
    statuses && summaries
      ? {
          ok: statuses.filter((s) => s === "ok").length,
          warning: statuses.filter((s) => s === "warning").length,
          error: statuses.filter((s) => s === "error").length,
          mismatch: summaries.filter((s) => s === "mismatch").length,
          unchecked: summaries.filter((s) => s === "unchecked" || s === "unavailable" || s === "partial").length,
        }
      : null;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader>
            <CardTitle>変異の位置情報を入力</CardTitle>
            <CardDescription>検査の区分を選び、変異を入力して変換します。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">
                ① 検査の区分を選んでください（必須）
              </legend>
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="検査の区分">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={mode === m.id}
                    onClick={() => setMode(m.id)}
                    className={cn(
                      "flex gap-2.5 rounded-lg border p-3 text-left transition-colors hover:bg-muted/60",
                      mode === m.id && "border-primary bg-primary/5 ring-1 ring-primary hover:bg-primary/5",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                        mode === m.id && "border-primary",
                      )}
                    >
                      {mode === m.id && <span className="size-2 rounded-full bg-primary" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{MODE_LABEL[m.id]}</span>
                      <span className="block text-xs text-muted-foreground">{m.sub}</span>
                      <span className="block text-xs text-muted-foreground">{m.form}</span>
                    </span>
                  </button>
                ))}
              </div>
              <details className="rounded-lg border bg-muted/30 px-3 py-2 text-xs">
                <summary className="cursor-pointer font-medium select-none">
                  がん関連遺伝子のシングルサイト解析の対象 60 遺伝子と区分の根拠（クリックで表示）
                </summary>
                <p className="mt-2 font-mono leading-relaxed break-words">
                  {[...CANCER60_GENES].sort().join("、")}
                </p>
                <p className="mt-1 text-muted-foreground">
                  これ以外の遺伝子は、がんに関連する遺伝子でも「それ以外（Sanger 単一エクソン）」の依頼になります。選んだ区分と遺伝子が合わない場合は、変換結果に注意が出ます。
                </p>
                <p className="mt-1 text-muted-foreground">
                  区分と注意の表示は、公開されているかずさ遺伝子検査室の検査案内書（がん関連遺伝子のシングルサイト解析 K110-40 Ver 8、ヒト遺伝子単一エクソン受託解析 K110-6 Ver 9）をもとに作成したものです。本ツールはかずさ遺伝子検査室が公式に承認したツールではありません。依頼の際は最新の検査案内書・依頼書をご確認ください。
                </p>
              </details>
            </fieldset>
            <div className="space-y-1 pt-1">
              <div className="text-sm font-medium">② 変異を入力してください</div>
              <p className="text-xs text-muted-foreground">
                1 行に 1 件ずつ、Enter で改行して入力してください。複数行をまとめて変換できます（最大 {MAX_LINES} 行）。枠内の薄い文字は入力例で、書き始めると消えます。
              </p>
            </div>
            <Textarea
              ref={textarea}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  run();
                }
              }}
              placeholder={(mode ? EXAMPLES[mode] : EXAMPLES.cancer60)
                .slice(1, 4)
                .map((ex) => ex.value)
                .join("\n")}
              className="min-h-40 font-mono text-sm"
              spellCheck={false}
              aria-label="変異の位置情報"
            />
            {mode && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs text-muted-foreground">入力例（クリックすると上の欄に入ります）:</span>
                {EXAMPLES[mode].map((ex) => (
                  <Button key={ex.value} variant="outline" size="xs" onClick={() => addExample(ex.value)}>
                    <span className="text-muted-foreground">{ex.label}</span>
                    <span className="font-mono">{ex.value}</span>
                  </Button>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button size="lg" onClick={run} disabled={!mode || !lines.length || loading}>
                {loading ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <ArrowRightLeft data-icon="inline-start" />}
                {loading
                  ? "変換中…"
                  : !mode
                    ? "区分を選ぶと変換できます"
                    : `hg38 ゲノム位置に変換${lines.length > 1 ? `（${lines.length} 件）` : ""}`}
              </Button>
              <Button
                variant="ghost"
                size="lg"
                onClick={() => {
                  setText("");
                  setResults(null);
                  setError(null);
                  setVerification({});
                  runId.current++;
                }}
                disabled={loading || (!text && !results)}
              >
                <Eraser data-icon="inline-start" />
                クリア
              </Button>
              <span className="text-xs text-muted-foreground">Ctrl / ⌘ + Enter でも変換できます</span>
            </div>
          </CardContent>
        </Card>

        <FormatGuide />
      </div>

      {error && (
        <Alert variant="destructive">
          <OctagonX />
          <AlertTitle>変換に失敗しました</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading && !results && (
        <div className="space-y-3" aria-hidden>
          {lines.slice(0, 3).map((l, i) => (
            <div key={i} className="h-40 animate-pulse rounded-xl border bg-card" />
          ))}
          <p className="text-center text-sm text-muted-foreground">
            初回は転写産物データの読み込みに数秒かかります
          </p>
        </div>
      )}

      {results && counts && mode && statuses && summaries && (
        <section className={loading ? "space-y-3 opacity-60 transition-opacity" : "space-y-3"} aria-live="polite">
          <div>
            <h2 className="text-lg font-semibold">入力の確認</h2>
            <p className="text-sm text-muted-foreground">
              依頼書に書く遺伝子と位置の一覧です。入力した変異と合っているか確認してください。外部データベースとの照合は、確認している間に進めています。照合が終わると詳しい結果を表示できます。
            </p>
          </div>
          <SummaryTable results={results} mode={mode} statuses={statuses} summaries={summaries} />
          <div className="flex flex-wrap items-center gap-2">
            {!revealed && (
              <Button size="lg" onClick={reveal} disabled={checking > 0}>
                {checking > 0 ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <ChevronDown data-icon="inline-start" />}
                {checking > 0
                  ? `外部照合中…（${started - checking}/${started} 件完了）`
                  : "この内容で詳しい結果を表示する"}
              </Button>
            )}
            <Button variant="outline" size="lg" onClick={backToInput}>
              <PencilLine data-icon="inline-start" />
              入力に戻って直す
            </Button>
            {!revealed && checking > 0 && (
              <Button variant="link" size="sm" className="text-muted-foreground" onClick={reveal}>
                照合を待たずに表示する
              </Button>
            )}
            {revealed && checking > 0 && (
              <span className="text-xs text-muted-foreground">
                外部照合中…（{started - checking}/{started} 件完了）
              </span>
            )}
          </div>
        </section>
      )}

      {results && counts && revealed && (
        <section
          ref={details}
          className={loading ? "scroll-mt-4 space-y-4 opacity-60 transition-opacity" : "scroll-mt-4 space-y-4"}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">変換結果</h2>
              <p className="text-sm text-muted-foreground">
                {results.length} 件中 成功 {counts.ok} / 要確認 {counts.warning} / エラー {counts.error}
                {counts.mismatch > 0 && (
                  <span className="ml-2 font-semibold text-destructive">外部データベースと不一致 {counts.mismatch} 件（要精査）</span>
                )}
                {counts.unchecked > 0 && (
                  <span className="ml-2 font-semibold text-amber-700 dark:text-amber-400">
                    外部照合が済んでいない {counts.unchecked} 件
                  </span>
                )}
              </p>
            </div>
            <Button variant="outline" onClick={downloadCsv}>
              <Download data-icon="inline-start" />
              CSV をダウンロード
            </Button>
          </div>
          {mode === "sanger" && results.length > SANGER_SITES_PER_FORM && (
            <Alert>
              <Info />
              <AlertDescription>
                Sanger の依頼書に記入できる解析箇所は 1 件につき {SANGER_SITES_PER_FORM} か所までです。{results.length} 件ある場合は依頼書を分けてください。
              </AlertDescription>
            </Alert>
          )}
          {results.map((r, i) => (
            <ResultCard
              key={`${i}-${r.input}`}
              result={r}
              mode={mode ?? undefined}
              verification={verification[i]}
              onVerify={() => verify(r, i)}
            />
          ))}
          {mode && statuses && summaries && (
            <RequestFormFiller
              key={resultsKey}
              results={results}
              mode={mode}
              checking={checking ? { done: started - checking, total: started } : null}
              checked={started > 0}
              unverified={unverified.length}
              onVerifyRest={() => unverified.forEach((i) => verify(results[i], i))}
              review={results.map((_, i) => ({
                warning: statuses[i] === "warning",
                mismatch: summaries[i] === "mismatch",
                unverified: summaries[i] === "unchecked" || summaries[i] === "pending",
              }))}
              onRecord={setFormRecord}
            />
          )}
          {mode && statuses && summaries && (
            <RecordPdf
              results={results}
              mode={mode}
              statuses={statuses}
              summaries={summaries}
              verification={verification}
              formRecord={formRecord}
              meta={meta}
              version={version}
              checking={checking ? { done: started - checking, total: started } : null}
            />
          )}
        </section>
      )}

      {!results && !loading && (
        <div className="rounded-xl border border-dashed bg-card/50 px-6 py-10 text-center text-sm text-muted-foreground">
          {mode ? "変換結果がここに表示されます。上の入力例をクリックすると試せます。" : "変換結果がここに表示されます。まず上で検査の区分を選んでください。"}
        </div>
      )}

      <Notes meta={meta} />
    </div>
  );
}

function FormatGuide() {
  const rows = [
    { no: "1", title: "ゲノム位置", ex: ["hg38, chr1:195507262", "hg19 chr7:55259515 T>G", "NC_000004.12:g.55113391C>T", "NC_012920.1:m.3243A>G"] },
    { no: "2", title: "スプライシング型指定の c. 表記", ex: ["NM_002253.2:c.889G>A", "NM_002253.2, c.889G>A", "NM_000546.6:c.375+1G>A"] },
    { no: "3", title: "スプライシング型指定の p. 表記", ex: ["NP_443086.1:p.Asp509Glyfs", "NP_004976.2:p.G12D"] },
    {
      no: "4",
      title: "スプライシング型不明（遺伝子名）",
      ex: ["KDR:c.889G>A", "EGFR p.Leu858Arg", "SOX9 E75K", "MET 2888-14_2888-4del11"],
      note: "報告書のように c.・p. を省いた書き方（MET 2888-14_2888-4del11、SOX9 E75K）も読み取ります。BRCA1・BRCA2・CFTR は旧来の番号とも照らし合わせ、旧番号と一致したときは現在の c. 表記での入力をお願いします。",
    },
  ] as { no: string; title: string; ex: string[]; note?: string }[];
  return (
    <Card>
      <CardHeader>
        <CardTitle>対応している入力形式</CardTitle>
        <CardDescription>
          形式 2〜4 は hg38 のゲノム位置（形式 1）に変換します。形式 1 は hg38 上の位置の確認と、重なる転写産物の c. 表記を表示します。ミトコンドリア DNA の m. 表記（rCRS の番号）も形式 1 として扱います。
          <br />
          本ツールの計算: UCSC Genome Browser（hg38）に登録されている NCBI RefSeq 転写産物とゲノムの対応表（エクソンごとのアライメント）を使って、c. 位置を hg38 の位置に換算しています。p. 表記は、そのアミノ酸のコドン 3 塩基の位置に換算します。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="space-y-3">
          {rows.map((r) => (
            <li key={r.no} className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                {r.no}
              </span>
              <div className="min-w-0">
                <div className="text-sm font-medium">{r.title}</div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-xs text-muted-foreground">
                  {r.ex.map((e) => (
                    <span key={e}>{e}</span>
                  ))}
                </div>
                {r.note && <p className="mt-1 text-xs text-muted-foreground">{r.note}</p>}
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

const CAUTIONS = [
  "NM_ 番号（スプライシング型）が違うとゲノム位置が変わることがあります。候補が複数ある場合は、お手元の情報と矛盾がないか確認してください。",
  "得られた位置は、UCSC Genome Browser などで同じリファレンス（hg38）を開き、SNP・ClinVar などの情報が元の変異と一致するか確認してください。",
  "古くから知られる変異は、シグナル配列を除いた成熟型タンパク質の番号で表記されていることがあります。その場合は、シグナル配列を含むコード領域上の番号に直してから入力してください。",
  "2 塩基以上の欠失は、範囲内のどの位置を指定しても構いません。依頼書の特記事項欄に欠失の内容を記入してください。",
  "欠失・重複・挿入が同じ配列の繰り返しの中にある場合、hg38 の位置は HGVS の g. 表記の規則（+鎖の 3' 側に寄せる）で示します。c. 表記の番号から直接換算した位置と数塩基ずれることがありますが、同じ変異を指します。",
  "難病の遺伝子パネル検査で見つかった変異の家系解析にも使えます。ただし、エクソン単位の欠失・重複（CNV）や反復配列の伸長（リピート病）は位置指定のシングルサイト検査の対象外です。CYP21A2・SMN1/SMN2・GBA1・PKD1 など偽遺伝子や相同領域がある遺伝子は、重複領域の警告が出ます。受け入れ可否は検査会社に確認してください。",
  "ミトコンドリア DNA の変異は m. 表記（rCRS の番号、hg38 の chrM と同じ）で入力できます。変異の割合（ヘテロプラスミー率）は組織や人によって違うため、割合の測定が必要かどうかも含めて検査会社に確認してください。",
];

const MODE_CAUTIONS: Record<KazusaMode, { source: string; items: string[] }> = {
  cancer60: {
    source: "がん関連遺伝子のシングルサイト解析 K110-40 Ver 8",
    items: [
      "対象は 60 遺伝子のたんぱく質コード領域のエクソンと、イントロン側 10 塩基以内です。UTR や、より深いイントロンの位置は対象外です。",
      "対象は 1 塩基置換と、10 塩基以内の欠失・挿入です。指定した位置の前後 2 塩基を含む範囲のバリアントが報告されます。",
      "PMS2・BMPR1A・SDHD・CHEK2・NF1・SDHA はゲノム上に相同配列があり、位置によっては受け入れられない場合があります。",
      "依頼書には、遺伝子名と hg38 の位置を 9 桁（ゼロ埋め）で記入します。",
    ],
  },
  sanger: {
    source: "ヒト遺伝子単一エクソン受託解析 K110-6 Ver 9・Sanger 検査依頼書 2023 v1.2",
    items: [
      `依頼書の解析箇所には、遺伝子名・hg38 のゲノムポジション・NM 番号・c. 表記と配列の変化・アミノ酸情報（あれば）・発端者 ID を記入します。「Sanger 依頼書用（1行）」をコピーして貼り付け、発端者 ID を追記してください。1 件の依頼書に記入できるのは ${SANGER_SITES_PER_FORM} か所までです。`,
      "発端者の解析をかずさ遺伝子検査室で行った場合は、報告書またはバリアント Excel 一覧に記載された位置を記入してください。本ツールの結果と異なる場合は、報告書の位置を優先します。",
      "かずさ遺伝子検査室は HGMD で採用された NM 番号で解析しています。本ツールが先頭に表示する MANE Select と異なることがあるため、NM 番号と c. 表記はお手元の報告書と照合してください。",
      "偽遺伝子・繰り返し配列・GC に富む領域・非常に大きな欠失を含む場合は、検査できないことがあります。大きな欠失・挿入は別途相談してください。体細胞モザイクは、割合によっては検出できないことがあります。",
    ],
  },
};

const DISCLAIMER = [
  "本ツールは、HGVS 表記で記載されたバリアントの GRCh38 ゲノム座標を求める作業を支援するためのものであり、疾患の診断・治療・予防を目的としたものではありません。",
  "本ツールは、臨床遺伝専門医・認定遺伝カウンセラーなど、遺伝学的検査の依頼に携わる方の利用を想定しています。出力結果は必ず UCSC Genome Browser 等で確認のうえご使用ください。検査依頼への使用を含め、最終的な判断と責任は利用者が担うものとします。",
  "本ツールは UCSC Genome Browser、NCBI、Ensembl 等の公開データを使用しています。作成者は、出力結果の正確性・完全性・最新性を保証しません。",
  "本ツールは、かずさ遺伝子検査室（公益財団法人かずさ DNA 研究所）とは関係ありません。同検査室の検査案内書の内容は作成時点の版（K110-40 Ver 8、K110-6 Ver 9）に基づいており、改訂後の内容は反映されていない場合があります。本ツールの結果について、同検査室へのお問い合わせはお控えください。",
  "作成者は、本ツールの使用または使用できなかったことによって生じたいかなる損害についても、責任を負いません。",
  "患者を特定できる情報（氏名・ID 等）は入力しないでください。",
];

function Notes({ meta }: { meta: DataMeta | null }) {
  const sources = [
    `転写産物の構造: UCSC Genome Browser hg38 の NCBI RefSeq アライメント（現行版と旧バージョン）${
      meta
        ? `、${meta.mane}、転写産物アライメント ${meta.transcripts.toLocaleString()} 件（${new Date(meta.builtAt).toLocaleDateString("ja-JP")} 取得）`
        : ""
    }`,
    "参照配列の照合: UCSC API（予備に Ensembl REST）",
    "hg19 → hg38 の変換: Ensembl REST",
    "ミトコンドリアの遺伝子情報: NCBI の NC_012920.1",
    "本ツール内の往復計算: すべての候補で、同じアライメントを使って c. → hg38 と hg38 → c. を両方向に計算し直し、一致するかを確認します（計算の誤りの検出用。データ自体の誤りは外部データベースとの照合で確認します）",
    `外部データベースとの照合: NCBI Variation Services と Ensembl VEP（RefSeq 転写産物）。先頭 ${AUTO_VERIFY_RESULTS} 件は自動で照合し、それ以降は各候補の「照合する」から実行します。`,
  ];
  return (
    <Card size="sm" id="disclaimer">
      <CardHeader>
        <CardTitle>利用上の注意</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 text-sm leading-relaxed text-foreground/90">
        <section>
          <h3 className="mb-1.5 font-semibold text-foreground">■ 位置を指定するときの注意</h3>
          <ul className="list-disc space-y-1 pl-5">
            {CAUTIONS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>
        {(Object.keys(MODE_CAUTIONS) as KazusaMode[]).map((m) => (
          <section key={m}>
            <h3 className="mb-1.5 font-semibold text-foreground">
              ■ {MODE_LABEL[m]}の依頼（かずさ遺伝子検査室 {MODE_CAUTIONS[m].source}）
            </h3>
            <ul className="list-disc space-y-1 pl-5">
              {MODE_CAUTIONS[m].items.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </section>
        ))}
        <section>
          <h3 className="mb-1.5 font-semibold text-foreground">■ 免責事項</h3>
          <ol className="list-decimal space-y-1 pl-5">
            {DISCLAIMER.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
        </section>
        <section>
          <h3 className="mb-1.5 font-semibold text-foreground">■ 使用しているデータと外部サービス</h3>
          <ul className="list-disc space-y-1 pl-5">
            {sources.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>
        <div>
          <p>作成者: 兵庫医科大学 澤井英明</p>
          <p className="mt-1 text-xs text-muted-foreground">
            © 2026 Hideaki Sawai. All rights reserved.
            本ツールはどなたでも自由にご利用いただけます。ソースコードの複製・改変・再配布には作成者の許可が必要です。
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
