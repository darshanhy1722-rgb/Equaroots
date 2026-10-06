-- Letterhead lines under the doctor's name (e.g. "Consultant Neuropsychiatrist",
-- and a gold-highlighted "Co-founder Equaroots").
alter table doctors add column if not exists designation text;
alter table doctors add column if not exists highlight text;

update doctors set designation = 'Consultant Neuropsychiatrist', highlight = 'Co-founder Equaroots'
 where regexp_replace(lower(display_name), '[^a-z0-9]', '', 'g') = 'drradhadangaich'
   and designation is null and highlight is null;

-- "Progression-" section of the prescription.
alter table consultations add column if not exists progression text;
