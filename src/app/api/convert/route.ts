import { convertMany } from "@/lib/variant/convert";

const MAX_LINES = 200;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON を解釈できません" }, { status: 400 });
  }
  const queries = (body as { queries?: unknown })?.queries;
  if (!Array.isArray(queries) || !queries.every((q) => typeof q === "string")) {
    return Response.json({ error: "queries（文字列の配列）を指定してください" }, { status: 400 });
  }
  const lines = queries.map((q) => q.trim()).filter(Boolean);
  if (!lines.length) return Response.json({ error: "入力が空です" }, { status: 400 });
  if (lines.length > MAX_LINES) {
    return Response.json({ error: `一度に変換できるのは ${MAX_LINES} 行までです` }, { status: 400 });
  }
  try {
    const results = await convertMany(lines);
    return Response.json({ results });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
