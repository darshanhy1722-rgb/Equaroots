-- Master list of clinic patient IDs (ER/<yy>/<nn>), loaded from the clinic's register and
-- extended automatically as new patients book. Used so returning patients keep their ID.
create table if not exists patients (
  patient_id  text primary key,
  name        text,
  email       text,
  lead_doctor text,
  source      text not null default 'register',   -- 'register' | 'auto'
  created_at  timestamptz not null default now()
);
create index if not exists patients_email_idx on patients (lower(email));
