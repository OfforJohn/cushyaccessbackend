#!/bin/bash
set -e

# 1. Navigate to project root
cd /home/ubuntu/cushyaccess-backend

# 2. Build the latest code pulled from GitHub
npm run build

# 3. Wipe PM2 daemon memory (Ensures NO old secrets remain)
pm2 kill

# 4. Safely load the fresh .env into the Shell Environment
# This replaces 'source .env' to prevent bash from executing cron strings as commands
while IFS='=' read -r key value; do
  if [[ -n "$key" && ! "$key" =~ ^# ]]; then
    export "$key=$(echo "$value" | tr -d '\r')"
  fi
done < .env

# 5. Start the single worker first. It is the only production process allowed
# to run TypeORM schema synchronization, preventing clustered API instances
# from racing to create the same column/index during deployment.
pm2 start ecosystem.config.js --only cushyaccess-worker --env production

# The worker only starts listening after its database initialization and schema
# synchronization finish. Do not expose the API cluster to the new build until
# that has completed successfully.
worker_status="000"
for attempt in {1..60}; do
  worker_status=$(curl --silent --output /dev/null --write-out "%{http_code}" \
    "http://127.0.0.1:4000/" || true)
  if [[ "$worker_status" != "000" ]]; then
    break
  fi
  sleep 2
done
if [[ "$worker_status" == "000" ]]; then
  echo "Worker failed to initialize the database within 120 seconds" >&2
  pm2 logs cushyaccess-worker --lines 50 --nostream || true
  exit 1
fi

# PM2 will inherit the same latest environment for the API cluster, whose
# connections now start with schema synchronization disabled.
pm2 start ecosystem.config.js --only cushyaccess-api --env production

# Refuse to mark a deployment successful if the AI module was omitted from
# the built API. Unauthenticated protected routes must answer 401/403, never
# 404. Retry while the PM2 cluster is warming up.
for route in chats knowledge; do
  status="000"
  for attempt in {1..15}; do
    status=$(curl --silent --output /dev/null --write-out "%{http_code}" \
      "http://127.0.0.1:3000/api/v1/cushy-ai/${route}" || true)
    if [[ "$status" != "000" ]]; then
      break
    fi
    sleep 2
  done
  if [[ "$status" != "401" && "$status" != "403" ]]; then
    echo "AI route verification failed: /api/v1/cushy-ai/${route} returned ${status}" >&2
    exit 1
  fi
done

# 6. Make this state persistent for server reboots
pm2 save
pm2 list
