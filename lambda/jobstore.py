"""
Shared job-state helpers backed by DynamoDB (+ S3 for the report payload).

This replaces the Redis/Celery result backend from the docker-compose stack.
Job status has to live in a shared store because, on Lambda, each poll of
/status can be served by a different instance -- process memory won't do.

DynamoDB items are capped at 400 KB, and reports can exceed that, so the
report JSON is stored in S3 and the item only keeps a pointer (result_key).

Env vars:
  JOB_TABLE      DynamoDB table name (partition key: job_id, String)
  RESULT_BUCKET  S3 bucket for report payloads
  JOB_TTL_SECS   optional; item TTL in seconds (default 86400). Requires a
                 TTL attribute named "ttl" enabled on the table.
"""

import os
import time
import boto3

JOB_TABLE = os.environ["JOB_TABLE"]
RESULT_BUCKET = os.environ["RESULT_BUCKET"]
JOB_TTL_SECS = int(os.getenv("JOB_TTL_SECS", "86400"))

_ddb = boto3.resource("dynamodb")
_table = _ddb.Table(JOB_TABLE)
_s3 = boto3.client("s3")


def _now():
    return int(time.time())


def create_pending(job_id, file_hash, filename):
    _table.put_item(
        Item={
            "job_id": job_id,
            "status": "pending",
            "hash": file_hash,
            "filename": filename,
            "created_at": _now(),
            "updated_at": _now(),
            "ttl": _now() + JOB_TTL_SECS,
        }
    )


def set_running(job_id, step, total, message):
    _table.update_item(
        Key={"job_id": job_id},
        UpdateExpression="SET #s=:s, step=:step, total=:total, message=:msg, updated_at=:u",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={
            ":s": "running",
            ":step": step,
            ":total": total,
            ":msg": message,
            ":u": _now(),
        },
    )


def set_success(job_id, report_text):
    """Store the report JSON in S3, record the key on the job item."""
    result_key = "results/{}.json".format(job_id)
    _s3.put_object(
        Bucket=RESULT_BUCKET,
        Key=result_key,
        Body=report_text.encode("utf-8"),
        ContentType="application/json",
    )
    _table.update_item(
        Key={"job_id": job_id},
        UpdateExpression="SET #s=:s, result_key=:rk, updated_at=:u",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={
            ":s": "success",
            ":rk": result_key,
            ":u": _now(),
        },
    )


def set_failed(job_id, error):
    _table.update_item(
        Key={"job_id": job_id},
        UpdateExpression="SET #s=:s, #e=:e, updated_at=:u",
        ExpressionAttributeNames={"#s": "status", "#e": "error"},
        ExpressionAttributeValues={
            ":s": "failed",
            ":e": str(error)[:4000],
            ":u": _now(),
        },
    )


def get(job_id):
    resp = _table.get_item(Key={"job_id": job_id})
    return resp.get("Item")


def load_result_text(result_key):
    obj = _s3.get_object(Bucket=RESULT_BUCKET, Key=result_key)
    return obj["Body"].read().decode("utf-8")
