-- Several doctors may share one login/Cal.id email (e.g. hello@equaroots.com),
-- so email is no longer unique. Doctor matching falls back to the name when an
-- email is shared (see matchDoctor).
alter table doctors drop constraint if exists doctors_email_key;
create index if not exists doctors_email_lower_idx on doctors (lower(email));

-- Current doctor roster. Matched on normalised name so re-running is harmless
-- and existing rows (and their bookings) are updated in place.
create temporary table _roster (display_name text, role text, reg_no text, email text);
insert into _roster values
  ('Dr Radha Dangaich',     'MD Psychiatry (NIMHANS)', 'Reg No DMC/R/25251', 'hello@equaroots.com'),
  ('Dr Kshitij Srivastava', 'MD Psychiatry UPMC',      'Reg No DMC/R/34797', 'kshitij@equaroots.com'),
  ('Dr. Abhinav Pandey',    'MD Psychiatry UPMC',      'Reg No DMC/R/',      'hello@equaroots.com');

update doctors d set display_name = r.display_name, role = r.role, reg_no = r.reg_no, email = r.email
  from _roster r
 where regexp_replace(lower(d.display_name), '[^a-z0-9]', '', 'g') = regexp_replace(lower(r.display_name), '[^a-z0-9]', '', 'g');

insert into doctors (display_name, role, reg_no, email)
select r.display_name, r.role, r.reg_no, r.email from _roster r
 where not exists (
   select 1 from doctors d
    where regexp_replace(lower(d.display_name), '[^a-z0-9]', '', 'g') = regexp_replace(lower(r.display_name), '[^a-z0-9]', '', 'g'));

-- Re-link any bookings that arrived before their doctor existed.
update bookings b set doctor_id = d.id
  from doctors d
 where b.doctor_id is null
   and regexp_replace(lower(coalesce(b.doctor_name_raw, '')), '[^a-z0-9]', '', 'g') = regexp_replace(lower(d.display_name), '[^a-z0-9]', '', 'g');
drop table _roster;
