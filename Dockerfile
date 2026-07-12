# Scran — single container: FastAPI backend + built React frontend.
# Stage 1 builds the SPA; stage 2 is the slim Python runtime that serves
# both the API and the static files (spec §4.1: one container, no extras).

FROM node:26-alpine AS frontend-build
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.13-slim
WORKDIR /app

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
COPY --from=frontend-build /build/dist ./frontend-dist

# Both paths are volumes in docker-compose.yml — the whole backup story is
# "copy these two directories" (spec §4.1).
ENV SCRAN_DB_PATH=/data/scran.db \
    SCRAN_UPLOADS_PATH=/uploads \
    SCRAN_FRONTEND_DIST=/app/frontend-dist

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health', timeout=4)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
