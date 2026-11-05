const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function runMigration() {
  const requiredEnvironment = [
    'DB_HOST',
    'DB_USERNAME',
    'DB_PASSWORD',
    'DB_DATABASE',
  ];
  const missingEnvironment = requiredEnvironment.filter(
    (key) => !process.env[key],
  );
  if (missingEnvironment.length > 0) {
    throw new Error(
      `Missing database configuration: ${missingEnvironment.join(', ')}`,
    );
  }

  const caPath = path.join(__dirname, '..', 'src', 'ca.pem');
  if (!fs.existsSync(caPath)) {
    throw new Error(`Database CA certificate not found at ${caPath}`);
  }

  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    ssl: {
      require: true,
      rejectUnauthorized: false,
      ca: fs.readFileSync(caPath),
    },
    connectionTimeoutMillis: 10000,
  });

  let connected = false;
  try {
    await client.connect();
    connected = true;
    const migration = fs.readFileSync(
      path.join(__dirname, '..', 'migrations', 'add_daily_reminder_preferences.sql'),
      'utf8',
    );
    await client.query(migration);
    console.log('Daily reminder schema migration applied.');
  } finally {
    if (connected) await client.end();
  }
}

runMigration().catch((error) => {
  console.error(
    `Daily reminder schema migration failed: ${
      error instanceof Error ? error.message : 'unknown error'
    }`,
  );
  process.exitCode = 1;
});
