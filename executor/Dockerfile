FROM python:3.12-slim

WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ && rm -rf /var/lib/apt/lists/*

# Python deps
COPY executor/requirements.txt /app/executor/requirements.txt
RUN pip install --no-cache-dir -r executor/requirements.txt

# Copy source — executor + Python engine
COPY executor/ /app/executor/
COPY functions/python/ /app/functions/python/

# Non-root user
RUN useradd -m executor
USER executor

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"

CMD ["python3", "-m", "uvicorn", "executor.main:app", \
     "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
