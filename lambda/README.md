# android-static on AWS Lambda

Runs the APK static-analysis stack (androguard + `maldroid_main.py`) on Lambda
while keeping the job API your Node backend already polls.

## Architecture

```
Node backend ──POST /analyze_apk {key,hash}──▶  api Lambda ──async invoke──▶  worker Lambda
     │  (S3 key, not file bytes)                    │                              │
     └──GET /status/{job_id} (poll 5s)──────────────┤                              ├─ S3: download APK
                                                     │                              ├─ boot androguard_server.py (:8010, bg thread)
                                          DynamoDB ◀─┴─ read status                 ├─ /load_apk → /run_maldroid → /get_json
                                          (job state, replaces Redis)               └─ report → S3, status=success → DynamoDB
```

| Old (docker-compose) | New (Lambda) |
|---|---|
| Celery `.delay()` | async `lambda:InvokeFunction` (`InvocationType=Event`) |
| Redis result backend | DynamoDB job table |
| multipart APK upload | caller passes an **S3 key** (dodges Lambda's 6 MB request cap) |
| container DNS `android-static-wrapper:5001` | API **Function URL** |
| writes to cwd | worker `chdir`s to `/tmp/work` (only writable FS) |

Both Lambdas run from **one container image** (`lambda/Dockerfile`, extends the
original Ubuntu image so `python2` + androguard still work); they differ only by
the handler command (`worker_handler.handler` vs `api_handler.handler`).

## Deploy

```bash
export SAMPLE_BUCKET=your-apk-bucket      # where uploaded APKs live in S3
export AWS_REGION=ap-northeast-1          # optional, defaults shown in deploy.sh
# export RESULT_BUCKET=...                # optional; defaults to SAMPLE_BUCKET
bash lambda/deploy.sh
```

The script builds/pushes the image to ECR, creates the DynamoDB table (with TTL),
the two IAM roles, both functions, and a Function URL — then prints the URL.

**Sizing:** worker defaults to 4096 MB / 600 s / 2048 MB `/tmp`. Bump
`WORKER_MEMORY`/`WORKER_EPHEMERAL` for large APKs (androguard is memory-hungry;
`/tmp` must hold the APK + reports). Your ~5 min analyses fit the 600 s timeout.

## Backend caller change

Your `analyzeAndroidStatic` currently multipart-uploads the APK bytes. Switch it
to send the S3 key it already has (`fileDoc.filePath`) and point at the Function
URL. Only the submit call changes; the `/status` poll loop stays identical.

```ts
const ANDROID_STATIC_API = process.env.ANDROID_STATIC_API!; // Function URL

// tmpPath / downloadToTemp no longer needed for this path — drop them.
const postRes = await fetch(`${ANDROID_STATIC_API}/analyze_apk`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    key: fileDoc.filePath,     // the S3 key of the uploaded APK
    hash: fileDoc.hash,
    filename: fileDoc.filename,
    // bucket: "override-bucket"  // optional; else SAMPLE_BUCKET env is used
  }),
});
if (postRes.status !== 202) throw new Error(`Enqueue failed: ${postRes.status}`);
const { job_id } = (await postRes.json()) as { job_id: string };
// ...unchanged: poll GET `${ANDROID_STATIC_API}/status/${job_id}` every 5s...
```

`/status` returns `result` as a JSON **string** on success — your existing
`typeof report === "string" ? JSON.parse(report) : report` already handles that.

## Auth on the Function URL

`deploy.sh` defaults `FUNCTION_URL_AUTH=AWS_IAM` (the URL is **not** public;
callers must sign requests with SigV4). If your Node backend can't SigV4-sign
(the built-in `fetch` doesn't), either:

- sign with `aws4` before `fetch`, **or**
- redeploy with `FUNCTION_URL_AUTH=NONE` for a public URL (simplest; only do this
  if the endpoint is otherwise protected), **or**
- front it with API Gateway + a VPC/private integration to match your old
  internal-network posture.

## Local test (optional)

Use the Lambda Runtime Interface Emulator to invoke the worker locally:

```bash
docker build -f lambda/Dockerfile -t android-static-lambda .
docker run --rm -p 9000:8080 \
  -e JOB_TABLE=... -e RESULT_BUCKET=... \
  -e AWS_ACCESS_KEY_ID=... -e AWS_SECRET_ACCESS_KEY=... -e AWS_REGION=... \
  --entrypoint /usr/bin/python3 android-static-lambda -m awslambdaric worker_handler.handler
# (needs the RIE, or run the api handler and curl the invoke endpoint)
```
