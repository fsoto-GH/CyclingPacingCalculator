FROM python:3.10-slim

ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH="/pacing"

# Install Node.js for building the frontend
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /pacing

# Build frontend
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci
COPY frontend/ ./frontend/

# Accept the feature-flag build arg and pass it to Vite
ARG VITE_ENABLE_SERVER_FUNCTIONS=false
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_ENABLE_SERVER_FUNCTIONS=${VITE_ENABLE_SERVER_FUNCTIONS}
ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL}
ENV VITE_SUPABASE_ANON_KEY=${VITE_SUPABASE_ANON_KEY}
RUN cd frontend && npm run build

# Install Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY pacing/ /pacing/pacing/

# CMD here is production default, can be overridden by docker-compose or command line
CMD ["uvicorn", "pacing.api.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
