FROM python:3.11.8-slim

WORKDIR /app
COPY . /app

RUN pip install --no-cache-dir -r requirements.txt

EXPOSE 5002
CMD ["python", "-u", "wrapper.py"]