#!/bin/sh
# Download a reviewed immutable release, never main. Supply archive SHA-256 out of band.
set -eu
option=
if [ "${1:-}" = --help ]; then
  echo 'Usage: bootstrap.sh [--with-humanlayer] <40-character commit> <archive-sha256>'; exit 0
fi
if [ "${1:-}" = --with-humanlayer ]; then option=--with-humanlayer; shift; fi
[ "$#" -eq 2 ] || { echo 'Usage: bootstrap.sh [--with-humanlayer] <40-character commit> <archive-sha256>' >&2; exit 2; }
commit=$1 checksum=$2
case "$commit" in *[!0-9a-f]*|'') exit 2;; esac
case "$checksum" in *[!0-9a-f]*|'') exit 2;; esac
[ ${#commit} -eq 40 ] && [ ${#checksum} -eq 64 ] || exit 2
command -v python3 >/dev/null || { echo 'Install Python 3.9+ first.' >&2; exit 1; }
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 "https://codeload.github.com/dapp-whisperer/pi-config/tar.gz/$commit" -o "$tmp/source.tgz"
python3 - "$tmp" "$checksum" "$commit" <<'PY'
import hashlib,pathlib,sys,tarfile
root=pathlib.Path(sys.argv[1]); archive=root/'source.tgz'
if hashlib.sha256(archive.read_bytes()).hexdigest()!=sys.argv[2]: raise SystemExit('Release checksum mismatch')
with tarfile.open(archive) as tar:
 prefix='pi-config-'+sys.argv[3]
 for item in tar.getmembers():
  p=pathlib.PurePosixPath(item.name)
  if (p.is_absolute() or '..' in p.parts or not p.parts or p.parts[0]!=prefix
      or not (item.isfile() or item.isdir())):
   raise SystemExit('Unsafe installer archive member')
 tar.extractall(root)
PY
python3 "$tmp/pi-config-$commit/install.py" ${option:+"$option"}
