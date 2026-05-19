-- Sentry-style 5-tier org roles: billing, member, admin, manager, owner.
--
-- Before this migration, the org "admin" role granted admin-on-all-projects.
-- Sentry's "admin" only grants admin on projects you're explicitly added to,
-- and "manager" is the new role that grants admin-on-all-projects. To preserve
-- existing org admins' access, we rename their role from 'admin' to 'manager'.
--
-- 'member' rows stay 'member' but lose auto-editor on projects (they become
-- viewers across the org and need direct project invites for write access).
-- Pre-launch this is acceptable; document via release notes.
--
-- The role column is plain text — no enum to alter.

UPDATE "member" SET "role" = 'manager' WHERE "role" = 'admin';
