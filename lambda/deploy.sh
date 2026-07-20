#!/usr/bin/env bash
# Provision + deploy the android-static Lambda stack.
# Idempotent-ish: creates resources if missing, updates the functions otherwise.
# Run from the repo root:  bash lambda/deploy.sh
set -euo pipefail

# ---- config (override via env) --------------------------------------------
: "${AWS_REGION:=ap-southeast-2}"
: "${ACCOUNT_ID:=$(aws sts get-caller-identity --query Account --output text)}"
: "${ECR_REPO:=android-static}"
: "${IMAGE_TAG:=latest}"
: "${SAMPLE_BUCKET:?set SAMPLE_BUCKET to the S3 bucket holding uploaded APKs}"
: "${RESULT_BUCKET:=${SAMPLE_BUCKET}}"      # can reuse the sample bucket
: "${JOB_TABLE:=android-static-jobs}"
: "${WORKER_FN:=android-static-worker}"
: "${API_FN:=android-static-api}"
# AWS granted the limit increase on 2026-07-17 (case 178357571200648) — the worker
# needs the full 10 GB: androguard+maldroid OOMs below ~4 GB even on small APKs.
: "${WORKER_MEMORY:=10240}"
: "${WORKER_TIMEOUT:=900}"                  # Lambda max; androguard+maldroid is slow at 3 GB (~1.7 vCPU)
: "${WORKER_EPHEMERAL:=2048}"               # /tmp size (MB): APK + reports
: "${FUNCTION_URL_AUTH:=AWS_IAM}"           # AWS_IAM (recommended) or NONE

IMAGE_URI="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}:${IMAGE_TAG}"
WORKER_ROLE="${WORKER_FN}-role"
API_ROLE="${API_FN}-role"

echo "==> Region=$AWS_REGION Account=$ACCOUNT_ID Image=$IMAGE_URI"

# ---- 1. build + push image -------------------------------------------------
aws ecr describe-repositories --repository-names "$ECR_REPO" --region "$AWS_REGION" >/dev/null 2>&1 \
  || aws ecr create-repository --repository-name "$ECR_REPO" --region "$AWS_REGION" >/dev/null
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
# Lambda only accepts a single-platform image manifest with NO provenance/SBOM
# attestations. Docker's containerd/BuildKit store adds those by default (which
# yields an unsupported manifest index), so build with buildx and disable them.
docker buildx build --platform linux/amd64 --provenance=false --sbom=false \
  -f lambda/Dockerfile -t "$IMAGE_URI" --push .

# ---- 2. DynamoDB job table (TTL on "ttl") ---------------------------------
if ! aws dynamodb describe-table --table-name "$JOB_TABLE" --region "$AWS_REGION" >/dev/null 2>&1; then
  aws dynamodb create-table --table-name "$JOB_TABLE" --region "$AWS_REGION" \
    --attribute-definitions AttributeName=job_id,AttributeType=S \
    --key-schema AttributeName=job_id,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST >/dev/null
  aws dynamodb wait table-exists --table-name "$JOB_TABLE" --region "$AWS_REGION"
  aws dynamodb update-time-to-live --table-name "$JOB_TABLE" --region "$AWS_REGION" \
    --time-to-live-specification "Enabled=true,AttributeName=ttl" >/dev/null
fi

# ---- 3. IAM roles ----------------------------------------------------------
TRUST='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
TABLE_ARN="arn:aws:dynamodb:${AWS_REGION}:${ACCOUNT_ID}:table/${JOB_TABLE}"

ensure_role () {  # $1=role name
  aws iam get-role --role-name "$1" >/dev/null 2>&1 \
    || aws iam create-role --role-name "$1" --assume-role-policy-document "$TRUST" >/dev/null
  aws iam attach-role-policy --role-name "$1" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole >/dev/null
}
ensure_role "$WORKER_ROLE"
ensure_role "$API_ROLE"

aws iam put-role-policy --role-name "$WORKER_ROLE" --policy-name inline --policy-document "$(cat <<JSON
{"Version":"2012-10-17","Statement":[
 {"Effect":"Allow","Action":["dynamodb:PutItem","dynamodb:UpdateItem","dynamodb:GetItem"],"Resource":"${TABLE_ARN}"},
 {"Effect":"Allow","Action":["s3:GetObject"],"Resource":"arn:aws:s3:::${SAMPLE_BUCKET}/*"},
 {"Effect":"Allow","Action":["s3:PutObject","s3:GetObject"],"Resource":"arn:aws:s3:::${RESULT_BUCKET}/*"}
]}
JSON
)"

aws iam put-role-policy --role-name "$API_ROLE" --policy-name inline --policy-document "$(cat <<JSON
{"Version":"2012-10-17","Statement":[
 {"Effect":"Allow","Action":["dynamodb:PutItem","dynamodb:UpdateItem","dynamodb:GetItem"],"Resource":"${TABLE_ARN}"},
 {"Effect":"Allow","Action":["s3:GetObject"],"Resource":"arn:aws:s3:::${RESULT_BUCKET}/*"},
 {"Effect":"Allow","Action":["lambda:InvokeFunction"],"Resource":"arn:aws:lambda:${AWS_REGION}:${ACCOUNT_ID}:function:${WORKER_FN}"}
]}
JSON
)"

echo "==> waiting for IAM propagation"; sleep 10

# ---- 4. functions (same image, different handler command) -----------------
deploy_fn () {  # $1=name $2=role $3=handler $4=mem $5=timeout $6=ephemeral $7=env
  local role_arn="arn:aws:iam::${ACCOUNT_ID}:role/$2"
  if aws lambda get-function --function-name "$1" --region "$AWS_REGION" >/dev/null 2>&1; then
    aws lambda update-function-code --function-name "$1" --region "$AWS_REGION" \
      --image-uri "$IMAGE_URI" >/dev/null
    aws lambda wait function-updated --function-name "$1" --region "$AWS_REGION"
    aws lambda update-function-configuration --function-name "$1" --region "$AWS_REGION" \
      --image-config "Command=[\"$3\"]" --memory-size "$4" --timeout "$5" \
      --ephemeral-storage "Size=$6" --environment "$7" >/dev/null
  else
    aws lambda create-function --function-name "$1" --region "$AWS_REGION" \
      --package-type Image --code "ImageUri=${IMAGE_URI}" \
      --image-config "Command=[\"$3\"]" --role "$role_arn" \
      --memory-size "$4" --timeout "$5" --ephemeral-storage "Size=$6" \
      --environment "$7" >/dev/null
  fi
  aws lambda wait function-updated --function-name "$1" --region "$AWS_REGION"
}

deploy_fn "$WORKER_FN" "$WORKER_ROLE" "worker_handler.handler" \
  "$WORKER_MEMORY" "$WORKER_TIMEOUT" "$WORKER_EPHEMERAL" \
  "Variables={JOB_TABLE=$JOB_TABLE,RESULT_BUCKET=$RESULT_BUCKET}"

# Async retries re-run doomed jobs (OOM/timeout are deterministic) and flip the
# job's step counter back and forth while the backend polls — disable them.
aws lambda put-function-event-invoke-config --function-name "$WORKER_FN" --region "$AWS_REGION" \
  --maximum-retry-attempts 0 >/dev/null 2>&1 \
  || aws lambda update-function-event-invoke-config --function-name "$WORKER_FN" --region "$AWS_REGION" \
    --maximum-retry-attempts 0 >/dev/null

deploy_fn "$API_FN" "$API_ROLE" "api_handler.handler" \
  256 30 512 \
  "Variables={JOB_TABLE=$JOB_TABLE,RESULT_BUCKET=$RESULT_BUCKET,WORKER_FUNCTION_NAME=$WORKER_FN,SAMPLE_BUCKET=$SAMPLE_BUCKET}"

# ---- 5. Function URL on the API function ----------------------------------
aws lambda create-function-url-config --function-name "$API_FN" --region "$AWS_REGION" \
  --auth-type "$FUNCTION_URL_AUTH" >/dev/null 2>&1 || true
if [ "$FUNCTION_URL_AUTH" = "NONE" ]; then
  # Since Oct 2025, public Function URLs need BOTH lambda:InvokeFunctionUrl and
  # lambda:InvokeFunction (scoped to URL calls) — missing either yields 403.
  # https://docs.aws.amazon.com/lambda/latest/dg/urls-auth.html
  aws lambda add-permission --function-name "$API_FN" --region "$AWS_REGION" \
    --statement-id FunctionURLAllowPublic --action lambda:InvokeFunctionUrl \
    --principal "*" --function-url-auth-type NONE >/dev/null 2>&1 || true
  aws lambda add-permission --function-name "$API_FN" --region "$AWS_REGION" \
    --statement-id FunctionURLAllowPublicInvokeFunction --action lambda:InvokeFunction \
    --principal "*" --invoked-via-function-url >/dev/null 2>&1 || true
fi
URL=$(aws lambda get-function-url-config --function-name "$API_FN" --region "$AWS_REGION" --query FunctionUrl --output text)

echo ""
echo "==> DONE. API Function URL: $URL"
echo "    Point ANDROID_STATIC_API at that URL (auth: $FUNCTION_URL_AUTH)."
