#!/usr/bin/env bash
# Read-only check of everything a run of this skill needs on this computer: tools, the sfdx-hardis
# and vscode-sfdx-hardis working copies, the .env settings, the provider logins and tokens, the
# Salesforce orgs. One line per item, OK / MISSING / WARN, and for each MISSING the command that
# fixes it. Nothing is created, nothing prints a token.
#
#   bash .claude/skills/promotion-branches-e2e/scripts/preflight.sh [--provider github|gitlab|azure|bitbucket]
#
# Without --provider every provider is checked. Exit code 1 when an item is MISSING.
set -uo pipefail
SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPTS_DIR/env-lib.sh"
e2e_defaults

ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
  --provider)
    ONLY="${2:-}"
    shift 2
    ;;
  *)
    echo "usage: preflight.sh [--provider github|gitlab|azure|bitbucket]"
    exit 2
    ;;
  esac
done
case "$ONLY" in "" | github | gitlab | azure | bitbucket) ;; *)
  echo "unknown provider $ONLY"
  exit 2
  ;;
esac

MISSING=0
WARNINGS=0
ok() { printf 'OK      %s\n' "$1"; }
missing() {
  printf 'MISSING %s\n        fix: %s\n' "$1" "$2"
  MISSING=$((MISSING + 1))
}
warn() {
  printf 'WARN    %s\n' "$1"
  WARNINGS=$((WARNINGS + 1))
}
wants() { [ -z "$ONLY" ] || [ "$ONLY" = "$1" ]; }
section() { printf '\n== %s\n' "$1"; }
json() {
  node -e "let s='';process.stdin.setEncoding('utf8').on('data',c=>s+=c).on('end',()=>{let d;try{d=JSON.parse(s)}catch(e){console.log('');return}const v=($1);console.log(v===undefined||v===null?'':v)})"
}
# Usage: http_code <out file> <curl args...>   (000 when the host cannot be reached)
http_code() {
  local out="$1"
  shift
  curl -sS -m 30 -o "$out" -w '%{http_code}' "$@" 2>/dev/null || true
}
TMPF="$(e2e_native_path "$E2E_TMP")/promo-e2e-preflight-$$.json"
trap 'rm -f "$TMPF"' EXIT
unreachable() { missing "$1: the host cannot be reached" "check the network, the proxy (HTTPS_PROXY) and the DNS, then run preflight.sh again"; }

# ------------------------------------------------------------------ tools
section "tools"
tool() {
  local name="$1" fix="$2"
  if command -v "$name" >/dev/null 2>&1; then ok "$name ($("$name" --version 2>/dev/null | head -1 | tr -d '\r'))"; else missing "$name not on PATH" "$fix"; fi
}
tool git "install Git (https://git-scm.com/downloads); on Windows run the scripts from Git Bash"
tool node "install Node.js 20 or later (https://nodejs.org)"
tool yarn "npm install -g yarn"
tool sf "npm install -g @salesforce/cli"
tool curl "install curl (shipped with Git Bash, macOS and most Linux)"
if command -v python >/dev/null 2>&1 || command -v python3 >/dev/null 2>&1; then
  if command -v python >/dev/null 2>&1; then ok "python ($(python --version 2>&1 | tr -d '\r'))"; else
    missing "python3 is there but the scripts call python" "make python point to python3 (Debian/Ubuntu: sudo apt install python-is-python3)"
  fi
else
  missing "python not on PATH (the GitLab, Azure and Bitbucket libraries build JSON with it)" "install Python 3 (https://www.python.org/downloads/)"
fi
wants github && tool gh "install the GitHub CLI (https://cli.github.com)"
wants gitlab && tool glab "install the GitLab CLI (https://gitlab.com/gitlab-org/cli#installation)"
if command -v shellcheck >/dev/null 2>&1; then ok "shellcheck (for the syntax checks of runbook section 8quater)"; else warn "shellcheck not on PATH: only needed for the syntax checks of runbook section 8quater"; fi

# ------------------------------------------------------------------ working copies
section "working copies"
if [ -f "$E2E_ENV_FILE" ]; then ok ".env at $E2E_ENV_FILE"; else
  missing ".env not found at $E2E_ENV_FILE" "copy the .env of your other computer there (names: reference/env.example), or export the variables by hand"
fi
if [ -d "$E2E_ROOT/node_modules" ]; then ok "sfdx-hardis dependencies installed ($E2E_ROOT/node_modules)"; else
  missing "sfdx-hardis dependencies not installed" "cd \"$E2E_ROOT\" && yarn install"
fi
if [ -d "$E2E_ROOT/node_modules" ]; then
  version=$(cd "$E2E_ROOT" && env -u NODE_OPTIONS node "$DEV" --version 2>/dev/null | head -1 | tr -d '\r')
  if [ -n "$version" ]; then ok "bin/dev.js runs: $version (branch $(git -C "$E2E_ROOT" branch --show-current))"; else
    missing "bin/dev.js does not run ($DEV)" "cd \"$E2E_ROOT\" && yarn install && yarn compile, then: node bin/dev.js --version"
  fi
fi
if [ -d "$EXT/.git" ] || [ -f "$EXT/.git" ]; then
  ok "vscode-sfdx-hardis cloned at $EXT (branch $(git -C "$EXT" branch --show-current))"
  if [ -d "$EXT/out" ] && [ -d "$EXT/node_modules" ]; then ok "vscode-sfdx-hardis compiled (out/ present)"; else
    missing "vscode-sfdx-hardis not compiled (no out/ or no node_modules)" "cd \"$EXT\" && yarn install && yarn compile"
  fi
else
  missing "vscode-sfdx-hardis not cloned at $EXT (the pipeline, diagram and PR modal checks need it)" \
    "git clone https://github.com/hardisgroupcom/vscode-sfdx-hardis.git \"$EXT\" && cd \"$EXT\" && yarn install && yarn compile"
fi
case "$E2E_TMP" in *" "*) warn "the temp dir has a space ($E2E_TMP): set E2E_TMP, or WORK and LOGS, to a path without one" ;; *) ok "work folders under $E2E_TMP" ;; esac

# ------------------------------------------------------------------ Salesforce orgs
section "Salesforce orgs"
org_check() {
  local var="$1" what="$2" required="$3" value="${!1:-}" answer status
  if [ -z "$value" ]; then
    if [ "$required" = "required" ]; then missing "$var is not set ($what)" "add $var=<username or alias> to .env"; else warn "$var is not set ($what): the steps that need it are skipped"; fi
    return
  fi
  answer=$(env -u NODE_OPTIONS sf org display --target-org "$value" --json 2>/dev/null)
  status=$(printf '%s' "$answer" | json 'd.result&&d.result.connectedStatus')
  if [ "$status" = "Connected" ] || [ "$(printf '%s' "$answer" | json 'd.status===0&&d.result&&d.result.accessToken?"yes":""')" = "yes" ]; then
    ok "$var connected ($what)"
    if [ "$var" = "DEVHUB" ] && [ "$(env -u NODE_OPTIONS sf org list --json 2>/dev/null | json "[...(d.result.devHubs||[])].some(o=>o.username==='$value'||o.alias==='$value')?'yes':''")" != "yes" ]; then
      warn "DEVHUB $value is not known as a Dev Hub by sf org list: enable Dev Hub in that org for the backpromote scratch orgs"
    fi
  else
    if [ "$required" = "required" ]; then missing "$var ($value) is not connected ($what)" "sf org login web --alias $value"; else
      warn "$var ($value) is not connected ($what): sf org login web --alias $value, or create it (backpromote-setup.sh creates DEVORG and DEVORG2 from DEVHUB)"
    fi
  fi
}
org_check E2E_ORG "the org every major branch deploys to" required
DEVHUB="${DEVHUB:-$ORG}"
org_check DEVHUB "Dev Hub of the backpromote scratch orgs, section 6bis (default: E2E_ORG)" optional
org_check DEV_ORG "developer org of sections 6quater D and 6sexies I7" optional

# ------------------------------------------------------------------ GitHub
if wants github; then
  section "GitHub"
  if gh auth status >/dev/null 2>&1; then
    ok "gh logged in as $(gh api user --jq .login 2>/dev/null)"
    scopes=$(gh auth status 2>&1 | grep -i "token scopes" | tr -d '\r')
    case "$scopes" in *delete_repo*) ok "gh token can delete the test repositories" ;; *) warn "gh token without delete_repo: section 9 cleanup needs gh auth refresh -h github.com -s delete_repo" ;; esac
  else
    missing "gh is not logged in" "gh auth login (an account that can create private repositories)"
  fi
fi

# ------------------------------------------------------------------ GitLab
if wants gitlab; then
  section "GitLab"
  if [ -z "${GITLAB_E2E_HOST:-}" ] || [ -z "${GITLAB_E2E_GROUP:-}" ]; then
    missing "GITLAB_E2E_HOST or GITLAB_E2E_GROUP not set" "add GITLAB_E2E_HOST=<host> and GITLAB_E2E_GROUP=<group/path> to .env"
  else
    host="${GITLAB_E2E_HOST#https://}"
    host="${host#http://}"
    host="${host%/}"
    token="${GL_TOKEN:-$(glab config get token --host "$host" 2>/dev/null)}"
    if [ -z "$token" ]; then
      missing "glab has no token for $host" "glab auth login --hostname $host (a token with the api scope)"
    else
      code=$(http_code "$TMPF" -H "PRIVATE-TOKEN: $token" "https://$host/api/v4/user")
      case "$code" in
      200) ok "GitLab token of $host answers as $(json 'd.username' <"$TMPF")" ;;
      000) unreachable "https://$host" ;;
      *) missing "the GitLab token of $host answers HTTP $code" "glab auth login --hostname $host (a token with the api scope)" ;;
      esac
      if [ "$code" = "200" ]; then
        group=$(node -e "console.log(encodeURIComponent(process.argv[1]))" "$GITLAB_E2E_GROUP")
        code=$(http_code "$TMPF" -H "PRIVATE-TOKEN: $token" "https://$host/api/v4/groups/$group")
        if [ "$code" = "200" ]; then
          gid=$(json 'd.id' <"$TMPF")
          ok "group $GITLAB_E2E_GROUP readable (id $gid)"
          tag="${GITLAB_RUNNER_TAG:-ubuntu}"
          runners=$(curl -sS -m 30 -H "PRIVATE-TOKEN: $token" "https://$host/api/v4/groups/$gid/runners?per_page=100&status=online" | json 'd.map(r=>r.id).join(" ")')
          found=""
          for id in $runners; do
            if [ "$(curl -sS -m 30 -H "PRIVATE-TOKEN: $token" "https://$host/api/v4/runners/$id" | TAG="$tag" json "(d.tag_list||[]).includes(process.env.TAG)||d.run_untagged===true?'yes':''")" = "yes" ]; then
              found=$id
              break
            fi
          done
          if [ -n "$found" ]; then ok "an online runner of the group takes jobs tagged $tag (runner $found)"; else
            missing "no online runner of $GITLAB_E2E_GROUP takes jobs tagged $tag" "ask the group owner to start one, or set GITLAB_RUNNER_TAG to a tag an online runner has"
          fi
        else
          missing "group $GITLAB_E2E_GROUP answers HTTP $code" "check GITLAB_E2E_GROUP in .env and that your account can create projects in it"
        fi
      fi
    fi
  fi
fi

# ------------------------------------------------------------------ Azure DevOps
if wants azure; then
  section "Azure DevOps"
  token="${AZ_TOKEN:-${AZURE_PERSONAL_ACCESS_TOKEN:-}}"
  if [ -z "${AZ_ORG:-}" ] || [ -z "${AZ_PROJECT:-}" ] || [ -z "$token" ]; then
    missing "AZ_ORG, AZ_PROJECT or AZURE_PERSONAL_ACCESS_TOKEN not set" "add them to .env (the PAT: https://dev.azure.com/<AZ_ORG>/_usersSettings/tokens)"
  else
    base="https://dev.azure.com/$AZ_ORG"
    code=$(http_code "$TMPF" -u ":$token" "$base/_apis/connectionData")
    case "$code" in
    200)
      ok "PAT answers in $AZ_ORG as $(json 'd.authenticatedUser&&d.authenticatedUser.providerDisplayName' <"$TMPF")"
      ;;
    000) unreachable "$base" ;;
    *) missing "the PAT answers HTTP $code in $AZ_ORG" "create a PAT (Code: Read, write & manage; Build: Read & execute; Pull Request Threads: Read & write) and put it in AZURE_PERSONAL_ACCESS_TOKEN" ;;
    esac
    if [ "$code" = "200" ]; then
      project_url="$base/$(node -e "console.log(encodeURIComponent(process.argv[1]))" "$AZ_PROJECT")"
      code=$(http_code "$TMPF" -u ":$token" "$base/_apis/projects/${project_url##*/}?api-version=7.1")
      if [ "$code" = "200" ]; then
        project_id=$(json 'd.id' <"$TMPF")
        ok "team project $AZ_PROJECT ($(json 'd.visibility' <"$TMPF"))"
      else
        missing "team project $AZ_PROJECT answers HTTP $code" "check AZ_PROJECT in .env"
      fi
      code=$(http_code "$TMPF" -u ":$token" "$project_url/_apis/git/repositories?api-version=7.1")
      if [ "$code" = "200" ]; then ok "PAT reads the repositories (Code scope)"; else missing "the PAT cannot list repositories (HTTP $code)" "give the PAT the Code (Read, write & manage) scope"; fi
      code=$(http_code "$TMPF" -u ":$token" "$project_url/_apis/pipelines?api-version=7.1")
      if [ "$code" = "200" ]; then ok "PAT reads pipelines (Build scope; real CI also needs Read & execute, proven on the first run)"; else
        missing "the PAT cannot read pipelines (HTTP $code): real CI (section 6quinquies) needs it" "give the PAT the Build (Read & execute) scope"
      fi
      code=$(http_code "$TMPF" -u ":$token" "$base/_apis/distributedtask/resourceusage?parallelismTag=Private&poolIsHosted=true&includeRunningRequests=true&api-version=7.1-preview.1")
      if [ "$code" = "200" ]; then
        total=$(json 'd.resourceLimit&&d.resourceLimit.totalCount' <"$TMPF")
        if [ "${total:-0}" -ge 1 ] 2>/dev/null; then ok "$total Microsoft-hosted parallel job(s) for private projects"; else
          missing "no Microsoft-hosted parallel job for private projects" "request the free grant: https://aka.ms/azpipelines-parallelism-request (or buy one in Organization settings > Billing)"
        fi
      else
        warn "hosted parallel jobs not readable with this PAT (HTTP $code): check Organization settings > Parallel jobs shows 1 Microsoft-hosted job for private projects"
      fi
      if [ "${AZURE_E2E_CI_TOKEN:-system}" = "system" ] && [ -n "${project_id:-}" ]; then
        # The entry of the project build service in the access control list of the project repositories
        code=$(http_code "$TMPF" -u ":$token" -G "$base/_apis/accesscontrollists/2e9eb7ed-3c0a-47d4-87c1-0ffdd275fd87" \
          --data-urlencode "token=repoV2/$project_id" --data-urlencode "includeExtendedInfo=true" --data-urlencode "api-version=7.1")
        if [ "$code" = "200" ]; then
          allowed=$(PROJECT="$project_id" json "(()=>{const a=((d.value||[])[0]||{}).acesDictionary||{};const k=Object.keys(a).find(k=>k.startsWith('Microsoft.TeamFoundation.ServiceIdentity;')&&k.endsWith(':Build:'+process.env.PROJECT));if(!k)return'not found';const x=a[k].extendedInfo||{};return((a[k].allow|(x.inheritedAllow||0)|(x.effectiveAllow||0))&16384)?'yes':'not allowed'})()" <"$TMPF")
          case "$allowed" in
          yes) ok "the project build service may contribute to pull requests on every repository" ;;
          *) warn "the build service '$AZ_PROJECT Build Service ($AZ_ORG)' may not contribute to pull requests on all repositories ($allowed), and the jobs post their comments with it: the run grants it on its own repository when the PAT has Security (Manage); else allow it once in Project settings > Repositories > Security > that identity > Contribute to pull requests, or run with AZURE_E2E_CI_TOKEN=pat" ;;
          esac
        else
          warn "the build service permission is not readable with this PAT (HTTP $code): the run grants it if the PAT has Security (Manage), else allow once 'Contribute to pull requests' to '$AZ_PROJECT Build Service ($AZ_ORG)' in Project settings > Repositories > Security"
        fi
      fi
    fi
  fi
fi

# ------------------------------------------------------------------ Bitbucket Cloud
if wants bitbucket; then
  section "Bitbucket Cloud"
  token="${BB_TOKEN:-${ATLASSIAN_TOKEN:-}}"
  email="${BB_EMAIL-${ATLASSIAN_EMAIL:-}}"
  if [ -z "${BB_WORKSPACE:-}" ] || [ -z "${BB_PROJECT_KEY:-}" ] || [ -z "$token" ]; then
    missing "BB_WORKSPACE, BB_PROJECT_KEY or ATLASSIAN_TOKEN not set" "add them (and ATLASSIAN_EMAIL) to .env; the token: an Atlassian API token WITH Bitbucket scopes (https://id.atlassian.com/manage-profile/security/api-tokens)"
  else
    if [ -n "$email" ]; then auth=(-u "$email:$token"); else auth=(-H "Authorization: Bearer $token"); fi
    code=$(http_code "$TMPF" "${auth[@]}" "https://api.bitbucket.org/2.0/user")
    case "$code" in
    200) ok "Atlassian token answers as $(json 'd.display_name' <"$TMPF")" ;;
    000) unreachable "https://api.bitbucket.org" ;;
    *) missing "the Atlassian token answers HTTP $code on /2.0/user" "create an API token with Bitbucket scopes (repository, pull request, pipeline read/write) and set ATLASSIAN_TOKEN and ATLASSIAN_EMAIL" ;;
    esac
    if [ "$code" = "200" ]; then
      code=$(http_code "$TMPF" "${auth[@]}" "https://api.bitbucket.org/2.0/workspaces/$BB_WORKSPACE/projects/$BB_PROJECT_KEY")
      if [ "$code" = "200" ]; then ok "workspace $BB_WORKSPACE, project $BB_PROJECT_KEY"; else missing "project $BB_PROJECT_KEY of $BB_WORKSPACE answers HTTP $code" "check BB_WORKSPACE and BB_PROJECT_KEY in .env"; fi
      code=$(http_code "$TMPF" "${auth[@]}" "https://api.bitbucket.org/2.0/repositories/$BB_WORKSPACE?pagelen=1")
      if [ "$code" = "200" ]; then ok "the token lists the repositories of $BB_WORKSPACE"; else missing "the token cannot list the repositories of $BB_WORKSPACE (HTTP $code)" "give the token the repository read/write/admin scopes"; fi
      warn "build minutes left in $BB_WORKSPACE cannot be read through the API: the real CI run falls back to the simulator when they are used up (Workspace settings > Plan details shows them)"
    fi
  fi
fi

printf '\n%s MISSING, %s WARN\n' "$MISSING" "$WARNINGS"
[ "$MISSING" -eq 0 ]
