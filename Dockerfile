FROM rust:1.97.0-slim-bookworm@sha256:6d220bf85c74e842a79da63997af8d2e74455c0b8847d8bb3a5888572334991d AS broker
WORKDIR /src
ENV RUSTUP_TOOLCHAIN=1.97.0 CARGO_INCREMENTAL=0
COPY Cargo.toml Cargo.lock ./
COPY core ./core
COPY broker ./broker
RUN cargo build --locked --release -p saathi-broker

FROM node:25-slim@sha256:81db02c4b671288a03915da9534dbd54f96d0e7c24d80ccc54f5b36b2e684370
LABEL org.opencontainers.image.source="https://github.com/akshatinnovate-png/Saathi-Alexa" org.opencontainers.image.description="Saathi: a companion for elders and the families who love them" org.opencontainers.image.licenses="MIT"
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 SAATHI_DATA_FILE=/data/saathi.json
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY --from=broker /src/target/release/saathi-broker ./bin/saathi-broker
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8787/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
USER node
CMD ["node", "src/index.js"]
