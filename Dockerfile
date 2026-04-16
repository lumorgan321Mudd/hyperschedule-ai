FROM node:20-slim AS base
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate
WORKDIR /app

# Install dependencies (NODE_ENV not set yet so devDependencies are included)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig-base.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY data/package.json data/
RUN pnpm install --frozen-lockfile

# Copy source
COPY shared/ shared/
COPY backend/ backend/
COPY frontend/ frontend/
COPY data/ data/

# Build frontend (PostCSS config required for CSS nesting/media queries)
RUN pnpm --filter hyperschedule-frontend run prod

# Runtime
ENV NODE_ENV=production
ENV PORT=8080
ENV PROCESS_NAME=hyperschedule-server
RUN mkdir -p /var/log/hyperschedule
EXPOSE 8080

WORKDIR /app/backend
CMD ["pnpm", "prod-node", "./src/index.ts"]
