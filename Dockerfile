FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Install dependencies first to maximize Docker layer cache reuse.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code.
COPY . .

# Create and use a non-root user for runtime safety.
RUN useradd --create-home --shell /bin/bash appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 10000

# Render provides PORT at runtime.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-10000}"]