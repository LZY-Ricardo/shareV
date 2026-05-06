#!/usr/bin/env bash
set -euo pipefail

MODE="dry-run"
SKIP_DOCKER=0

PROJECT_DIR="${PROJECT_DIR:-/opt/shareV}"
BACKUP_DIR="${BACKUP_DIR:-/root/sharev-backups}"

CODE_RETENTION_DAYS="${CODE_RETENTION_DAYS:-14}"
CODE_MIN_KEEP="${CODE_MIN_KEEP:-5}"
HOTFIX_RETENTION_DAYS="${HOTFIX_RETENTION_DAYS:-14}"
HOTFIX_MIN_KEEP="${HOTFIX_MIN_KEEP:-10}"
CONFIG_RETENTION_DAYS="${CONFIG_RETENTION_DAYS:-30}"
CONFIG_MIN_KEEP="${CONFIG_MIN_KEEP:-10}"
DOCKER_CACHE_UNTIL="${DOCKER_CACHE_UNTIL:-168h}"

usage() {
  cat <<'USAGE'
Usage:
  cleanup-sharev.sh [--dry-run|--apply] [--skip-docker]

Default mode is --dry-run. Nothing is deleted unless --apply is passed.

Environment overrides:
  PROJECT_DIR=/opt/shareV
  BACKUP_DIR=/root/sharev-backups
  CODE_RETENTION_DAYS=14
  CODE_MIN_KEEP=5
  HOTFIX_RETENTION_DAYS=14
  HOTFIX_MIN_KEEP=10
  CONFIG_RETENTION_DAYS=30
  CONFIG_MIN_KEEP=10
  DOCKER_CACHE_UNTIL=168h
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --apply) MODE="apply" ;;
    --dry-run) MODE="dry-run" ;;
    --skip-docker) SKIP_DOCKER=1 ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S%z')" "$*"
}

run_or_print() {
  if [ "$MODE" = "apply" ]; then
    "$@"
  else
    printf '[dry-run] '
    printf '%q ' "$@"
    printf '\n'
  fi
}

require_safe_paths() {
  if [ "${SHAREV_CLEANUP_ALLOW_CUSTOM_PATHS:-0}" = "1" ]; then
    return
  fi

  case "$PROJECT_DIR" in
    /opt/shareV|/opt/shareV/) ;;
    *)
      echo "Refusing unsafe PROJECT_DIR: $PROJECT_DIR" >&2
      exit 3
      ;;
  esac

  case "$BACKUP_DIR" in
    /root/sharev-backups|/root/sharev-backups/) ;;
    *)
      echo "Refusing unsafe BACKUP_DIR: $BACKUP_DIR" >&2
      exit 3
      ;;
  esac
}

print_disk_usage() {
  log "mode=$MODE project=$PROJECT_DIR backups=$BACKUP_DIR"
  df -h "$PROJECT_DIR" "$BACKUP_DIR" 2>/dev/null || df -h

  if [ -d "$PROJECT_DIR/data" ]; then
    log "data files, never cleaned by this script:"
    ls -lah "$PROJECT_DIR/data" || true
  fi

  if command -v docker >/dev/null 2>&1; then
    log "docker disk usage:"
    docker system df 2>/dev/null || true
  fi
}

candidate_files() {
  local days="$1"
  local min_keep="$2"
  shift 2

  if [ ! -d "$BACKUP_DIR" ]; then
    return 0
  fi

  local cutoff
  cutoff="$(date -d "$days days ago" +%s)"

  find "$BACKUP_DIR" -maxdepth 1 -type f "$@" -printf '%T@ %p\n' \
    | sort -rn \
    | awk -v min_keep="$min_keep" -v cutoff="$cutoff" '
        NR > min_keep && int($1) < cutoff {
          sub(/^[^ ]+ /, "")
          print
        }
      '
}

cleanup_files() {
  local label="$1"
  local days="$2"
  local min_keep="$3"
  shift 3

  log "checking $label: delete older than ${days}d while keeping newest ${min_keep}"

  local count=0
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    count=$((count + 1))
    if [ "$MODE" = "apply" ]; then
      log "delete $file"
      rm -f -- "$file"
    else
      log "would delete $file"
    fi
  done < <(candidate_files "$days" "$min_keep" "$@")

  if [ "$count" -eq 0 ]; then
    log "no $label files need cleanup"
  fi
}

cleanup_docker() {
  if [ "$SKIP_DOCKER" -eq 1 ]; then
    log "docker cleanup skipped"
    return
  fi

  if ! command -v docker >/dev/null 2>&1; then
    log "docker not found, skip docker cleanup"
    return
  fi

  log "checking docker dangling images and build cache"
  run_or_print docker image prune -f
  run_or_print docker builder prune -f --filter "until=$DOCKER_CACHE_UNTIL"
}

main() {
  require_safe_paths
  print_disk_usage

  cleanup_files "code backups" "$CODE_RETENTION_DAYS" "$CODE_MIN_KEEP" \
    \( -name 'code-*.tgz' -o -name 'sharev-src-*.tar.gz' \)

  cleanup_files "hotfix backups" "$HOTFIX_RETENTION_DAYS" "$HOTFIX_MIN_KEEP" \
    \( -name 'sharev-hotfix-before-*.tar.gz' \)

  cleanup_files "sensitive config backups" "$CONFIG_RETENTION_DAYS" "$CONFIG_MIN_KEEP" \
    \( -name 'config-*.json' -o -name 'config-json-before-*.json' -o -name 'docker-compose-before-*.yml' -o -name 'sharev.service-*' \)

  cleanup_docker
  log "cleanup finished"
}

main "$@"
