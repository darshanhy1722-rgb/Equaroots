-- Per-doctor prescription layout: 'modern' (default), 'sidebar' or 'classic'.
alter table doctors add column if not exists letterhead_layout text not null default 'modern';
