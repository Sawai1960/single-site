#!/usr/bin/env node
// Refreshes the transcript data, builds the static site into out/, and uploads it to
// UMIN SQUARE over SFTP (Windows 10+ ships the OpenSSH sftp command). The UMIN password
// is typed at the prompt.
//
//   npm run publish                 refresh data, build, upload
//   npm run publish -- --skip-data  keep the current data
//   npm run publish -- --no-upload  build only (check with npm run preview)
//
// Defaults match https://square.umin.ac.jp/single-site/; override with UMIN_USER,
// UMIN_HOST, UMIN_DIR.
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const USER = process.env.UMIN_USER ?? "single-site";
const HOST = process.env.UMIN_HOST ?? "square.umin.ac.jp";
const DIR = process.env.UMIN_DIR ?? "html";
const args = process.argv.slice(2);

function run(command, commandArgs) {
  console.log(`\n> ${command} ${commandArgs.join(" ")}`);
  const r = spawnSync(command, commandArgs, { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) {
    console.error(`失敗しました: ${command} ${commandArgs.join(" ")}`);
    process.exit(r.status ?? 1);
  }
}

if (!args.includes("--skip-data")) run("node", ["scripts/build-data.mjs", "--refresh"]);
run("npm", ["run", "build"]);

if (args.includes("--no-upload")) {
  console.log("\nout/ に書き出しました。npm run preview で確認できます。");
  process.exit(0);
}

console.log(`\n${USER}@${HOST} の ${DIR}/ に送信します。UMIN のパスワードを入力してください。`);
const sftp = spawn("sftp", [`${USER}@${HOST}`], { cwd: ROOT, stdio: ["pipe", "inherit", "inherit"] });
sftp.stdin.end([`lcd out`, `cd ${DIR}`, `put -r *`, `bye`, ""].join("\n"));
sftp.on("error", (e) => {
  console.error(`sftp を起動できませんでした（${e.message}）。WinSCP などで out/ の中身を ${DIR}/ に送ってください。`);
  process.exit(1);
});
sftp.on("exit", (code) => {
  if (code === 0) console.log(`\n公開しました: https://${HOST}/${USER}/`);
  else console.error(`\n送信に失敗しました（sftp の終了コード ${code}）。`);
  process.exit(code ?? 1);
});
