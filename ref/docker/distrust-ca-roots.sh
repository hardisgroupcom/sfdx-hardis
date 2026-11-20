#!/bin/sh
# Stop trusting, in the system and Java trust stores of the image, the root CAs that the Node.js
# runtime no longer trusts, so that git, curl, Python (pip, requests) and Java (PMD) reject the same
# certificates as Node.js.
# October 2026: eMudhra intermediate CA key compromise. Node.js 24.22.1 removed
# emSign ECC Root CA - G3, emSign ECC Root CA - C3 and emSign Root CA - C1 from its bundled store.
#
# - The certificates are found by subject name, whatever their file name in the ca-certificates package.
# - Each one is turned off with a "!" line in /etc/ca-certificates.conf, then update-ca-certificates
#   rebuilds the bundle and the hash links (and on Ubuntu, tells the Java keystore hook).
#   apk and dpkg keep a modified config file on upgrade, so an image built from this one that
#   upgrades ca-certificates still leaves them out.
# - The build fails if /etc/ssl/certs or the Java cacerts still trusts one of them, or cannot be read.
#
# Not covered: Chromium (Alpine) and Google Chrome (Ubuntu) use their own root store. The image build
# installs their latest release, which carries the browser vendor's own distrust decisions.
#
# Needs Node.js to read the certificates. Works on Alpine (busybox sh) and Ubuntu (dash).
set -eu

DISTRUSTED_CNS="emSign ECC Root CA - G3|emSign ECC Root CA - C3|emSign Root CA - C1"
JAVA_OWNER_REGEX='^Owner: CN=emSign (ECC Root CA - G3|ECC Root CA - C3|Root CA - C1),'
CERTS_DIR=/usr/share/ca-certificates
CERTS_CONF=/etc/ca-certificates.conf
SYSTEM_CERTS_DIR=/etc/ssl/certs
SYSTEM_BUNDLE=$SYSTEM_CERTS_DIR/ca-certificates.crt
# A system bundle with fewer certificates than this was not read properly
MIN_BUNDLE_CERTS=100

# Prints "<file><TAB><CN>" for each distrusted certificate found in the PEM files given as arguments.
# Fails if a file holds a certificate that cannot be parsed, or if MIN_CERTS is set and fewer were read.
FIND_DISTRUSTED_JS='
const fs = require("fs");
const { X509Certificate } = require("crypto");
const distrusted = new Set(process.env.DISTRUSTED_CNS.split("|"));
let total = 0;
for (const file of process.argv.slice(1)) {
  const blocks = fs.readFileSync(file, "utf8").match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [];
  for (const pem of blocks) {
    total++;
    const cnLine = new X509Certificate(pem).subject.split("\n").find((line) => line.startsWith("CN="));
    const cn = cnLine ? cnLine.slice(3) : "";
    if (distrusted.has(cn)) {
      console.log(file + "\t" + cn);
    }
  }
}
const minCerts = Number(process.env.MIN_CERTS || 0);
if (total < minCerts) {
  console.error("Only " + total + " certificates read from " + process.argv.slice(1).join(" ") + ", expected at least " + minCerts);
  process.exit(2);
}
'
export DISTRUSTED_CNS

WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT

# System store: turn the distrusted roots off in ca-certificates.conf, then rebuild
find "$CERTS_DIR" -type f -name '*.crt' -exec node -e "$FIND_DISTRUSTED_JS" {} + >"$WORK_DIR/found.txt"
touch "$CERTS_CONF"
cut -f1 "$WORK_DIR/found.txt" | sort -u | while IFS= read -r file; do
  entry=${file#"$CERTS_DIR"/}
  awk -v entry="$entry" '$0 == entry { print "!" entry; next } { print }' "$CERTS_CONF" >"$WORK_DIR/certs.conf"
  if ! grep -qxF "!$entry" "$WORK_DIR/certs.conf"; then
    echo "!$entry" >>"$WORK_DIR/certs.conf"
  fi
  cat "$WORK_DIR/certs.conf" >"$CERTS_CONF"
  echo "Distrusted $entry"
done
update-ca-certificates

# Java store: a hook of update-ca-certificates may already have removed them, delete what is left
if command -v keytool >/dev/null 2>&1; then
  keytool -list -v -cacerts -storepass changeit >"$WORK_DIR/java.txt"
  awk -v re="$JAVA_OWNER_REGEX" '/^Alias name: /{alias=substr($0, 13)} $0 ~ re {print alias}' "$WORK_DIR/java.txt" |
    while IFS= read -r alias; do
      keytool -delete -cacerts -storepass changeit -noprompt -alias "$alias"
      echo "Removed $alias from the Java cacerts"
    done
fi

# Check that nothing still trusts them: the bundle, and every file or hash link OpenSSL reads in /etc/ssl/certs
status=0
MIN_CERTS=$MIN_BUNDLE_CERTS node -e "$FIND_DISTRUSTED_JS" "$SYSTEM_BUNDLE" >"$WORK_DIR/left.txt"
find -L "$SYSTEM_CERTS_DIR" -maxdepth 1 -type f ! -name "$(basename "$SYSTEM_BUNDLE")" -exec node -e "$FIND_DISTRUSTED_JS" {} + >>"$WORK_DIR/left.txt"
if [ -s "$WORK_DIR/left.txt" ]; then
  echo "Distrusted root CAs are still trusted by the system store:" >&2
  cat "$WORK_DIR/left.txt" >&2
  status=1
fi
if command -v keytool >/dev/null 2>&1; then
  keytool -list -v -cacerts -storepass changeit >"$WORK_DIR/java.txt"
  if grep -Eq "$JAVA_OWNER_REGEX" "$WORK_DIR/java.txt"; then
    echo "A distrusted root CA is still in the Java cacerts" >&2
    status=1
  fi
fi
exit "$status"
