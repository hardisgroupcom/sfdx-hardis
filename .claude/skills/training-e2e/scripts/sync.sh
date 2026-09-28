#!/usr/bin/env bash
# Brings the latest course into the fork's major branches, mid-walk, when the
# course itself was fixed during the run.
#
# A branch that has no commit of its own is fast-forwarded: merging the course
# into every branch separately gives them two merge bases, and GitHub then reports
# promotions as conflicting. Only a branch with commits of its own gets a merge.
#
# This is maintenance, not a learner action: protection is lifted for the push and
# put back. Prefer reset-fork.sh and a clean walk whenever the run can afford it.
set -e
# shellcheck source-path=SCRIPTDIR
# shellcheck source=env.sh
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
REF=${REF:-upstream/main}
cd "$RUN"

# This script checks branches out and hard-resets them. Anything uncommitted in
# the clone would be lost, and mid-walk is exactly when there is something.
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "The clone has uncommitted changes. Commit or stash them first:"
  git status --short --untracked-files=no
  exit 1
fi

git fetch -q upstream
git fetch -q origin

lift() { gh api -X DELETE "repos/$FORK/branches/$1/protection" >/dev/null 2>&1 && echo yes || echo no; }
# A relative specifier in `node -e` resolves against the working directory, which
# keeps this free of any absolute path.
# protectBranch returns a boolean, so node exits 0 either way: the exit code has to
# be set from it, or a branch left unprotected passes silently and stays unprotected
# for the rest of the walk.
protect() { (cd "$COURSE" && node -e "import('./scripts/lib/protection.mjs').then(m=>{const ok=m.protectBranch('$FORK','$1');console.log('$1 protected:',ok);process.exit(ok?0:1)})"); }

# A branch whose protection was lifted must get it back even when the merge
# conflicts or the push is rejected, which `set -e` would otherwise skip.
UNPROTECTED=""
restore_protection() {
  for branch in $UNPROTECTED; do
    protect "$branch" || echo "WARNING: $branch is still unprotected"
  done
  UNPROTECTED=""
}
trap restore_protection EXIT

current=$(git branch --show-current)
for b in main integration uat preprod; do
  git rev-parse -q --verify "origin/$b" >/dev/null || continue
  if git merge-base --is-ancestor "$REF" "origin/$b"; then continue; fi
  if [ "$(lift "$b")" = "yes" ]; then UNPROTECTED="$UNPROTECTED $b"; fi
  if git merge-base --is-ancestor "origin/$b" "$REF"; then
    git push -q origin "$REF:refs/heads/$b"
    echo "$b fast-forwarded"
  else
    git checkout -q "$b" 2>/dev/null || git checkout -q -b "$b" "origin/$b"
    git reset -q --hard "origin/$b"
    git merge -q --no-edit -m "Course update" "$REF"
    git push -q origin "$b"
    echo "$b merged"
  fi
  restore_protection
done
git checkout -q "$current"
git pull -q --ff-only origin "$current" 2>/dev/null || true
