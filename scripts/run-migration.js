const { Client } = require('pg');
require('dotenv').config();

async function runMigration() {
  const client = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    await client.connect();
    console.log('Connected to database');

    const sql = `
      CREATE TABLE IF NOT EXISTS ai_usage_metrics (
        id VARCHAR(255) PRIMARY KEY,
        provider VARCHAR(50) NOT NULL,
        user_id VARCHAR(255),
        chat_id VARCHAR(255),
        request_count INTEGER DEFAULT 1,
        token_count INTEGER DEFAULT 0,
        error_count INTEGER DEFAULT 0,
        cost DECIMAL(10, 6) DEFAULT 0,
        response_time INTEGER DEFAULT 0,
        request_message TEXT,
        response_message TEXT,
        is_test BOOLEAN DEFAULT false,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_ai_usage_metrics_provider_created_at ON ai_usage_metrics(provider, created_at);
      CREATE INDEX IF NOT EXISTS idx_ai_usage_metrics_user_id_created_at ON ai_usage_metrics(user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_ai_usage_metrics_is_test ON ai_usage_metrics(is_test);
    `;

    await client.query(sql);
    console.log('Migration completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await client.end();
  }
}

runMigration();
