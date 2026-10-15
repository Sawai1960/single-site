import { describe, expect, it } from "vitest";
import { verificationSummary, type ResultVerification } from "@/components/verification";
import type { ConversionResult, ResultCandidate, SourceChecks } from "@/lib/variant/types";

const candidate = (transcript: string): ResultCandidate => ({
  transcript,
  gene: "G",
  protein: "",
  mane: "",
  historical: false,
  chrom: "chr1",
  strand: "+",
  start: 100,
  end: 100,
  warnings: [],
  ucscUrl: "",
  verify: { forward: [], points: [] },
});

const result: ConversionResult = {
  input: "x",
  status: "ok",
  candidates: [candidate("NM_1.1"), candidate("NM_2.1")],
  notes: [],
};

const match: SourceChecks = { forward: { status: "match", detail: "" } };
const mismatch: SourceChecks = { forward: { status: "mismatch", detail: "" } };
const unavailable: SourceChecks = { forward: { status: "unavailable", detail: "" } };

describe("外部照合の状態のまとめ", () => {
  it.each<[string, ResultVerification | undefined, string]>([
    ["未実施", undefined, "unchecked"],
    ["照合中", { ncbi: { state: "pending" } }, "pending"],
    ["一方でも不一致なら不一致", { ncbi: { state: "done", checks: [match, match] }, ensembl: { state: "done", checks: [match, mismatch] } }, "mismatch"],
    ["すべての候補・項目が一致", { ncbi: { state: "done", checks: [match, match] }, ensembl: { state: "done", checks: [match, match] } }, "match"],
    ["確認不可の項目があれば一致としない", { ncbi: { state: "done", checks: [match, unavailable] }, ensembl: { state: "done", checks: [unavailable, match] } }, "partial"],
    ["順変換が一致でも逆変換が確認不可なら一致としない", { ncbi: { state: "done", checks: [{ ...match, reverse: unavailable.forward }, match] }, ensembl: { state: "done", checks: [match, match] } }, "partial"],
    ["一部の候補だけ一致", { ncbi: { state: "done", checks: [match, unavailable] } }, "partial"],
    ["接続エラーがあれば一致としない", { ncbi: { state: "done", checks: [match, match] }, ensembl: { state: "error", message: "x" } }, "partial"],
    ["どれも確認できない", { ncbi: { state: "error", message: "x" }, ensembl: { state: "done", checks: [unavailable, null] } }, "unavailable"],
  ])("%s", (_, v, expected) => {
    expect(verificationSummary(result, v)).toBe(expected);
  });

  it("照合できる候補がなければ表示しない", () => {
    expect(verificationSummary({ ...result, candidates: [] }, undefined)).toBe("none");
  });
});
