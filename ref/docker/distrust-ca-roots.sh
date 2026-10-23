#!/bin/sh
# Remove from the trust stores of the image the root CAs that the Node.js runtime no longer trusts,
# so that git, curl, Python (pip, requests) and Java (PMD) reject the same certificates as Node.js.
# October 2026: eMudhra intermediate CA key compromise. Node.js 24.22.1 removed
# emSign ECC Root CA - G3, emSign ECC Root CA - C3 and emSign Root CA - C1 from its bundled store.
# The build fails if one of them is still trusted at the end.
# Works on Alpine (busybox sh) and Ubuntu (dash).
set -eu

ROOTS="emSign_ECC_Root_CA_-_G3 emSign_ECC_Root_CA_-_C3 emSign_Root_CA_-_C1"
JAVA_OWNER_REGEX='CN=emSign (ECC Root CA - G3|ECC Root CA - C3|Root CA - C1),'
MOZILLA_DIR=/usr/share/ca-certificates/mozilla
SYSTEM_BUNDLE=/etc/ssl/certs/ca-certificates.crt
FINGERPRINTS=/tmp/distrusted-ca-roots.txt

# System store: keep a line of each certificate body to check the bundle later, then remove it.
# On Ubuntu, the "!" entry in /etc/ca-certificates.conf keeps it out after a ca-certificates upgrade.
: >"$FINGERPRINTS"
for root in $ROOTS; do
  if [ -f "$MOZILLA_DIR/$root.crt" ]; then
    sed -n '3p' "$MOZILLA_DIR/$root.crt" >>"$FINGERPRINTS"
    rm -f "$MOZILLA_DIR/$root.crt"
  fi
  if [ -f /etc/ca-certificates.conf ]; then
    sed -i "s|^mozilla/$root\.crt\$|!mozilla/$root.crt|" /etc/ca-certificates.conf
  fi
done
# Remove the links left pointing to the deleted files, then rebuild the bundle and the hash links
find -L /etc/ssl/certs -maxdepth 1 -type l -exec rm -f {} +
update-ca-certificates

# Java store: the update-ca-certificates hooks usually already removed them, delete what is left
if command -v keytool >/dev/null 2>&1; then
  keytool -list -v -cacerts -storepass changeit 2>/dev/null |
    awk -v re="$JAVA_OWNER_REGEX" '/^Alias name: /{alias=substr($0, 13)} /^Owner: / && $0 ~ re {print alias}' |
    while IFS= read -r alias; do
      keytool -delete -cacerts -storepass changeit -noprompt -alias "$alias"
    done
fi

# Check that nothing still trusts them
status=0
while IFS= read -r line; do
  if [ -n "$line" ] && grep -qF "$line" "$SYSTEM_BUNDLE"; then
    echo "A distrusted root CA is still in $SYSTEM_BUNDLE" >&2
    status=1
  fi
done <"$FINGERPRINTS"
if command -v keytool >/dev/null 2>&1 &&
  keytool -list -v -cacerts -storepass changeit 2>/dev/null | grep -Eq "^Owner: $JAVA_OWNER_REGEX"; then
  echo "A distrusted root CA is still in the Java cacerts" >&2
  status=1
fi
rm -f "$FINGERPRINTS"
exit "$status"
