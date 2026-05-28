#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Trigger Source Health Check via GitHub API
#
# Usage:
#   ./scripts/trigger-health-check.sh
#   GITHUB_TOKEN=ghp_xxx ./scripts/trigger-health-check.sh
#
# This script triggers the source-health.yml workflow via the GitHub API.
# Useful for forks where scheduled workflows are disabled.
#
# Setup:
#   1. Create a GitHub PAT with 'repo' scope:
#      https://github.com/settings/tokens
#   2. Set it as an environment variable or pass it to this script:
#      export GITHUB_TOKEN=ghp_your_token_here
#   3. Add to external cron (e.g. cron-job.org):
#      Schedule: every 8 hours
#      Command: curl -s -X POST \
#        -H "Authorization: token $GITHUB_TOKEN" \
#        -H "Accept: application/vnd.github.v3+json" \
#        https://api.github.com/repos/OWNER/REPO/actions/workflows/source-health.yml/dispatches \
#        -d '{"ref":"master"}'
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# Configuration — edit these for your repo
OWNER="${GITHUB_OWNER:-thegnsme}"
REPO="${GITHUB_REPO:-multisource-api}"
BRANCH="${GITHUB_BRANCH:-master}"
WORKFLOW="source-health.yml"

# Validate token
if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "❌ Error: GITHUB_TOKEN is not set."
  echo ""
  echo "Usage:"
  echo "  export GITHUB_TOKEN=ghp_your_token_here"
  echo "  ./scripts/trigger-health-check.sh"
  echo ""
  echo "Or:"
  echo "  GITHUB_TOKEN=ghp_xxx ./scripts/trigger-health-check.sh"
  echo ""
  echo "Create a token at: https://github.com/settings/tokens"
  echo "Required scope: repo"
  exit 1
fi

echo "📡 Triggering Source Health Check..."
echo "   Repo: ${OWNER}/${REPO}"
echo "   Branch: ${BRANCH}"
echo "   Workflow: ${WORKFLOW}"
echo ""

# Trigger the workflow
HTTP_CODE=$(curl -s -o /tmp/gh-response.json -w "%{http_code}" \
  -X POST \
  -H "Authorization: token ${GITHUB_TOKEN}" \
  -H "Accept: application/vnd.github.v3+json" \
  "https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches" \
  -d "{\"ref\":\"${BRANCH}\"}")

if [ "$HTTP_CODE" = "204" ]; then
  echo "✅ Workflow triggered successfully!"
  echo ""
  echo "Check the status at:"
  echo "  https://github.com/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}"
elif [ "$HTTP_CODE" = "404" ]; then
  echo "❌ Workflow not found. Check:"
  echo "   - Repo name: ${OWNER}/${REPO}"
  echo "   - Workflow file: .github/workflows/${WORKFLOW}"
  echo "   - Branch: ${BRANCH}"
  echo ""
  cat /tmp/gh-response.json 2>/dev/null || true
elif [ "$HTTP_CODE" = "403" ]; then
  echo "❌ Permission denied. Check your GITHUB_TOKEN has 'repo' scope."
  echo ""
  cat /tmp/gh-response.json 2>/dev/null || true
else
  echo "❌ Unexpected response (HTTP ${HTTP_CODE}):"
  cat /tmp/gh-response.json 2>/dev/null || true
  echo ""
fi

rm -f /tmp/gh-response.json
