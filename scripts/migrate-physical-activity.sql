-- One-time migration: merge Walking/Stretching/Weights/Gym (items 10/19/20/21)
-- in the Health section (id=2) into a single "Physical Activity" multi-item.
-- Past ticks + the weights notes are backfilled; old items are soft-deleted.
BEGIN;

INSERT INTO transformation_items (section_id, label, sort_order, kind, options, created_at)
VALUES (
  2,
  'Physical Activity',
  2,
  'multi',
  '["Walking 6k steps","Stretching","Simple weights","Gym"]',
  unixepoch()
);

-- 2026-05-22 (day_id 1): Walking ✓, Stretching ✓, Weights (note)
INSERT INTO transformation_checks (day_id, item_id, checked, text_value)
VALUES (
  1,
  (SELECT id FROM transformation_items WHERE section_id=2 AND label='Physical Activity' AND deleted_at IS NULL),
  1,
  '{"selected":["Walking 6k steps","Stretching","Simple weights"],"note":"Hand grips 60 kg"}'
);

-- 2026-05-23 (day_id 2): Walking ✓, Stretching ✓, Weights (note)
INSERT INTO transformation_checks (day_id, item_id, checked, text_value)
VALUES (
  2,
  (SELECT id FROM transformation_items WHERE section_id=2 AND label='Physical Activity' AND deleted_at IS NULL),
  1,
  '{"selected":["Walking 6k steps","Stretching","Simple weights"],"note":"Hand gripper -  COuple of reps for triceps"}'
);

-- 2026-05-25 (day_id 4): Walking ✓, Weights (note), Gym ✓
INSERT INTO transformation_checks (day_id, item_id, checked, text_value)
VALUES (
  4,
  (SELECT id FROM transformation_items WHERE section_id=2 AND label='Physical Activity' AND deleted_at IS NULL),
  1,
  '{"selected":["Walking 6k steps","Simple weights","Gym"],"note":"Row Pull, Lat Raise, Pec Fly, Push ups, Tricep push down"}'
);

-- Soft-delete the four old items (history rows retained in DB, just hidden).
UPDATE transformation_items SET deleted_at=unixepoch() WHERE id IN (10,19,20,21);

COMMIT;
