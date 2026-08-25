# 📚 CushyAccess Backend

Welcome to the backend service for [**CushyAccess**](https://cushyaccess.com)!\
This backend is built with [**NestJS**](https://nestjs.com/) and powers core features like user management, virtual account generation, notifications, and secure APIs.

---

## 📂 Project Structure

```
.
├── coverage               # Jest test coverage reports
├── dist                   # Compiled JavaScript output
├── Dockerfile             # Docker container configuration
├── logger.service.ts      # Winston logging service
├── logs                   # Application logs
├── module                 # NestJS feature modules
├── nest-cli.json          # Nest CLI configuration
├── node_modules           # Node dependencies
├── package.json           # Project metadata
├── README.md              # Documentation
├── src                    # Source code
├── templates              # Handlebars email templates
├── test                   # Unit & E2E tests
├── tsconfig.build.json    # TypeScript build configuration
└── tsconfig.json          # TypeScript configuration
```

---

## ⚙️ Getting Started

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Set up environment variables**

   Copy the example file and update it with your secrets:

   ```bash
   cp .env.example .env
   ```

   Add your environment details:
   - PostgreSQL connection
   - JWT secrets
   - Paystack keys
   - Brevo (SendInBlue) keys
   - Twilio credentials
   - AWS S3 credentials

3. **Run the development server**

   ```bash
   npm run start:dev
   ```

   The server runs in watch mode for development.

---

## ✅ Major Integrations

| Service               | Purpose                                |
| --------------------- | -------------------------------------- |
| **NestJS**            | Scalable Node.js framework             |
| **TypeORM**           | PostgreSQL ORM                         |
| **Paystack**          | Dedicated virtual account generation   |
| **Brevo**             | Transactional & marketing emails       |
| **Twilio (obsolete)** | SMS & WhatsApp messaging               |
| **Termi SMS**         | SMS & Bulk SMS messaging               |
| **AWS S3 Bucket**     | File & image storage                   |
| **Firebase**          | Push notifications, and data analytics |
| **AWS**               | EC2, RDS, Secrets, Redis Elasticache   |
| **GCP**               | Google Maps API                        |
| **Supabase**          | Staging DB                             |
| **Gemini API**        | AI integration                         |

---

## 🗂️ Logging

Logging is handled with **Winston** and daily rotation.\
Logs are stored in the `/logs` folder.\
Check `logger.service.ts` for custom logic.

---

## ✉️ Email Templates

Transactional emails are rendered using **Handlebars** templates located in the `/templates` directory.

---

## 🧪 Testing

Run unit & E2E tests with **Jest**:

```bash
npm run test
npm run test:e2e
```

Coverage reports are generated in `/coverage`.

---

## 🐳 Docker

Use the provided `Dockerfile` to build and run the app in a container:

```bash
docker build -t cushyaccess-backend .
docker run -p 3000:3000 cushyaccess-backend
```

---

# Cushy AI orchestration

Cushy AI business logic, authorization, tool execution, chat history and
structured UI actions are owned by this NestJS service. Model providers never
receive database credentials and cannot execute arbitrary SQL.

Choose a provider with environment variables:

```env
# AWS Bedrock (default; uses the application's standard AWS credential chain)
CUSHY_AI_PROVIDER=bedrock
CUSHY_AI_AWS_REGION=eu-west-1
CUSHY_AI_BEDROCK_MODEL_ID=openai.gpt-oss-120b-1:0
CUSHY_AI_REQUEST_TIMEOUT_MS=45000

# Google Gemini alternative
# CUSHY_AI_PROVIDER=gemini
# CUSHY_AI_GEMINI_API_KEY=...
# CUSHY_AI_GEMINI_MODEL=gemini-2.5-flash
```

The existing `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` remain the single
credential pair for AWS services used by this backend. Attach the additional
least-privilege Bedrock policy using:
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCushyAiBedrockInference",
      "Effect": "Allow",
      "Action": "bedrock:InvokeModel",
      "Resource": "arn:aws:bedrock:eu-west-1::foundation-model/openai.gpt-oss-120b-1:0"
    }
  ]
} 
to that same IAM identity; its existing S3 policies remain unchanged:

```bash
aws iam put-user-policy \
  --user-name cushyaccess-app-bucket-s3-user \
  --policy-name CushyAiBedrockInvoke \
  --policy-json (attached above)
```

Run that command with an IAM administrator identity, not necessarily with the
application user's own credentials. OpenAI models in Bedrock do not require
AWS Marketplace subscription permissions. The same provider-neutral boundary
performs health symptom triage; the model only selects a bounded consultation
type and urgency while the backend remains authoritative for doctor
eligibility, availability, fees, wallet checks and appointment creation.

Approved company information can be created, edited, published/unpublished,
and permanently deleted in **Admin Dashboard → Settings → Cushy AI Company
Knowledge**. Both the UI and `/api/v1/cushy-ai/knowledge` API require the
`SUPER_ADMIN` role. Draft entries are never exposed to Cushy AI.

Health and Cushy AI voice input is transcribed by the device and submitted as
ordinary bounded text. No customer audio is uploaded to this backend or to a
separate transcription service. Model providers receive only bounded prompts
and tool results; database credentials and all business mutations remain
inside this backend.

---

## 👥 Developers

| Name                | GitHub                                         | Since               |
| ------------------- | ---------------------------------------------- | ------------------- |
| **Abiodun Samuel**  | [@samuel-874](https://github.com/samuel-874)   | Nov 2024 – Aug 2025 |
| **Adekola Taofeek** | [@Taofeek2438](https://github.com/Taofeek2438) | Mar 2025 – Present  |

---

## 🌐 Official Website

👉 [**CushyAccess.com**](https://cushyaccess.com)

---

## 📜 License

**UNLICENSED**

---

**🚀 Happy building, happy scaling!**
