import base64
import logging
from flask import Flask, request, jsonify
from tasks import analyze_apk

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


@app.route("/analyze_apk", methods=["POST"])
def enqueue_job():
    if "file" not in request.files or "hash" not in request.form:
        log.warning("Request rejected: missing file or hash")
        return jsonify({"error": "Missing file or hash"}), 400

    file = request.files["file"]
    file_bytes = file.read()
    filename = file.filename or "unknown.apk"
    file_hash = request.form["hash"]

    task = analyze_apk.delay(
        base64.b64encode(file_bytes).decode(),
        filename,
        file_hash,
    )
    log.info("Job %s queued for %s", task.id, filename)
    return jsonify({"job_id": task.id}), 202


@app.route("/status/<job_id>", methods=["GET"])
def job_status(job_id):
    task = analyze_apk.AsyncResult(job_id)

    if task.state == "PENDING":
        return jsonify({"status": "pending"})

    if task.state == "STARTED":
        meta = task.info or {}
        return jsonify({
            "status": "running",
            "step": meta.get("step"),
            "total": meta.get("total"),
            "message": meta.get("message"),
        })

    if task.state == "SUCCESS":
        return jsonify({"status": "success", "result": task.result})

    if task.state == "FAILURE":
        log.error("Job %s failed: %s", job_id, task.info)
        return jsonify({"status": "failed", "error": str(task.info)}), 500

    return jsonify({"status": task.state.lower()})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001)
