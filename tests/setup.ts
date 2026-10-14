import { readFile } from "node:fs/promises";
import path from "node:path";
import { setDataReader } from "../src/lib/variant/refseq";

const DATA_DIR = path.join(process.cwd(), "public", "data");

setDataReader(async (file) => {
  const buf = await readFile(path.join(DATA_DIR, file));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
});
