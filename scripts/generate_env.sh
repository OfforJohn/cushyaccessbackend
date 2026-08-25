#!/bin/bash
set -xe
cd /home/ubuntu/cushyaccess-backend

SECRET_NAME="cushyaccess-secret"
REGION="eu-west-1"  

print_status() {
    echo -e "\033[32m[INFO]\033[0m $1"
}

print_warning() {
    echo -e "\033[33m[WARNING]\033[0m $1"
}

print_error() {
    echo -e "\033[31m[ERROR]\033[0m $1"
}

# Step 1: Check if .env exists
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        cp .env.example .env
        print_status "Copied .env.example to .env"
    else
        print_warning ".env.example not found, creating basic .env file"
        cat > .env <<EOF
DB_DATABASE=
DB_HOST=
DB_PASSWORD=
DB_PORT=
DB_USERNAME=
JWT_SECRET=
PAYSTACK_SECRET_KEY=
MAIL_FROM=
MAIL_USERNAME=
BIKE_DELIVERY_FEE_PER_KM=
VAN_DELIVERY_FEE_PER_KM=
LOGISTICS_SERVICE_CHARGE=
Q_COMMERCE_SERVICE_CHARGE=

TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
TWILIO_CONTENT_SID=
CLOUD_API_KEY=
CLOUD_API_SECRET=
CLOUD_NAME=
BREVO_API_KEY=
EOF
    fi
else
    print_status ".env already exists"
fi

# Step 2: Fetch secrets from AWS Secrets Manager
print_status "Fetching secrets from AWS Secrets Manager..."

SECRET_JSON=$(aws secretsmanager get-secret-value \
  --region "$REGION" \
  --secret-id "$SECRET_NAME" \
  --query SecretString \
  --output text 2>/dev/null)

if [ $? -ne 0 ]; then
  print_error "Failed to retrieve secret: $SECRET_NAME"
  exit 1
fi

# Step 3: Inject secrets into .env
print_status "Populating .env with secrets..."

while IFS="=" read -r key value; do
    # Strip any surrounding quotes
    key=$(echo "$key" | xargs)
    value=$(echo "$value" | sed 's/^"//;s/"$//')

    if grep -q "^$key=" .env; then
        sed -i "s|^$key=.*|$key=$value|" .env
    else
        echo "$key=$value" >> .env
    fi
done < <(echo "$SECRET_JSON" | jq -r "to_entries|map(\"\(.key)=\(.value)\")|.[]" )

print_status ".env successfully populated with secrets."
