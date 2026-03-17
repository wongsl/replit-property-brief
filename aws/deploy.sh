#!/usr/bin/env bash
# =============================================================================
# Property Brief - AWS EC2 Deployment Script
#
# Usage:
#   ./aws/deploy.sh [command]
#
# Commands:
#   infra     Deploy or update the infrastructure stack (VPC, RDS, S3, IAM)
#   build     Build app locally and upload artifact to S3
#   launch    Deploy the EC2 service stack (first time only)
#   deploy    Full update: build new artifact + trigger EC2 redeploy via SSM
#   status    Show stack outputs and EC2 instance status
#   connect   Open an SSM Session Manager shell on the EC2 instance
#   logs      Tail live application logs from the EC2 instance via SSM
#
# Required environment variables:
#   AWS_REGION          AWS region (default: us-west-2)
#   AWS_ACCOUNT_ID      Your 12-digit AWS account ID
#   PERPLEXITY_API_KEY  Perplexity AI API key (only needed for 'infra')
#
# Example — first-time deployment:
#   export AWS_REGION=us-west-2
#   export AWS_ACCOUNT_ID=123456789012
#   export PERPLEXITY_API_KEY=pplx-xxxx
#   ./aws/deploy.sh infra      # ~15 min (RDS takes a while)
#   ./aws/deploy.sh build      # packages and uploads artifact to S3
#   ./aws/deploy.sh launch     # starts EC2 instance; it self-deploys on boot
#
# Subsequent updates (code changes):
#   ./aws/deploy.sh deploy     # build + SSM redeploy, ~2 min
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
APP_NAME="${APP_NAME:-property-brief}"
AWS_REGION="${AWS_REGION:-us-west-2}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-}"
INFRA_STACK="${APP_NAME}-infrastructure"
SERVICE_STACK="${APP_NAME}-service"

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log()  { echo "[deploy] $*"; }
fail() { echo "[deploy] ERROR: $*" >&2; exit 1; }

require_env() {
  for var in "$@"; do
    [[ -n "${!var:-}" ]] || fail "Environment variable $var is required."
  done
}

get_output() {
  local stack=$1 key=$2
  aws cloudformation describe-stacks \
    --stack-name "$stack" \
    --region "$AWS_REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$key'].OutputValue" \
    --output text 2>/dev/null
}

# ---------------------------------------------------------------------------
# infra: Deploy VPC, RDS, S3, IAM
# ---------------------------------------------------------------------------
cmd_infra() {
  require_env AWS_REGION PERPLEXITY_API_KEY

  log "Deploying infrastructure stack: $INFRA_STACK"
  log "(RDS creation takes ~10–15 minutes on first run)"

  aws cloudformation deploy \
    --region "$AWS_REGION" \
    --stack-name "$INFRA_STACK" \
    --template-file "$ROOT_DIR/aws/infrastructure.yml" \
    --capabilities CAPABILITY_NAMED_IAM \
    --parameter-overrides \
      AppName="$APP_NAME" \
      PerplexityApiKey="$PERPLEXITY_API_KEY" \
    --no-fail-on-empty-changeset

  log ""
  log "Infrastructure ready:"
  log "  RDS endpoint:      $(get_output "$INFRA_STACK" RDSEndpoint)"
  log "  Artifact bucket:   $(get_output "$INFRA_STACK" ArtifactBucketName)"
}

# ---------------------------------------------------------------------------
# build: Build app and upload artifact to S3
# ---------------------------------------------------------------------------
cmd_build() {
  require_env AWS_REGION

  local bucket
  bucket="$(get_output "$INFRA_STACK" ArtifactBucketName)"
  [[ -n "$bucket" ]] || fail "Could not find ArtifactBucketName output. Run 'infra' first."

  log "Building application..."
  cd "$ROOT_DIR"
  npm run build

  log "Packaging artifact..."
  ARTIFACT="/tmp/${APP_NAME}-artifact.tar.gz"
  tar -czf "$ARTIFACT" \
    dist/ \
    backend/ \
    requirements.txt \
    package.json \
    package-lock.json

  local size
  size="$(du -sh "$ARTIFACT" | cut -f1)"
  log "Artifact size: $size"

  log "Uploading to s3://$bucket/$APP_NAME/latest.tar.gz ..."
  aws s3 cp "$ARTIFACT" "s3://$bucket/$APP_NAME/latest.tar.gz" \
    --region "$AWS_REGION"

  # Also save a timestamped copy for rollback
  local ts
  ts="$(date +%Y%m%d-%H%M%S)"
  aws s3 cp "$ARTIFACT" "s3://$bucket/$APP_NAME/archive/${ts}.tar.gz" \
    --region "$AWS_REGION"

  rm "$ARTIFACT"
  log "Artifact uploaded. Timestamped backup: $ts"
}

# ---------------------------------------------------------------------------
# launch: Deploy EC2 service stack (first time)
# ---------------------------------------------------------------------------
cmd_launch() {
  require_env AWS_REGION

  log "Deploying EC2 service stack: $SERVICE_STACK"

  local key_pair="${KEY_PAIR_NAME:-}"
  local params="AppName=$APP_NAME"
  [[ -n "$key_pair" ]] && params="$params KeyPairName=$key_pair"

  aws cloudformation deploy \
    --region "$AWS_REGION" \
    --stack-name "$SERVICE_STACK" \
    --template-file "$ROOT_DIR/aws/service.yml" \
    --parameter-overrides $params \
    --no-fail-on-empty-changeset

  log ""
  log "EC2 instance is launching and self-deploying from S3 artifact."
  log "This takes ~5 minutes. Monitor bootstrap progress with:"
  log "  ./aws/deploy.sh connect"
  log "  sudo tail -f /var/log/user-data.log"
  log ""
  log "Application URL: $(get_output "$SERVICE_STACK" ApplicationURL)"
  log "Instance ID:     $(get_output "$SERVICE_STACK" InstanceId)"
  log ""
  log "Connect without SSH:"
  log "  $(get_output "$SERVICE_STACK" SSMConnectCommand)"
}

# ---------------------------------------------------------------------------
# deploy: Build + SSM redeploy (for code updates)
# ---------------------------------------------------------------------------
cmd_deploy() {
  require_env AWS_REGION

  cmd_build

  local instance_id
  instance_id="$(get_output "$SERVICE_STACK" InstanceId)"
  [[ -n "$instance_id" ]] || fail "Could not find InstanceId. Run 'launch' first."

  log "Triggering redeploy on EC2 instance $instance_id via SSM..."

  local command_id
  command_id="$(aws ssm send-command \
    --region "$AWS_REGION" \
    --instance-ids "$instance_id" \
    --document-name "AWS-RunShellScript" \
    --parameters 'commands=["/usr/local/bin/pb-deploy"]' \
    --comment "Property Brief redeploy $(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --query "Command.CommandId" \
    --output text)"

  log "SSM command sent: $command_id"
  log "Waiting for completion..."

  aws ssm wait command-executed \
    --region "$AWS_REGION" \
    --command-id "$command_id" \
    --instance-id "$instance_id" 2>/dev/null || true

  local status
  status="$(aws ssm get-command-invocation \
    --region "$AWS_REGION" \
    --command-id "$command_id" \
    --instance-id "$instance_id" \
    --query "Status" \
    --output text)"

  if [[ "$status" == "Success" ]]; then
    log "Deployment succeeded."
    log "Application URL: $(get_output "$SERVICE_STACK" ApplicationURL)"
  else
    log "Deployment status: $status"
    log "Fetch full output with:"
    log "  aws ssm get-command-invocation --region $AWS_REGION --command-id $command_id --instance-id $instance_id"
    [[ "$status" == "Success" ]] || exit 1
  fi
}

# ---------------------------------------------------------------------------
# connect: Open SSM Session Manager shell
# ---------------------------------------------------------------------------
cmd_connect() {
  require_env AWS_REGION

  local instance_id
  instance_id="$(get_output "$SERVICE_STACK" InstanceId)"
  [[ -n "$instance_id" ]] || fail "No instance found. Run 'launch' first."

  log "Connecting to $instance_id via SSM Session Manager..."
  log "(Install session-manager-plugin if this fails: https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html)"

  aws ssm start-session \
    --target "$instance_id" \
    --region "$AWS_REGION"
}

# ---------------------------------------------------------------------------
# logs: Tail application logs via SSM
# ---------------------------------------------------------------------------
cmd_logs() {
  require_env AWS_REGION

  local instance_id
  instance_id="$(get_output "$SERVICE_STACK" InstanceId)"
  [[ -n "$instance_id" ]] || fail "No instance found. Run 'launch' first."

  local service="${1:-node}"
  log "Streaming logs for ${APP_NAME}-${service} (Ctrl+C to stop)..."

  aws ssm start-session \
    --target "$instance_id" \
    --region "$AWS_REGION" \
    --document-name "AWS-StartInteractiveCommand" \
    --parameters "command=journalctl -u ${APP_NAME}-${service} -f --no-pager"
}

# ---------------------------------------------------------------------------
# status: Show stack outputs and EC2 health
# ---------------------------------------------------------------------------
cmd_status() {
  require_env AWS_REGION

  log "=== Infrastructure Stack ==="
  aws cloudformation describe-stacks \
    --region "$AWS_REGION" \
    --stack-name "$INFRA_STACK" \
    --query "Stacks[0].Outputs[*].[OutputKey,OutputValue]" \
    --output table 2>/dev/null || log "(not deployed)"

  log ""
  log "=== Service Stack ==="
  aws cloudformation describe-stacks \
    --region "$AWS_REGION" \
    --stack-name "$SERVICE_STACK" \
    --query "Stacks[0].Outputs[*].[OutputKey,OutputValue]" \
    --output table 2>/dev/null || log "(not deployed)"

  local instance_id
  instance_id="$(get_output "$SERVICE_STACK" InstanceId 2>/dev/null)" || true
  if [[ -n "$instance_id" ]]; then
    log ""
    log "=== EC2 Instance State ==="
    aws ec2 describe-instances \
      --region "$AWS_REGION" \
      --instance-ids "$instance_id" \
      --query "Reservations[0].Instances[0].{State:State.Name,Type:InstanceType,PublicIP:PublicIpAddress,LaunchTime:LaunchTime}" \
      --output table
  fi
}

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
COMMAND="${1:-help}"

case "$COMMAND" in
  infra)   cmd_infra ;;
  build)   cmd_build ;;
  launch)  cmd_launch ;;
  deploy)  cmd_deploy ;;
  connect) cmd_connect ;;
  logs)    cmd_logs "${2:-node}" ;;
  status)  cmd_status ;;
  help|--help|-h)
    grep '^# ' "$0" | head -35 | sed 's/^# //'
    ;;
  *)
    fail "Unknown command: $COMMAND. Run '$0 help' for usage."
    ;;
esac
