FROM python:3.12-slim

WORKDIR /app

# build-essential needed for lru-dict (C extension, dep of web3)
# Includes gcc + libc-dev + make — required for compiling C extensions
RUN apt-get update && apt-get install -y --no-install-recommends build-essential && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
# Pillar invariant: fail the build if any safety self-check fails.
# These run at image build time so a broken contract NEVER reaches prod.
RUN python safety_contract.py --self-check
RUN python tests/test_scam_risk.py

RUN adduser --disabled-password --no-create-home appuser
USER appuser
CMD ["python", "main.py"]
