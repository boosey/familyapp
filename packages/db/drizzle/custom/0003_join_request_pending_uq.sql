-- At most one PENDING join request per (family, requester). Approved/declined rows may coexist,
-- so a requester whose earlier request was declined can ask again later. A partial unique index is
-- the right tool (drizzle-kit cannot express the WHERE clause), and it closes the phantom-read race
-- a transaction alone cannot under READ COMMITTED: two concurrent createJoinRequest calls both
-- SELECT "no pending" and both INSERT — the index makes the second INSERT fail (mapped in the
-- repository to the existing "a pending request already exists" InvariantViolation). See ADR-0001.
CREATE UNIQUE INDEX IF NOT EXISTS join_requests_one_pending_uq
  ON join_requests (family_id, requester_person_id)
  WHERE status = 'pending';
