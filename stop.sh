#!/usr/bin/env bash
set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLEAN_VOLUMES=false

while [[ "$#" -gt 0 ]]; do
    case $1 in
        --clean-volumes|-v) CLEAN_VOLUMES=true ;;
        -h|--help)
            echo "Usage: ./stop.sh [--clean-volumes]"
            echo "Stops all running LinDeploy containers."
            exit 0
            ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
    shift
done

echo "Stopping LinDeploy containers..."

ENV_FILE=""
if [ -f "$PROJECT_ROOT/.env.docker" ]; then
    ENV_FILE="--env-file $PROJECT_ROOT/.env.docker"
fi

if [ "$CLEAN_VOLUMES" = true ]; then
    docker compose $ENV_FILE down -v
    echo "All LinDeploy containers and docker volumes removed."
else
    docker compose $ENV_FILE down
    echo "All LinDeploy containers stopped. Data in data/ is preserved."
fi

