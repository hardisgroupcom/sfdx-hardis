#!/usr/bin/env bash
# Puts the fork back to what a learner gets from a brand new fork: main and the
# training/start-level-* branches at the course's latest commit, no other branch,
# no secret, no open Pull Request. Then clones the shared repository into $RUN,
# which is what a learner does.
#
#   bash reset-fork.sh            # reset from the course's main
#   REF=feat/something bash reset-fork.sh
#
# Run this before every walk. A re-walk on a dirty fork produces failures that
# belong to the previous run, and three of the five runs so far lost time to one.
set -e
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
REF=${REF:-main}

# The fork is restored from $UPSTREAM, so read it from $UPSTREAM rather than
# from whatever $COURSE's origin happens to be. A course clone whose origin is
# the fork itself would otherwise reset the fork from the fork.
git -C "$COURSE" fetch -q "https://github.com/$UPSTREAM.git" \
  "+refs/heads/*:refs/remotes/e2e-upstream/*"

echo "resetting $FORK from $UPSTREAM@$REF"
for n in $(gh pr list -R "$FORK" --state open --json number -q '.[].number'); do gh pr close "$n" -R "$FORK" >/dev/null; done
for b in $(gh api "repos/$FORK/branches" --paginate -q '.[].name'); do gh api -X DELETE "repos/$FORK/branches/$b/protection" >/dev/null 2>&1 || true; done

git -C "$COURSE" push -q -f "https://github.com/$FORK.git" "e2e-upstream/$REF:refs/heads/main"
for lvl in 1 2 3; do
  git -C "$COURSE" rev-parse -q --verify "e2e-upstream/training/start-level-$lvl" >/dev/null &&
    git -C "$COURSE" push -q -f "https://github.com/$FORK.git" "e2e-upstream/training/start-level-$lvl:refs/heads/training/start-level-$lvl"
done

for b in $(gh api "repos/$FORK/branches" --paginate -q '.[].name'); do
  case $b in main|gh-pages|training/start-level-*) ;; *) gh api -X DELETE "repos/$FORK/git/refs/heads/$b" >/dev/null;; esac
done
for s in $(gh api "repos/$FORK/actions/secrets" -q '.secrets[].name'); do gh secret delete "$s" -R "$FORK" >/dev/null; done

# The learner clones the shared repository, not their fork: "Set up my training
# environment" is what renames origin to upstream and adds the fork as origin.
# Cloning the fork here would skip that step and take init down its other path.
rm -rf "$RUN"
git clone -q "https://github.com/$UPSTREAM.git" "$RUN"
git -C "$RUN" checkout -q -B main "origin/$REF"
echo "fork reset, $RUN cloned from $UPSTREAM at $(git -C "$RUN" log --oneline -1)"
