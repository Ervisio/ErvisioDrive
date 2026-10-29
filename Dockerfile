FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
ENV MONGOMS_DISABLE_POSTINSTALL=1
RUN npm ci --no-audit --no-fund

FROM dependencies AS builder
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
RUN groupadd --gid 1001 drive && useradd --uid 1001 --gid drive --create-home drive
COPY --from=builder --chown=drive:drive /app/.next/standalone ./
COPY --from=builder --chown=drive:drive /app/.next/static ./.next/static
COPY --chown=drive:drive scripts/ops.mjs scripts/start.mjs ./scripts/
USER drive
EXPOSE 3000
CMD ["node","scripts/start.mjs"]
