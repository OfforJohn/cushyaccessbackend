#!/bin/bash
set -e

# Install Node.js if not present
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# Install PM2 globally if not present
if ! command -v pm2 &> /dev/null; then
    sudo npm install -g pm2
fi

# Install NestJS CLI globally if not present
if ! command -v nest &> /dev/null; then
    sudo npm install -g @nestjs/cli
fi