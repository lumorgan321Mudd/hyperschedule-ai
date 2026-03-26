#!/bin/bash
# Hyperschedule+ Dev Startup Script
#
# Prerequisites: Node.js 18+ (https://nodejs.org)
# Everything else is handled automatically.
#
# Usage:
#   git clone https://github.com/hmc-ipai/hyperschedule-ai.git
#   cd hyperschedule-ai
#   git checkout hyperschedule-current
#   ./start-dev.sh
#
# This starts the backend (no MongoDB needed) and frontend,
# then opens the dev login page in your browser.

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}   Hyperschedule+ Dev Startup${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

# --- Check prerequisites ---

# Check we're in the right directory
if [ ! -d "backend" ] || [ ! -d "frontend" ]; then
    echo -e "${RED}Error:${NC} Run this script from the project root (the directory containing backend/ and frontend/)"
    echo "  cd into the repo folder first, then run ./start-dev.sh"
    exit 1
fi

# Check Node.js
if ! command -v node &>/dev/null; then
    echo -e "${RED}Error:${NC} Node.js is not installed."
    echo "  Install it from https://nodejs.org (version 18 or higher)"
    echo "  Or run: brew install node"
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}Error:${NC} Node.js 18+ is required (you have $(node -v))"
    echo "  Update from https://nodejs.org"
    exit 1
fi

# Ensure pnpm is available (use corepack if not installed)
if ! command -v pnpm &>/dev/null; then
    echo -e "${YELLOW}pnpm not found, enabling via corepack...${NC}"
    corepack enable
    if ! command -v pnpm &>/dev/null; then
        echo -e "${RED}Error:${NC} Could not install pnpm."
        echo "  Try: npm install -g pnpm"
        exit 1
    fi
fi

echo -e "${GREEN}Node.js $(node -v) + pnpm $(pnpm -v)${NC}"
echo ""

# --- Install dependencies ---

# Single pnpm install from root handles all workspaces (backend, frontend, shared)
if [ ! -d "node_modules" ] || [ ! -d "backend/node_modules" ] || [ ! -d "frontend/node_modules" ]; then
    echo -e "${YELLOW}Installing dependencies (first run may take a minute)...${NC}"
    pnpm install
    echo ""
fi

# --- Ports ---
BACKEND_PORT=8080
FRONTEND_PORT=3000

# Kill any existing processes on our ports
lsof -ti:$BACKEND_PORT | xargs kill 2>/dev/null || true
lsof -ti:$FRONTEND_PORT | xargs kill 2>/dev/null || true

# --- Start servers ---

# Start backend (static mode — no MongoDB required)
echo -e "${GREEN}Starting backend (static mode, no DB)...${NC}"
(cd backend && DB_URL="" pnpm serve) &
BACKEND_PID=$!

# Start frontend
echo -e "${GREEN}Starting frontend...${NC}"
(cd frontend && pnpm serve) &
FRONTEND_PID=$!

# Clean up both servers on exit
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM EXIT

# Wait for both servers to be ready
echo -e "${YELLOW}Waiting for servers to start...${NC}"
READY=false
for i in $(seq 1 60); do
    BACKEND_UP=false
    FRONTEND_UP=false
    curl -s -o /dev/null http://localhost:$BACKEND_PORT/v4/term/all 2>/dev/null && BACKEND_UP=true
    curl -s -o /dev/null http://localhost:$FRONTEND_PORT 2>/dev/null && FRONTEND_UP=true
    if $BACKEND_UP && $FRONTEND_UP; then
        READY=true
        break
    fi
    sleep 1
done

if ! $READY; then
    echo -e "${RED}Servers did not start within 60 seconds.${NC}"
    echo "Check the output above for errors."
    exit 1
fi

# --- Ready! ---

LOGIN_URL="http://localhost:$BACKEND_PORT/auth/dev-login"

echo ""
echo -e "${CYAN}========================================${NC}"
echo -e "${GREEN}  Servers are running!${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""
echo -e "  Backend:  ${CYAN}http://localhost:$BACKEND_PORT${NC}"
echo -e "  Frontend: ${CYAN}http://localhost:$FRONTEND_PORT${NC}"
echo ""
echo -e "  A browser window should open automatically."
echo -e "  If not, go to: ${CYAN}$LOGIN_URL${NC}"
echo ""
echo -e "  ${YELLOW}1.${NC} Enter any email (e.g. student@hmc.edu)"
echo -e "  ${YELLOW}2.${NC} Pick your college, click ${GREEN}Log In${NC}"
echo -e "  ${YELLOW}3.${NC} You'll be redirected to the app"
echo ""
echo -e "  To test as an advisor, select 'Advisor' from the Role dropdown."
echo ""
echo -e "  Press ${YELLOW}Ctrl+C${NC} to stop both servers."
echo ""

# Open browser
if command -v open &>/dev/null; then
    open "$LOGIN_URL"
elif command -v xdg-open &>/dev/null; then
    xdg-open "$LOGIN_URL"
fi

# Keep running until Ctrl+C
wait
