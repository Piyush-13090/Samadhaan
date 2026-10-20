-- Find problems left stuck by the room-closure dead end (KNOWN_LIMITATIONS B6).
--
-- READ-ONLY. It changes nothing. Run it before and after deploying the fix:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/ops/find-stuck-resolutions.sql
--
-- A problem is stuck when it is IN_PROGRESS under an ACCEPTED allocation, but its
-- work can no longer progress: the resolution room was closed, or the project was
-- cancelled. To recover one, an official of the allocating office withdraws the
-- allocation (problem page -> "Withdraw allocation", with a reason). That cancels
-- the allocation, cancels the project if unfinished, closes the room if open, and
-- returns the problem to VERIFIED for reallocation. It never marks it resolved.
-- Do not repair these rows by hand: the withdrawal writes the audit trail and
-- sends the notifications.
BEGIN READ ONLY;

SELECT p."publicId"              AS problem,
       p.status::text            AS problem_status,
       a.id                      AS allocation_id,
       g.slug                    AS office,
       o.name                    AS organisation,
       r.status::text            AS room_status,
       r."closedAt"              AS room_closed_at,
       rp.status::text           AS project_status,
       EXISTS (SELECT 1 FROM resolution_verification_requests v
                WHERE v."problemId" = p.id AND v.status = 'PENDING')
                                 AS verification_pending
  FROM problems p
  JOIN problem_allocations a   ON a."problemId" = p.id AND a.status = 'ACCEPTED'
  JOIN organizations g         ON g.id = a."governmentOrganizationId"
  JOIN organizations o         ON o.id = a."organizationId"
  JOIN resolution_rooms r      ON r."allocationId" = a.id
  LEFT JOIN resolution_projects rp ON rp."roomId" = r.id
 WHERE p.status = 'IN_PROGRESS'
   AND (r.status <> 'OPEN' OR rp.status = 'CANCELLED')
 ORDER BY r."closedAt" NULLS LAST, p."publicId";

ROLLBACK;
