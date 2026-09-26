#!/usr/bin/env bash
# Everything the walk needs, checked before it starts, in one screen.
#
#   bash preflight.sh
#
# Each line is OK, WARN or MISSING. A MISSING is something to ask the user for:
# the run cannot create a Developer Edition org, sign a browser into GitHub or
# grant a token scope on its own. Read the "Before starting" section of SKILL.md
# next to this output.
# shellcheck source-path=SCRIPTDIR
# shellcheck source=env.sh
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
say() { printf '%-26s %-8s %s\n' "$1" "$2" "$3"; }

echo "paths (override with the environment variables of env.sh)"
say "sfdx-hardis" "$([ -d "$HARDIS/.git" ] && echo OK || echo MISSING)" "$HARDIS"
say "course" "$([ -d "$COURSE/.git" ] && echo OK || echo MISSING)" "$COURSE"
say "vscode extension" "$([ -d "$SIBLINGS/vscode-sfdx-hardis/.git" ] && echo OK || echo WARN)" "$SIBLINGS/vscode-sfdx-hardis"
say "learner clone" "$([ -d "$RUN/.git" ] && echo OK || echo "(reset-fork.sh makes it)")" "$RUN"
say "logs" OK "$LOGS"

echo
echo "tools"
say "node" "$(node -v >/dev/null 2>&1 && echo OK || echo MISSING)" "$(node -v 2>/dev/null)"
say "git" "$(git --version >/dev/null 2>&1 && echo OK || echo MISSING)" "$(git --version 2>/dev/null)"
say "sf" "$(sf --version >/dev/null 2>&1 && echo OK || echo MISSING)" "$(sf --version 2>/dev/null | head -1)"
PLUGIN=$(sf plugins 2>/dev/null | grep -i 'sfdx-hardis' | head -1)
say "sfdx-hardis plugin" "$([ -n "$PLUGIN" ] && echo OK || echo MISSING)" "${PLUGIN:-not installed}"
case "$PLUGIN" in
*link*) echo "                           ^ a linked build: the walk tests your working copy, which is usually what you want mid-change" ;;
esac

echo
echo "github"
if gh auth status >/dev/null 2>&1; then
  say "gh auth" OK "$(gh api user -q .login 2>/dev/null)"
  SCOPES=$(gh auth status 2>&1 | grep -i 'Token scopes' | head -1)
  say "token scopes" "$(echo "$SCOPES" | grep -q workflow && echo OK || echo WARN)" "${SCOPES#*: }"
  echo "                           ^ 'repo' and 'workflow' are both needed: without workflow, pushing a branch that touches .github/workflows fails"
  say "fork" "$(gh repo view "$FORK" --json name >/dev/null 2>&1 && echo OK || echo MISSING)" "$FORK"
  if gh repo view "$FORK" --json name >/dev/null 2>&1; then
    say "  open PRs" "$([ "$(gh pr list -R "$FORK" --state open --json number -q 'length')" = "0" ] && echo OK || echo WARN)" "$(gh pr list -R "$FORK" --state open --json number -q 'length') open (reset-fork.sh closes them)"
    say "  branches" OK "$(gh api "repos/$FORK/branches" --paginate -q '.[].name' | tr '\n' ' ')"
    say "  secrets" OK "$(gh api "repos/$FORK/actions/secrets" -q '.secrets[].name' 2>/dev/null | tr '\n' ' ')"
  fi
else
  say "gh auth" MISSING "run: gh auth login  (scopes repo, workflow)"
fi

echo
echo "salesforce orgs (Level 3 needs two Developer Edition orgs: helios-prod and helios-preprod)"
sf org list --all --json 2>/dev/null | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  let j;try{j=JSON.parse(s)}catch{console.log("  sf org list failed");process.exit(0)}
  const r=j.result||{};
  const rows=[...(r.nonScratchOrgs||[]),...(r.scratchOrgs||[]),...(r.other||[])];
  const de=rows.filter(o=>/orgfarm|developer/i.test(o.instanceUrl||"")||/\.develop\./.test(o.instanceUrl||""));
  const show=(o)=>console.log(["  ",(o.alias||"(no alias)").padEnd(20),(o.connectedStatus||o.status||"?").slice(0,24).padEnd(26),o.isDevHub?"devhub":"      ",o.instanceUrl||o.username].join(" "));
  console.log("  Developer Edition orgs:");
  de.length?de.forEach(show):console.log("    none. Ask the user to sign one up at developer.salesforce.com/signup and connect it.");
  const scratch=(r.scratchOrgs||[]).filter(o=>/helios/.test(o.alias||""));
  console.log("  helios scratch orgs:");
  scratch.length?scratch.forEach(show):console.log("    none yet (Set up my training environment creates them)");
});'

for a in helios-prod helios-preprod; do
  if sf org display -o "$a" --json >/dev/null 2>&1; then
    # The single quotes are deliberate: the braces are JavaScript template
    # literals, not shell expansions.
    # shellcheck disable=SC2016
    LIM=$(sf org list limits -o "$a" --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);const f=n=>{const x=(j.result||[]).find(l=>l.name===n);return x?`${x.remaining}/${x.max}`:null};const api=f("DailyApiRequests")??f("TotalRequests")??"?";console.log(`DailyScratchOrgs ${f("DailyScratchOrgs")??"?"}  TotalRequests ${api}`)}catch{console.log("limits unreadable")}})')
    case "$LIM" in
    *" 0/"* | *"?"* | *unreadable*) VERDICT=WARN ;;
    *) VERDICT=OK ;;
    esac
    say "  $a limits" "$VERDICT" "$LIM"
  fi
done
echo "                           ^ a Developer Edition Dev Hub makes 6 scratch orgs a day and deleting one does not give the allowance back"

echo
echo "browser (the labs that end on a GitHub or Salesforce page are read in a signed-in browser)"
if curl -s --max-time 3 http://127.0.0.1:9222/json/version >/dev/null 2>&1; then
  say "chrome on CDP" OK "$(curl -s --max-time 3 http://127.0.0.1:9222/json/version | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).Browser)}catch{console.log("running")}})')"
else
  say "chrome on CDP" MISSING "port 9222"
  echo "                           ^ ask the user to start their own signed-in Chrome with:"
  echo '                             chrome.exe --remote-debugging-port=9222 --restore-last-session'
  echo "                             It must be the profile signed in to GitHub. Never automate a sign-in."
fi

echo
echo "course site"
say "live site" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 https://hardisgroupcom.github.io/sfdx-hardis-training/ | grep -q 200 && echo OK || echo WARN)" "https://hardisgroupcom.github.io/sfdx-hardis-training/"
say "course branch" OK "$(git -C "$COURSE" branch --show-current 2>/dev/null) @ $(git -C "$COURSE" log --oneline -1 2>/dev/null)"
# A site that answers 200 can still be days behind main: pages.yml refuses to
# publish when a --check of the derived files fails, and nothing else says so.
# On 2026-09-25 two merges in a row never went live.
PAGES=$(gh run list -R "$UPSTREAM" --workflow pages.yml --branch main -L 1 --json status,conclusion,headSha -q '.[0] | "\(.status) \(.conclusion) \(.headSha[0:7])"' 2>/dev/null || true)
MAIN=$(gh api "repos/$UPSTREAM/commits/main" -q '.sha[0:7]' 2>/dev/null || true)
case "$PAGES" in
"") say "site published" WARN "unknown: GitHub did not answer (see the github section above)" ;;
"completed success $MAIN") say "site published" OK "main @ $MAIN" ;;
"completed success "*) say "site published" WARN "last publish at ${PAGES##* }, main is $MAIN: the publish of main has not started yet" ;;
"completed failure "*) say "site published" MISSING "the last publish of main failed (${PAGES##* }): learners read an older course. gh run list -R $UPSTREAM --workflow pages.yml" ;;
completed*) say "site published" WARN "the last publish of main ended ${PAGES#completed }: check it. gh run list -R $UPSTREAM --workflow pages.yml" ;;
*) say "site published" WARN "a publish of main is running (${PAGES##* }): run preflight again in a few minutes" ;;
esac
echo
echo "The published site is what a learner reads. When the course working copy is"
echo "ahead of it, say so in the report: a fix that is not on main yet is not live."
