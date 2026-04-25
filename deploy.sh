#!/bin/bash
# ============================================================
# AI 落地页系统 - 一键部署脚本
# 使用方法: bash deploy.sh
# 需要: Node.js, wrangler CLI, Cloudflare API Token
# ============================================================

set -e

ACCOUNT_ID="53b7b68edccc6370375ce7cfa9eb8300"
DB_ID="6161ace2-20d0-442b-98f4-d98c7c28216d"
KV_ID="00366001e70f4fc9b12daab1f7cba4c8"
WORKER_NAME="aiclawchuhai-api"

echo "========================================"
echo "  AI 落地页系统 - 自动部署脚本"
echo "========================================"
echo ""

# Check wrangler
if ! command -v wrangler &> /dev/null; then
  echo "安装 wrangler..."
  npm install -g wrangler
fi

echo "✓ wrangler 版本: $(wrangler --version)"

# ─── Step 1: Build Worker ────────────────────────────────────
echo ""
echo "[1/4] 构建 Worker..."
cd worker
npm install
npx esbuild src/index.js --bundle --format=esm --platform=browser --outfile=dist/worker.js
echo "✓ Worker 构建完成 ($(wc -c < dist/worker.js) bytes)"
cd ..

# ─── Step 2: Deploy Worker via API ───────────────────────────
echo ""
echo "[2/4] 部署 Worker..."
python3 - <<'EOF'
import json, requests, os, sys

token = os.environ.get('CLOUDFLARE_API_TOKEN', '')
if not token:
    print("❌ 请设置 CLOUDFLARE_API_TOKEN 环境变量")
    sys.exit(1)

account_id = "53b7b68edccc6370375ce7cfa9eb8300"
worker_name = "aiclawchuhai-api"

with open('worker/dist/worker.js') as f:
    code = f.read()

metadata = {
    "main_module": "worker.js",
    "compatibility_date": "2024-01-01",
    "compatibility_flags": ["nodejs_compat"],
    "bindings": [
        {"type": "d1", "name": "DB", "id": "6161ace2-20d0-442b-98f4-d98c7c28216d"},
        {"type": "kv_namespace", "name": "KV", "namespace_id": "00366001e70f4fc9b12daab1f7cba4c8"}
    ]
}

url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/workers/scripts/{worker_name}"
files = [
    ('metadata', ('metadata', json.dumps(metadata), 'application/json')),
    ('worker.js', ('worker.js', code, 'application/javascript+module')),
]
headers = {"Authorization": f"Bearer {token}"}
r = requests.put(url, files=files, headers=headers)
result = r.json()
if result.get('success'):
    print(f"✅ Worker 部署成功: https://{worker_name}.joey2023yya.workers.dev")
else:
    print("❌ 部署失败:", json.dumps(result))
    sys.exit(1)
EOF

# ─── Step 3: Set Worker Secrets ──────────────────────────────
echo ""
echo "[3/4] 配置 Worker Secrets..."
echo "请手动在 Cloudflare 控制台设置以下 Secrets:"
echo "  - ADMIN_PASSWORD_HASH: SHA256(your_password)"
echo "  - JWT_SECRET: 随机32字节hex字符串"
echo "  - GOOGLE_SERVICE_ACCOUNT: Google服务账号JSON (可选，用于Google收录)"
echo ""
echo "或运行以下命令:"
echo "  wrangler secret put ADMIN_PASSWORD_HASH"
echo "  wrangler secret put JWT_SECRET"

# ─── Step 4: Deploy Frontend ─────────────────────────────────
echo ""
echo "[4/4] 部署前端到 Cloudflare Pages..."
CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN}" npx wrangler pages deploy frontend \
  --project-name aiclawchuhai-admin \
  --branch main 2>&1

echo ""
echo "========================================"
echo "  ✅ 部署完成!"
echo "========================================"
echo ""
echo "Worker API:  https://aiclawchuhai-api.joey2023yya.workers.dev"
echo "管理面板:    https://aiclawchuhai-admin.pages.dev"
echo ""
echo "⚠️  首次使用请登录管理面板修改默认密码"
