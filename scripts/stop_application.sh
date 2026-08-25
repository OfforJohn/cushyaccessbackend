#!/bin/bash
set -e

cd /home/ubuntu/cushyaccess-backend

# Stop PM2 processes
pm2 stop all || true
pm2 delete all || true