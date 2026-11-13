-- Run once against the Neon branch used by BunkBudget before deploying the
-- Cloudflare Worker. This preserves existing users and attendance rows.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name VARCHAR(120),
    student_class VARCHAR(80),
    email VARCHAR(254),
    usn VARCHAR(10),
    registration_number VARCHAR(40),
    phone_number VARCHAR(20),
    role VARCHAR(20) NOT NULL DEFAULT 'student',
    hashed_password VARCHAR(255) NOT NULL
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name VARCHAR(120);
ALTER TABLE users ADD COLUMN IF NOT EXISTS student_class VARCHAR(80);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(254);
ALTER TABLE users ADD COLUMN IF NOT EXISTS usn VARCHAR(10);
ALTER TABLE users ADD COLUMN IF NOT EXISTS registration_number VARCHAR(40);
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'student';

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_ci
    ON users (lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_usn_ci
    ON users (lower(usn)) WHERE usn IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_registration_ci
    ON users (lower(registration_number)) WHERE registration_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS subject_attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_uuid UUID NOT NULL,
    subject_name VARCHAR(60) NOT NULL,
    classes_attended INTEGER NOT NULL DEFAULT 0,
    total_classes INTEGER NOT NULL DEFAULT 0,
    target_percentage DOUBLE PRECISION NOT NULL DEFAULT 75.0,
    client_subject_id VARCHAR(100) NOT NULL,
    CONSTRAINT uq_attendance_user_client_subject
        UNIQUE (user_uuid, client_subject_id)
);

CREATE INDEX IF NOT EXISTS ix_subject_attendance_user_uuid
    ON subject_attendance (user_uuid);
