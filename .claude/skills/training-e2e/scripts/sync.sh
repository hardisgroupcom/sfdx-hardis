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
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
REF=${REF:-upstream/main}
cd "$RUN"
git fetch -q upstream
git fetch -q origin
# A relative specifier in `node -e` resolves against the working directory, which
# keeps this free of any absolute path.
lift() { gh api -X DELETE "repos/$FORK/branches/$1/protection" >/dev/null 2>&1 && echo yes || echo no; }
protect() { (cd "$COURSE" && node -e "import('./scripts/lib/protection.mjs').then(m=>console.log('$1 protected:',m.protectBranch('$FORK','$1')))"); }
current=$(git branch --show-current)
for b in main integration uat preprod; do
  git rev-parse -q --verify "origin/$b" >/dev/null || continue
  if git merge-base --is-ancestor "$REF" "origin/$b"; then continue; fi
  was=$(lift "$b")
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
  [ "$was" = "yes" ] && protect "$b"
done
git checkout -q "$current"
git pull -q --ff-only origin "$current" 2>/dev/null || true
