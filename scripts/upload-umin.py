#!/usr/bin/env python3
"""out/ の中身を UMIN SQUARE の html/ に SFTP で送る。

パスワードは Windows 資格情報マネージャー（Python の keyring）から読む。
保存されていなければ画面で尋ね、送信に成功したときだけ保存する。
パスワードを画面・ログ・ファイルに書き出すことはない。

  python scripts/upload-umin.py            送信する
  python scripts/upload-umin.py --forget   保存したパスワードを資格情報から消す

必要なもの: paramiko、keyring（pip install paramiko keyring）。
送り先は環境変数 UMIN_USER、UMIN_HOST、UMIN_DIR で変えられる。
ホスト鍵は ~/.ssh/known_hosts で照合し、記録が無いときは指紋を示して確認を求める。
"""

from __future__ import annotations

import getpass
import os
import posixpath
import sys
from pathlib import Path

try:
    import keyring
    import paramiko
except ImportError as e:  # pragma: no cover
    sys.exit(f"{e.name} がありません。pip install paramiko keyring を実行してください。")

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"
USER = os.environ.get("UMIN_USER", "single-site")
HOST = os.environ.get("UMIN_HOST", "square.umin.ac.jp")
DIR = os.environ.get("UMIN_DIR", "html")
PORT = 22
# 資格情報マネージャーでの名前（「Windows 資格情報」の「汎用資格情報」に出る）
SERVICE = f"UMIN SFTP {HOST}"
KNOWN_HOSTS = Path.home() / ".ssh" / "known_hosts"


class AskHostKeyPolicy(paramiko.MissingHostKeyPolicy):
    """known_hosts に無いホストは、指紋を見せて利用者が yes と答えたときだけ記録して続ける。"""

    def missing_host_key(self, client, hostname, key):
        fp = key.fingerprint if hasattr(key, "fingerprint") else key.get_base64()[:32]
        print(f"{hostname} のホスト鍵は記録がありません（{key.get_name()} {fp}）。")
        if input("この鍵を信頼して記録しますか？ yes と入力すると続けます: ").strip() != "yes":
            raise SystemExit("送信を中止しました。")
        client.get_host_keys().add(hostname, key.get_name(), key)
        KNOWN_HOSTS.parent.mkdir(exist_ok=True)
        client.save_host_keys(str(KNOWN_HOSTS))


def connect(pw: str) -> paramiko.SSHClient:
    client = paramiko.SSHClient()
    if KNOWN_HOSTS.exists():
        client.load_host_keys(str(KNOWN_HOSTS))
    client.set_missing_host_key_policy(AskHostKeyPolicy())
    # 引数は位置で渡す（hostname, port, username, password の順）
    client.connect(
        HOST,
        PORT,
        USER,
        pw,
        allow_agent=False,
        look_for_keys=False,
        timeout=30,
    )
    return client


def login() -> paramiko.SSHClient:
    stored = keyring.get_password(SERVICE, USER)
    if stored:
        try:
            client = connect(stored)
            print("資格情報マネージャーに保存したパスワードで接続しました。")
            return client
        except paramiko.AuthenticationException:
            print("保存したパスワードでは接続できませんでした。入力し直してください。")

    for _ in range(3):
        typed = getpass.getpass(f"{USER}@{HOST} の UMIN パスワード（表示されません）: ")
        if not typed:
            continue
        try:
            client = connect(typed)
        except paramiko.AuthenticationException:
            print("パスワードが違います。")
            continue
        keyring.set_password(SERVICE, USER, typed)
        print(f"接続しました。パスワードを資格情報マネージャー（{SERVICE}）に保存しました。次回から入力は不要です。")
        return client
    sys.exit("3 回失敗したので中止しました。パスワードは保存していません。")


def ensure_dir(sftp: paramiko.SFTPClient, remote: str, made: set[str]) -> None:
    if remote in made:
        return
    try:
        sftp.stat(remote)
    except FileNotFoundError:
        sftp.mkdir(remote)
    made.add(remote)


def upload(client: paramiko.SSHClient) -> int:
    files = sorted(p for p in OUT.rglob("*") if p.is_file())
    sftp = client.open_sftp()
    made: set[str] = set()
    ensure_dir(sftp, DIR, made)
    for i, local in enumerate(files, 1):
        rel = local.relative_to(OUT).as_posix()
        remote = posixpath.join(DIR, rel)
        parent = posixpath.dirname(remote)
        # 途中のフォルダーを上から順に作る
        parts = parent.split("/")
        for depth in range(1, len(parts) + 1):
            ensure_dir(sftp, "/".join(parts[:depth]), made)
        sftp.put(str(local), remote)
        if i % 100 == 0 or i == len(files):
            print(f"  {i} / {len(files)} 件")
    sftp.close()
    return len(files)


def main() -> None:
    if "--forget" in sys.argv[1:]:
        try:
            keyring.delete_password(SERVICE, USER)
            print(f"資格情報マネージャーから {SERVICE} を消しました。")
        except keyring.errors.PasswordDeleteError:
            print("保存されたパスワードはありません。")
        return

    if not (OUT / "index.html").exists():
        sys.exit("out/index.html がありません。先に npm run build を実行してください。")

    print(f"{USER}@{HOST} の {DIR}/ に送信します。")
    client = login()
    try:
        n = upload(client)
    finally:
        client.close()
    print(f"\n{n} 件を送りました。公開 URL: https://{HOST}/{USER}/")


if __name__ == "__main__":
    main()
