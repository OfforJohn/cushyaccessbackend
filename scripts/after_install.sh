#!/bin/bash
set -e

cd /home/ubuntu/cushyaccess-backend

# 1. Fetch secrets from Production AWS and format the .env file
aws secretsmanager get-secret-value --region eu-west-1 --secret-id cushyaccess-secret --query SecretString --output text | jq -r 'to_entries|map("\(.key)=\(.value|tostring)")|.[]' > .env

# 2. SAFETY OVERRIDE: Check which environment is currently deploying!
if [ "$DEPLOYMENT_GROUP_NAME" == "stagging" ]; then
    echo "Detected Staging Environment. Applying Supabase & Test overrides..."
    
    echo "" >> .env
    echo "# --- STAGING DATABASE OVERRIDES ---" >> .env
    echo "DB_HOST=aws-1-eu-west-1.pooler.supabase.com" >> .env
    echo "DB_PORT=5432" >> .env
    echo "DB_USERNAME=postgres.nudxyzjosxkfbchxqsiz" >> .env
    echo "DB_PASSWORD=uWxxyEaAq8aPPDh5" >> .env
    echo "DB_NAME=postgres" >> .env
    echo "DB_DATABASE=postgres" >> .env
    echo "DATABASE_NAME=postgres" >> .env
    echo "POSTGRES_DB=postgres" >> .env
    
    echo "" >> .env
    echo "# --- STAGING PAYMENT OVERRIDES ---" >> .env
    echo "PAYSTACK_SECRET_KEY=sk_test_263f34f1c9ab608c74d1dbb25b4c496bbaf15ce8" >> .env
    echo "PAYSTACK_PUBLIC_KEY=pk_test_41ed861e48e5846ee3e9d00648c1228144f86734" >> .env
else
    echo "Detected Production Environment. Using live RDS and live Paystack..."
fi

# 3. Fix permissions
sudo chown -R ubuntu:ubuntu /home/ubuntu/cushyaccess-backend

# 4. Install dependencies fresh
npm install
