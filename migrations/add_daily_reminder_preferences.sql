ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "dailyReminderEnabled" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "dailyReminderTime" character varying(5) NOT NULL DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS "dailyReminderTimeZone" character varying(100) NOT NULL DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS "dailyReminderLastSentDate" character varying(10);

CREATE INDEX IF NOT EXISTS "IDX_users_daily_reminder_enabled_time"
  ON "users" ("dailyReminderEnabled", "dailyReminderTime")
  WHERE "dailyReminderEnabled" = true;
