import os
import base64
import logging
import requests
from celery_app import celery

log = logging.getLogger(__name__)

ANDROGUARD_BASE = os.getenv("ANDROGUARD_BASE", "http://android-static-backend:8010")


@celery.task(bind=True)
def analyze_apk(self, file_bytes_b64: str, filename: str, file_hash: str):
    job_id = self.request.id
    file_bytes = base64.b64decode(file_bytes_b64)
    log.info("[%s] Job started: %s (hash=%s, size=%d bytes)", job_id, filename, file_hash, len(file_bytes))

    def update(step, total, message):
        log.info("[%s] Step %d/%d — %s", job_id, step, total, message)
        self.update_state(state="STARTED", meta={"step": step, "total": total, "message": message})

    # Step 1: upload APK
    update(1, 3, f"Uploading {filename} ({len(file_bytes)} bytes)")
    files = {"file": (filename, file_bytes, "application/octet-stream")}
    load_resp = requests.post(f"{ANDROGUARD_BASE}/load_apk", files=files)
    load_resp.raise_for_status()
    log.info("[%s] Step 1/3 — Upload complete (status=%d)", job_id, load_resp.status_code)

    # Step 2: run Maldroid
    update(2, 3, "Running Maldroid analysis")
    maldroid_resp = requests.post(f"{ANDROGUARD_BASE}/run_maldroid")
    maldroid_resp.raise_for_status()
    log.info("[%s] Step 2/3 — Maldroid complete (status=%d)", job_id, maldroid_resp.status_code)

    # Step 3: get JSON report
    update(3, 3, "Retrieving JSON report")
    json_resp = requests.get(f"{ANDROGUARD_BASE}/get_json", params={"hash": file_hash})
    json_resp.raise_for_status()
    log.info("[%s] Step 3/3 — Report retrieved (status=%d, size=%d bytes)", job_id, json_resp.status_code, len(json_resp.content))

    log.info("[%s] Job completed successfully", job_id)
    return json_resp.text
