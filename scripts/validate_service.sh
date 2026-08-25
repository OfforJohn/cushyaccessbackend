#!/bin/bash
set -e

cd /home/ubuntu/cushyaccess-backend

# Check if PM2 process is running
if ! pm2 list | grep -q "online"; then
    echo "Application is not running"
    exit 1
fi

# Health check
for i in {1..10}; do
    if curl -f http://localhost:3000/ > /dev/null 2>&1; then
        echo "Application is healthy"
        exit 0
    fi
    echo "Attempt $i: Application not ready, waiting..."
    sleep 10
done

echo "Application failed health check"
pm2 logs
exit 1