-- Maya delegates file writes and read-only shell commands to the employee assistant. A fresh
-- database gets these from the seed; this updates databases seeded before the assistant existed.
UPDATE users
SET entitlements = entitlements || '["files.write", "shell.exec"]'::jsonb
WHERE username = 'maya' AND NOT entitlements ? 'files.write';
