-- Daniel and Priya may delegate model.load (CTL-SUP-001) to the test-only model-onboarding agent.
-- A fresh database gets this from the seed; this updates databases seeded before it existed.
UPDATE users
SET entitlements = entitlements || '["model.load"]'::jsonb
WHERE username IN ('daniel', 'priya') AND NOT entitlements ? 'model.load';
