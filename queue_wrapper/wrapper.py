from flask import Flask, request, jsonify
from queue import Queue
from threading import Thread
import requests
import uuid
import os
import time
import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("/var/log/wrapper.log"),
    ],
)
log = logging.getLogger(__name__)

app = Flask(__name__)

# FIFO queue
job_queue = Queue()

ANDROGUARD_BASE = "http://android-static-backend:8010"


def worker_loop():
    while True:
        job = job_queue.get()
        job_id, file_bytes, filename, file_hash, response_holder = job
        log.info("[%s] Job started: %s (hash=%s)", job_id, filename, file_hash)
        try:
            # Step 1: upload APK
            files = {"file": (filename, file_bytes, "application/octet-stream")}
            log.info("[%s] Step 1/3 — Uploading %s (%d bytes)", job_id, filename, len(file_bytes))
            load_resp = requests.post(f"{ANDROGUARD_BASE}/load_apk", files=files)
            load_resp.raise_for_status()
            log.info("[%s] Step 1/3 — Upload complete (status=%d)", job_id, load_resp.status_code)

            # Step 2: run Maldroid
            log.info("[%s] Step 2/3 — Running Maldroid analysis", job_id)
            maldroid_resp = requests.post(f"{ANDROGUARD_BASE}/run_maldroid")
            maldroid_resp.raise_for_status()
            log.info("[%s] Step 2/3 — Maldroid analysis complete (status=%d)", job_id, maldroid_resp.status_code)

            # Step 3: get JSON report
            log.info("[%s] Step 3/3 — Retrieving JSON report", job_id)
            json_resp = requests.get(f"{ANDROGUARD_BASE}/get_json", params={"hash": file_hash})
            json_resp.raise_for_status()
            log.info("[%s] Step 3/3 — Report retrieved (status=%d, size=%d bytes)", job_id, json_resp.status_code, len(json_resp.content))

            response_holder["response"] = (json_resp.text, 200, {"Content-Type": "application/json"})
            log.info("[%s] Job completed successfully", job_id)

        except Exception as e:
            log.error("[%s] Job failed: %s", job_id, e, exc_info=True)
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
        log.warning("Request rejected: missing file or hash")
        return jsonify({"error": "Missing file or hash"}), 400

    file = request.files["file"]
    file_bytes = file.read()
    filename = file.filename or "unknown.apk"
    file_hash = request.form["hash"]

    job_id = str(uuid.uuid4())
    response_holder = {}

    job_queue.put((job_id, file_bytes, filename, file_hash, response_holder))
    log.info("[%s] Job queued for %s (queue depth=%d)", job_id, filename, job_queue.qsize())

    # Wait for result
    while "response" not in response_holder:
        time.sleep(0.3)

    log.info("[%s] Returning response to caller", job_id)
    return response_holder["response"]


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001)
