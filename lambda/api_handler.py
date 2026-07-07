"""
API Lambda -- fronted by a Function URL (payload format v2).

Preserves the exact contract the Node backend depends on:
    POST /analyze_apk   -> 202 {"job_id": ...}
    GET  /status/{id}   -> {"status": pending|running|success|failed, ...}

Change from the old wrapper: /analyze_apk now takes JSON with the APK's S3
location instead of a multipart file upload. Lambda's synchronous request
payload is capped at 6 MB, and the caller already has the sample in S3, so we
pass a key and let the worker pull it.

  POST body (application/json):
    { "key": "<s3 key>", "hash": "<sha256>",
      "filename": "app.apk"  (optional),
      "bucket": "<s3 bucket>" (optional; defaults to SAMPLE_BUCKET env) }

Env vars:
  WORKER_FUNCTION_NAME  name/ARN of the worker Lambda to async-invoke
  SAMPLE_BUCKET         default S3 bucket holding uploaded APKs
  JOB_TABLE, RESULT_BUCKET  (used via jobstore)
"""

import os
import json
import uuid
import boto3

import jobstore

WORKER_FUNCTION_NAME = os.environ["WORKER_FUNCTION_NAME"]
SAMPLE_BUCKET = os.getenv("SAMPLE_BUCKET", "")

_lambda = boto3.client("lambda")


def _resp(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
    }


def _method_and_path(event):
    # Function URL / API Gateway HTTP API payload format 2.0
    ctx = event.get("requestContext", {}).get("http", {})
    method = ctx.get("method") or event.get("httpMethod", "GET")
    path = event.get("rawPath") or ctx.get("path") or event.get("path", "/")
    return method.upper(), path


def _parse_body(event):
    raw = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        import base64
        raw = base64.b64decode(raw).decode("utf-8")
    return json.loads(raw)


def handler(event, context):
    method, path = _method_and_path(event)

    if method == "POST" and path.rstrip("/") == "/analyze_apk":
        return _enqueue(event)

    if method == "GET" and path.startswith("/status/"):
        job_id = path[len("/status/"):].strip("/")
        return _status(job_id)

    return _resp(404, {"error": "Not found", "path": path, "method": method})


def _enqueue(event):
    try:
        body = _parse_body(event)
    except Exception as e:
        return _resp(400, {"error": "Invalid JSON body: {}".format(e)})

    key = body.get("key")
    file_hash = body.get("hash")
    if not key or not file_hash:
        return _resp(400, {"error": "Missing 'key' or 'hash'"})

    bucket = body.get("bucket") or SAMPLE_BUCKET
    if not bucket:
        return _resp(400, {"error": "No bucket given and SAMPLE_BUCKET unset"})

    filename = body.get("filename") or os.path.basename(key) or "app.apk"
    job_id = str(uuid.uuid4())

    jobstore.create_pending(job_id, file_hash, filename)

    _lambda.invoke(
        FunctionName=WORKER_FUNCTION_NAME,
        InvocationType="Event",  # async -- this is the Celery .delay() replacement
        Payload=json.dumps(
            {
                "job_id": job_id,
                "bucket": bucket,
                "key": key,
                "hash": file_hash,
                "filename": filename,
            }
        ).encode("utf-8"),
    )

    return _resp(202, {"job_id": job_id})


def _status(job_id):
    item = jobstore.get(job_id)
    if not item:
        return _resp(404, {"status": "not_found", "error": "Unknown job_id"})

    status = item.get("status")

    if status in ("pending", "running"):
        return _resp(
            200,
            {
                "status": status,
                "step": _num(item.get("step")),
                "total": _num(item.get("total")),
                "message": item.get("message"),
            },
        )

    if status == "success":
        result_text = jobstore.load_result_text(item["result_key"])
        # Caller accepts a JSON string (it does JSON.parse) or an object.
        return _resp(200, {"status": "success", "result": result_text})

    if status == "failed":
        return _resp(500, {"status": "failed", "error": item.get("error")})

    return _resp(200, {"status": status})


def _num(v):
    # DynamoDB numbers come back as Decimal; make them JSON-friendly ints.
    return int(v) if v is not None else None
