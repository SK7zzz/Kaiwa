# Verified 2026-10-08: Node 24.21.0. Digest prevents silent runtime upgrades.
FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS codex
ARG CODEX_VERSION=0.159.3
RUN npm install --global --omit=dev "@openai/codex@${CODEX_VERSION}" \
    && codex --version

# Verified 2026-10-08: Python 3.12.15.
FROM python:3.12-slim-bookworm@sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HOME=/home/kaiwa \
    CODEX_HOME=/home/kaiwa/.codex \
    KAIWA_DEPLOYMENT=production \
    KAIWA_DB_PATH=/app/data/kaiwa.db \
    KAIWA_TTS_CACHE_PATH=/app/data/tts_cache
RUN apt-get update \
    && apt-get install --no-install-recommends --yes tzdata libstdc++6 libatomic1 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 1000 kaiwa \
    && useradd --uid 1000 --gid kaiwa --create-home kaiwa \
    && mkdir -p /app/data /home/kaiwa/.codex '/home/kaiwa/Documents/Kaiwa Backups' \
    && chown -R kaiwa:kaiwa /app/data /home/kaiwa \
    && chmod 700 /home/kaiwa/.codex
COPY --from=codex /usr/local/bin/node /usr/local/bin/node
COPY --from=codex /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/@openai/codex/bin/codex.js /usr/local/bin/codex
WORKDIR /app
COPY requirements.lock ./requirements.lock
RUN pip install --no-cache-dir -r requirements.lock && pip check
COPY server ./server
COPY web ./web
COPY LICENSE ./LICENSE
USER 1000:1000
EXPOSE 8130
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8130/healthz', timeout=3).read()"
CMD ["python", "-m", "uvicorn", "server.main:app", "--host", "0.0.0.0", "--port", "8130", "--workers", "1", "--no-proxy-headers", "--lifespan", "on"]
