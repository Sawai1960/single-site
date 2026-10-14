import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export default function setup() {
  const data = path.join(process.cwd(), "public", "data", "index.json.gz");
  if (!existsSync(data)) {
    execFileSync("node", ["scripts/build-data.mjs", "--if-missing"], { stdio: "inherit" });
  }
}
