FROM python:3.10-slim

ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH="/pacing"

WORKDIR /pacing
COPY pacing/ /pacing

RUN pip install --no-cache-dir -r requirements.txt


# CMD here is production default, can be overridden by docker-compose or command line
CMD ["uvicorn", "pacing.api.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
