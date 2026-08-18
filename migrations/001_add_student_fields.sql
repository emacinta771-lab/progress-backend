-- ============================================================
-- Migration 001: Add new student admission fields
-- Run this on your NeonDB via the SQL editor or psql
-- ============================================================

-- NOTE: student_code and lin_code are the same value.
-- The application sets student_code = lin_code on every
-- insert and update so existing queries keep working.

-- LIN code (Learner Identification Number) — primary student identifier
ALTER TABLE students ADD COLUMN IF NOT EXISTS lin_code VARCHAR(50);

-- Age (computed from DOB but stored for quick access/reporting)
ALTER TABLE students ADD COLUMN IF NOT EXISTS age INTEGER;

-- Additional location details beyond village
ALTER TABLE students ADD COLUMN IF NOT EXISTS location VARCHAR(255);

-- Religious denomination
ALTER TABLE students ADD COLUMN IF NOT EXISTS religious_denomination VARCHAR(100);

-- Orphan status
ALTER TABLE students ADD COLUMN IF NOT EXISTS orphan_status VARCHAR(20)
  DEFAULT 'None'
  CHECK (orphan_status IN ('None', 'Single', 'Double'));

-- Special needs
ALTER TABLE students ADD COLUMN IF NOT EXISTS special_needs BOOLEAN DEFAULT FALSE;
ALTER TABLE students ADD COLUMN IF NOT EXISTS special_needs_description TEXT;

-- ECD (Early Childhood Development) attendance
ALTER TABLE students ADD COLUMN IF NOT EXISTS ecd_attendance VARCHAR(3)
  DEFAULT 'No'
  CHECK (ecd_attendance IN ('Yes', 'No'));

-- Date the admission form was submitted
ALTER TABLE students ADD COLUMN IF NOT EXISTS submission_date DATE;

-- ============================================================
-- Sync existing student_code values into lin_code
-- (safe to run multiple times — only fills NULLs)
-- ============================================================
UPDATE students
SET lin_code = student_code
WHERE lin_code IS NULL AND student_code IS NOT NULL;

-- ============================================================
-- Unique index on lin_code
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_students_lin_code
  ON students (lin_code)
  WHERE lin_code IS NOT NULL;

-- ============================================================
-- Index on submission_date for reporting
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_students_submission_date
  ON students (submission_date);

-- ============================================================
-- Verify columns were added
-- ============================================================
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'students'
  AND column_name IN (
    'lin_code', 'age', 'location', 'religious_denomination',
    'orphan_status', 'special_needs', 'special_needs_description',
    'ecd_attendance', 'submission_date'
  )
ORDER BY column_name;
