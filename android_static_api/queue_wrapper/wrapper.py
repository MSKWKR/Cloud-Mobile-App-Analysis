from flask import Flask, request, jsonify
from queue import Queue
from threading import Thread
import requests
import uuid
import os
import time

app = Flask(__name__)

# FIFO queue
job_queue = Queue()

ANDROGUARD_BASE = "http://android-static-backend:8010"


def worker_loop():
    while True:
        job = job_queue.get()
        job_id, file_bytes, filename, file_hash, response_holder = job
        try:
            # Step 1: upload APK
            files = {"file": (filename, file_bytes, "application/octet-stream")}
            print(f"[{job_id}] Uploading {filename}...")
            load_resp = requests.post(f"{ANDROGUARD_BASE}/load_apk", files=files)
            load_resp.raise_for_status()

            # Step 2: run Maldroid
            print(f"[{job_id}] Running Maldroid...")
            maldroid_resp = requests.post(f"{ANDROGUARD_BASE}/run_maldroid")
            maldroid_resp.raise_for_status()

            # Step 3: get JSON report
            print(f"[{job_id}] Retrieving JSON report...")
            json_resp = requests.get(f"{ANDROGUARD_BASE}/get_json", params={"hash": file_hash})
            json_resp.raise_for_status()

            response_holder["response"] = (json_resp.text, 200, {"Content-Type": "application/json"})

        except Exception as e:
            print(f"[{job_id}] Error: {e}")
            response_holder["response"] = (jsonify({"error": str(e)}), 500, {})
        finally:
            job_queue.task_done()


# Start worker thread
Thread(target=worker_loop, daemon=True).start()


@app.route("/analyze_apk", methods=["POST"])
def enqueue_job():
    """
    Accepts an APK file + hash, queues a full analysis pipeline.
    Blocks until the report is ready.
    """
    if "file" not in request.files or "hash" not in request.form:
        return jsonify({"error": "Missing file or hash"}), 400

    file = request.files["file"]
    file_bytes = file.read()
    filename = file.filename or "unknown.apk"
    file_hash = request.form["hash"]

    job_id = str(uuid.uuid4())
    response_holder = {}

    job_queue.put((job_id, file_bytes, filename, file_hash, response_holder))

    print(f"[{job_id}] Job queued for {filename}")

    # Wait for result
    while "response" not in response_holder:
        time.sleep(0.3)

    return response_holder["response"]


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001)
