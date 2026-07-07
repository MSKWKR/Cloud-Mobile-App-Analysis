"""
Worker Lambda -- async-invoked by the API function (Celery task replacement).

It reproduces queue_wrapper/tasks.py in-process:
  1. pull the APK from S3
  2. POST /load_apk        (androguard AnalyzeAPK, sets global a/d/dx)
  3. POST /run_maldroid    (spawns python2 maldroid_main.py -> Reports/<hash>_static.json)
  4. GET  /get_json        (returns the report)

androguard_server.py is a blocking Flask app, so it's started once per warm
container in a background thread. Everything the server and the python2
subprocess write uses relative paths, so we chdir into /tmp/work (Lambda's only
writable dir) and copy the two read-only data files there -- no source edits to
the 3600-line server or 5500-line maldroid script required.

Event: {"job_id","bucket","key","hash","filename"}
Env: ANDROGUARD_PORT (default 8010), SERVER_READY_TIMEOUT (default 60)
"""

import os
import sys
import time
import socket
import shutil
import threading

import boto3
import requests

# App code (androguard_server.py, maldroid_main.py, data files) lives one level
# up from this lambda/ directory. Put it on sys.path so we can import the server.
APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if APP_ROOT not in sys.path:
    sys.path.insert(0, APP_ROOT)

import jobstore  # noqa: E402

PORT = int(os.getenv("ANDROGUARD_PORT", "8010"))
READY_TIMEOUT = int(os.getenv("SERVER_READY_TIMEOUT", "60"))
BASE = "http://127.0.0.1:{}".format(PORT)
WORK_DIR = "/tmp/work"
DATA_FILES = ("android_static_en.json", "android_static_zhtw.json")

_s3 = boto3.client("s3")
_server_lock = threading.Lock()
_server_started = False


def _prepare_workdir():
    """Create the writable work dir and seed it with read-only data files."""
    os.makedirs(os.path.join(WORK_DIR, "uploads"), exist_ok=True)
    os.makedirs(os.path.join(WORK_DIR, "Reports"), exist_ok=True)
    for name in DATA_FILES:
        dst = os.path.join(WORK_DIR, name)
        if not os.path.exists(dst):
            shutil.copy(os.path.join(APP_ROOT, name), dst)
    os.chdir(WORK_DIR)


def _port_open():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(0.5)
    try:
        return s.connect_ex(("127.0.0.1", PORT)) == 0
    finally:
        s.close()


def _ensure_server():
    """Start androguard_server.py in a background thread, once per container."""
    global _server_started
    with _server_lock:
        if _server_started and _port_open():
            return
        if not _server_started:
            import androguard_server

            def _run():
                # run_androguard_server(port, apk_path) calls app.run() (blocking).
                androguard_server.run_androguard_server(PORT, None)

            threading.Thread(target=_run, daemon=True).start()
            _server_started = True

        deadline = time.time() + READY_TIMEOUT
        while time.time() < deadline:
            if _port_open():
                return
            time.sleep(0.25)
        raise RuntimeError("androguard server did not open port {} within {}s".format(PORT, READY_TIMEOUT))


def handler(event, context):
    job_id = event["job_id"]
    bucket = event["bucket"]
    key = event["key"]
    file_hash = event["hash"]
    filename = event.get("filename") or os.path.basename(key) or "app.apk"

    try:
        _prepare_workdir()

        jobstore.set_running(job_id, 1, 3, "Downloading {} from s3".format(filename))
        apk_local = os.path.join(WORK_DIR, "uploads", filename)
        _s3.download_file(bucket, key, apk_local)

        _ensure_server()

        # Step 1: upload APK to the analysis server (analyze + set globals)
        jobstore.set_running(job_id, 1, 3, "Loading APK ({} bytes)".format(os.path.getsize(apk_local)))
        with open(apk_local, "rb") as fh:
            files = {"file": (filename, fh, "application/octet-stream")}
            r = _post_with_retry("/load_apk", files=files)
        r.raise_for_status()

        # Step 2: run maldroid (python2 subprocess -> Reports/<hash>_static.json)
        jobstore.set_running(job_id, 2, 3, "Running Maldroid analysis")
        r = requests.post(BASE + "/run_maldroid", timeout=600)
        r.raise_for_status()

        # Step 3: fetch the JSON report
        jobstore.set_running(job_id, 3, 3, "Retrieving JSON report")
        r = requests.get(BASE + "/get_json", params={"hash": file_hash}, timeout=60)
        r.raise_for_status()

        jobstore.set_success(job_id, r.text)
        return {"job_id": job_id, "status": "success"}

    except Exception as e:
        import traceback
        traceback.print_exc()
        jobstore.set_failed(job_id, "{}: {}".format(type(e).__name__, e))
        raise


def _post_with_retry(path, files, attempts=20, delay=0.5):
    """The ready flag is written just before app.run(), so retry connection refusals."""
    last = None
    for _ in range(attempts):
        try:
            return requests.post(BASE + path, files=files, timeout=600)
        except requests.exceptions.ConnectionError as e:
            last = e
            time.sleep(delay)
            files["file"][1].seek(0)  # rewind the file object for the retry
    raise last
