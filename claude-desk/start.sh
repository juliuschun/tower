#!/bin/bash
# Claude Desk 서버 시작 스크립트
cd "$(dirname "$0")"

export NO_AUTH=true
export DEFAULT_CWD=/home/azureuser
export WORKSPACE_ROOT=/home/azureuser

echo "Starting Claude Desk..."
echo "접속: http://localhost:32354"
echo "SSH 터널: ssh -L 32354:localhost:32354 azureuser@4.230.33.35"
echo ""

npx tsx backend/index.ts
