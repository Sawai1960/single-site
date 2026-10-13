import { connection } from "next/server";
import { getIndex } from "@/lib/variant/refseq";

export async function GET() {
  await connection();
  try {
    const idx = await getIndex();
    return Response.json({
      builtAt: idx.builtAt,
      mane: idx.sources.mane,
      transcripts: idx.count,
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 503 });
  }
}
