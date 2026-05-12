-- Remove user-group requirement from sections.
-- All authenticated users now default to 'user' role; only admin groups are needed.

UPDATE sections
SET entra_group_user = NULL
WHERE slug = 'pensjon';
