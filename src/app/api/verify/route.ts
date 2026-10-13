import { verifyItems, type VerifyItem } from "@/lib/variant/verify";
import type { VerifySource } from "@/lib/variant/types";

export const maxDuration = 300;

const MAX_ITEMS = 30;
const ACC = /^N[MR]_\d+\.\d+$/;
const HGVS = /^N[MR]_\d+\.\d+:c\.[-*+_0-9A-Za-z>()]+$/;

function valid(x: unknown): x is VerifyItem {
  const i = x as VerifyItem;
  const num = (n: unknown) => Number.isInteger(n) && (n as number) > 0 && (n as number) < 3e8;
  return (
    typeof i?.transcript === "string" &&
    ACC.test(i.transcript) &&
    typeof i.chrom === "string" &&
    /^chr([1-9]|1\d|2[0-2]|X|Y|M)$/.test(i.chrom) &&
    Array.isArray(i.plan?.forward) &&
    Array.isArray(i.plan?.points) &&
    i.plan.forward.length <= 6 &&
    i.plan.points.length <= 6 &&
    i.plan.forward.every(
      (f) =>
        HGVS.test(f?.hgvs) &&
        HGVS.test(`${f.at?.hgvs}del`) &&
        num(f.edit?.from) &&
        num(f.edit.to + 1) &&
        typeof f.edit.alt === "string" &&
        /^[ACGT]*$/.test(f.edit.alt) &&
        num(f.at.from) &&
        num(f.at.to),
    ) &&
    i.plan.points.every((p) => num(p?.pos) && typeof p.c === "string" && /^c\.[-*]?\d+([+-]\d+)?$/.test(p.c))
  );
}

export async function POST(request: Request) {
  let body: { source?: unknown; items?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON を解釈できません" }, { status: 400 });
  }
  const source = body.source as VerifySource;
  if (source !== "ncbi" && source !== "ensembl") {
    return Response.json({ error: "source は ncbi か ensembl を指定してください" }, { status: 400 });
  }
  const items = body.items;
  if (!Array.isArray(items) || !items.length || items.length > MAX_ITEMS || !items.every(valid)) {
    return Response.json({ error: `items（最大 ${MAX_ITEMS} 件の照合データ）が正しくありません` }, { status: 400 });
  }
  try {
    return Response.json({ checks: await verifyItems(source, items) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
