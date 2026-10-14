FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY pulse_api ./pulse_api
ENV PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["uvicorn", "pulse_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
