FROM python:3.12.14-slim@sha256:2f17fc044b579bab302c2e8054d3a686e2cb9a83de48e70534b94cd8ebbe06a9
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 XDS_DATA_DIR=/data XDS_VERSION_FILE=/app/version.json
WORKDIR /app
COPY services/api/requirements.txt ./requirements.txt
# Change control runs the Git command line (ADR-0039).
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir -r requirements.txt && useradd --uid 10001 --create-home studio && mkdir /data && chown studio:studio /data
COPY services/api/src ./src
COPY release/version.json ./version.json
USER studio
EXPOSE 8000
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
