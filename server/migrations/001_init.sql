-- EquaRoots core schema (spec §5)

create table if not exists doctors (
  id            serial primary key,
  display_name  text not null,
  role          text,
  reg_no        text,
  signature_url text,
  email         text unique not null,
  created_at    timestamptz not null default now()
);

create table if not exists medicines (
  id    serial primary key,
  name  text not null,
  notes text
);

create table if not exists bookings (
  id              serial primary key,
  cal_uid         text unique,
  patient_id      text,
  patient_type    text,
  patient_name    text not null,
  age             text,
  gender          text,
  patient_email   text,
  patient_phone   text,
  doctor_id       integer references doctors(id),
  doctor_name_raw text,
  doctor_email_raw text,
  start_time      timestamptz,
  end_time        timestamptz,
  meet_link       text,
  description     text,
  status          text not null,
  pdf_url         text,
  raw_payload     jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists bookings_doctor_id_idx  on bookings (doctor_id);
create index if not exists bookings_patient_id_idx on bookings (patient_id);
create index if not exists bookings_status_idx     on bookings (status);

create table if not exists consultations (
  id              serial primary key,
  booking_id      integer references bookings(id),
  prescription_id text unique,
  patient_name    text,
  age             text,
  gender          text,
  email           text,
  phone           text,
  patient_uid     text,
  doctor_id       integer references doctors(id),
  impression      text,
  advice          text,
  medicines_json  jsonb,
  status          text not null,
  pdf_url         text,
  approved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists consultations_booking_id_idx  on consultations (booking_id);
create index if not exists consultations_patient_uid_idx on consultations (patient_uid);

create table if not exists webhook_logs (
  id             serial primary key,
  received_at    timestamptz not null default now(),
  ok             boolean not null,
  trigger_event  text,
  cal_uid        text,
  note           text,
  raw_payload    jsonb
);

-- Runtime-rotatable settings (e.g. the Cal webhook HMAC secret after
-- POST /api/admin/reassign-token). Falls back to env vars when absent.
create table if not exists app_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
