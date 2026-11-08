#!/usr/bin/env node
// Refreshes the transcript data, builds the static site into out/, and uploads it to
// UMIN SQUARE over SFTP via scripts/upload-umin.py (Python paramiko + keyring). The UMIN
// password comes from Windows Credential Manager; it is asked for, and saved after a
// successful login, only the first time.
//
//   npm run publish                 refresh data, build, upload
//   npm run publish -- --skip-data  keep the current data
//   npm run publish -- --no-upload  build only (check with npm run preview)
//
// Defaults match https://square.umin.ac.jp/single-site/; override with UMIN_USER,
// UMIN_HOST, UMIN_DIR.
import { spawnSync } from "node:child_process";
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

// The upload runs in Python (paramiko): Windows' OpenSSH sftp could not negotiate a cipher
// with UMIN, and it cannot read a stored password. upload-umin.py reads the password from
// Windows Credential Manager and asks (then saves it) only when none is stored.
const PYTHON = process.env.PYTHON ?? "python";
console.log(`\n> ${PYTHON} scripts/upload-umin.py`);
const up = spawnSync(PYTHON, ["scripts/upload-umin.py"], {
  cwd: ROOT,
  stdio: "inherit",
  env: { ...process.env, UMIN_USER: USER, UMIN_HOST: HOST, UMIN_DIR: DIR, PYTHONIOENCODING: "utf-8" },
});
if (up.error) {
  console.error(`Python を起動できませんでした（${up.error.message}）。WinSCP などで out/ の中身を ${DIR}/ に送ってください。`);
  process.exit(1);
}
if (up.status !== 0) {
  console.error(`\n送信に失敗しました（終了コード ${up.status}）。`);
  process.exit(up.status ?? 1);
}
console.log(`\n公開しました: https://${HOST}/${USER}/`);
