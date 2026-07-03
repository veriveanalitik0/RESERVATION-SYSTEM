-- Eşzamanlı advanceLifecycle çağrıları aynı talep+tip için iki 'pending' onay
-- açabiliyordu (check-then-insert yarışı); decideApproval rastgele birini karara
-- bağlayınca diğeri geçişi süresiz blokluyordu. Kısmi unique index yarışı DB
-- seviyesinde kapatır (createPendingApproval ON CONFLICT DO NOTHING kullanır).
CREATE UNIQUE INDEX IF NOT EXISTS uq_human_approvals_pending
  ON human_approvals (request_id, approval_type)
  WHERE decision = 'pending';
