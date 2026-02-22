#!/bin/bash
set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$REPO_DIR/apps/dokploy/.env"

echo "==> Setting up Dokploy for native Mac development"
echo "    Project: $REPO_DIR"
echo ""

# ── 1. Homebrew ──────────────────────────────────────────────────────────────
if ! command -v brew &>/dev/null; then
  echo "==> Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
else
  echo "✓ Homebrew already installed"
fi

# ── 2. Node.js ───────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null || [[ $(node --version | cut -d. -f1 | tr -d 'v') -lt 20 ]]; then
  echo "==> Installing Node.js via Homebrew..."
  brew install node
else
  echo "✓ Node.js $(node --version) already installed"
fi

# ── 3. pnpm ──────────────────────────────────────────────────────────────────
if ! command -v pnpm &>/dev/null; then
  echo "==> Installing pnpm..."
  npm install -g corepack
  corepack prepare pnpm@10.22.0 --activate
else
  echo "✓ pnpm $(pnpm --version) already installed"
fi

# ── 4. Postgres via Docker Desktop ───────────────────────────────────────────
echo ""
if nc -z localhost 5432 2>/dev/null; then
  echo "✓ Postgres already running on localhost:5432"
else
  echo "==> Starting Postgres container..."
  docker run -d \
    --name dokploy-postgres \
    --restart unless-stopped \
    -e POSTGRES_USER=dokploy \
    -e POSTGRES_PASSWORD=dokploy \
    -e POSTGRES_DB=dokploy \
    -p 5432:5432 \
    postgres:16-alpine
  echo -n "   Waiting for Postgres to be ready..."
  until docker exec dokploy-postgres pg_isready -U dokploy &>/dev/null; do
    sleep 1; echo -n "."
  done
  echo " ready"
fi

# ── 5. Redis via Docker Desktop ───────────────────────────────────────────────
if nc -z localhost 6379 2>/dev/null; then
  echo "✓ Redis already running on localhost:6379"
else
  echo "==> Starting Redis container..."
  docker run -d \
    --name dokploy-redis \
    --restart unless-stopped \
    -p 6379:6379 \
    redis:7-alpine
  sleep 2
  echo "✓ Redis started"
fi

# ── 6. Create .env for Mac (localhost hostnames) ──────────────────────────────
echo ""
echo "==> Writing apps/dokploy/.env..."
cat > "$ENV_FILE" << 'EOF'
DATABASE_URL="postgres://dokploy:dokploy@localhost:5432/dokploy"
REDIS_URL="redis://localhost:6379"
REDIS_HOST="localhost"
PORT=3000
NODE_ENV=development
EOF
echo "✓ .env written"

# ── 7. Install dependencies ───────────────────────────────────────────────────
echo ""
echo "==> Installing dependencies..."
cd "$REPO_DIR"
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install

# ── 8. Run migrations ─────────────────────────────────────────────────────────
echo ""
echo "==> Running database migrations..."
pnpm --filter dokploy migration:run

# ── 9. Done ───────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Setup complete! Postgres + Redis run in Docker Desktop"
echo "  independently of the devcontainer."
echo ""
echo "  To start the dev server:"
echo "    pnpm --filter dokploy dev"
echo ""
echo "  Then open: http://localhost:3000"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
