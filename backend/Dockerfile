FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
COPY requirements.lock ./requirements.lock
RUN pip install --no-cache-dir -r requirements.lock
COPY . .
RUN useradd --create-home pxster && mkdir -p /srv/data && chown -R pxster:pxster /srv
USER pxster
EXPOSE 8000
CMD ["uvicorn", "pxster.api:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
