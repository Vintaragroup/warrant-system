FROM python:3.12-slim

WORKDIR /app

# Install dependencies first for better layer caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source
COPY . .

EXPOSE 8081

CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8081"]
