#!/bin/bash
# Hyperschedule+ Dev Startup Script
# Run this from the project root (the 'kyiv' directory)
#
# Usage: ./start-dev.sh
#
# This starts the backend (no MongoDB needed) and frontend,
# then opens the dev login page in your browser.

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}   Hyperschedule+ Dev Startup${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

# Check we're in the right directory
if [ ! -d "backend" ] || [ ! -d "frontend" ]; then
    echo "Error: Run this script from the project root (the directory containing backend/ and frontend/)"
    exit 1
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Installing root dependencies...${NC}"
    pnpm install
fi
if [ ! -d "backend/node_modules" ]; then
    echo -e "${YELLOW}Installing backend dependencies...${NC}"
    (cd backend && pnpm install)
fi
if [ ! -d "frontend/node_modules" ]; then
    echo -e "${YELLOW}Installing frontend dependencies...${NC}"
    (cd frontend && pnpm install)
fi

# Ports
BACKEND_PORT=8080
FRONTEND_PORT=3000

# Kill any existing processes on our ports
lsof -ti:$BACKEND_PORT | xargs kill 2>/dev/null || true
lsof -ti:$FRONTEND_PORT | xargs kill 2>/dev/null || true

# Start backend (static mode — no MongoDB required)
echo -e "${GREEN}Starting backend (static mode, no DB)...${NC}"
(cd backend && DB_URL="" pnpm serve) &
BACKEND_PID=$!

# Start frontend
echo -e "${GREEN}Starting frontend...${NC}"
(cd frontend && pnpm serve) &
FRONTEND_PID=$!

# Wait for both servers to be ready
echo -e "${YELLOW}Waiting for servers to start...${NC}"
for i in $(seq 1 30); do
    BACKEND_UP=false
    FRONTEND_UP=false
    curl -s -o /dev/null http://localhost:$BACKEND_PORT/v4/term/all 2>/dev/null && BACKEND_UP=true
    curl -s -o /dev/null http://localhost:$FRONTEND_PORT 2>/dev/null && FRONTEND_UP=true
    if $BACKEND_UP && $FRONTEND_UP; then
        break
    fi
    sleep 1
done

echo ""
echo -e "${CYAN}========================================${NC}"
echo -e "${GREEN}  Servers are running!${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""
echo -e "  Backend:  ${CYAN}http://localhost:8080${NC}"
echo -e "  Frontend: ${CYAN}http://localhost:${FRONTEND_PORT}${NC}"
echo ""
echo -e "  ${YELLOW}Step 1:${NC} Open the login page:"
echo -e "    ${CYAN}http://localhost:8080/auth/dev-login?redirect=http://localhost:${FRONTEND_PORT}/${NC}"
echo ""
echo -e "  ${YELLOW}Step 2:${NC} Enter any email (e.g. student@hmc.edu), pick a college, click Log In"
echo -e "  ${YELLOW}Step 3:${NC} You'll be redirected to the app automatically"
echo ""
echo -e "  To log in as an advisor, select 'Advisor' from the Role dropdown"
echo ""
echo -e "  Press ${YELLOW}Ctrl+C${NC} to stop both servers"
echo ""

# Open browser (works on macOS)
if command -v open &>/dev/null; then
    open "http://localhost:8080/auth/dev-login?redirect=http://localhost:${FRONTEND_PORT}/"
fi

# Wait for Ctrl+C
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait
