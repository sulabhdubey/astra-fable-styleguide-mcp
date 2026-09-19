FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate
COPY . .
RUN pnpm install --prod=false --frozen-lockfile

FROM deps AS build
RUN pnpm typecheck:full && pnpm test && pnpm validate && pnpm generate

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate
COPY --from=build /app /app
EXPOSE 3000
CMD ["pnpm","exec","tsx","apps/mcp-server/src/official-server.ts"]
