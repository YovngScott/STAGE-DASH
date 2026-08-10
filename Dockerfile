FROM node:24-slim AS build

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM node:24-slim AS runtime

ARG FLYCTL_VERSION=0.4.79
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl tar \
  && curl -fsSL "https://github.com/superfly/flyctl/releases/download/v${FLYCTL_VERSION}/flyctl_${FLYCTL_VERSION}_Linux_x86_64.tar.gz" \
    | tar -xz -C /usr/local/bin flyctl \
  && ln -s /usr/local/bin/flyctl /usr/local/bin/fly \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /app/.output ./.output

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080

EXPOSE 8080
CMD ["node", ".output/server/index.mjs"]
