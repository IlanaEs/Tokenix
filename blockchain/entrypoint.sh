#!/bin/sh
set -e

echo "Starting Hardhat node in background..."
npx hardhat node --hostname 0.0.0.0 &

echo "Waiting for Hardhat node to boot..."
sleep 5

echo "Running full-deploy (compile, deploy, sync)..."
npm run full-deploy || {
  echo "full-deploy failed" >&2
  exit 1
}

echo "Deployment complete. Container will stay alive waiting for processes."
wait
