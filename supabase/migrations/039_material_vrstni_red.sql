-- =====================================================================
-- FINES - Production | 039: Vrstni red nalogov za material
--
-- Proizvodnja -> Planiranje -> Pripravljenost materiala: ročni vrstni red
-- nalogov znotraj krovnega naloga, po katerem se razdeli zaloga in dobave.
-- Velja IZKLJUČNO za izračun materiala (odpreme in delovni plan ostanejo
-- nespremenjeni) in je uradni vrstni red za vse, dokler ga nekdo ne resetira.
-- Brez zapisa za krovni velja privzeti vrstni red (najzgodnejša odprema naloga).
--
-- Shranjevanje: stari zapisi krovnega -> visible = false, novi se vpišejo.
-- Reset: vsi zapisi krovnega -> visible = false (podatkov se ne briše).
-- Zaženi PO 001_schema.sql. Idempotentno. Dostop samo za prijavljene.
-- =====================================================================

create table if not exists fp_mat_vrstni_red (
  id           bigint generated always as identity primary key,
  krovni       text not null,     -- krovni delovni nalog
  st_naloga    text not null,     -- delovni nalog krovnega
  vrstni_red   integer not null,  -- 1 = prvi dobi material
  spremenil    text,              -- e-mail uporabnika, ki je shranil vrstni red
  visible      boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists fp_mat_vrstni_red_krovni_idx on fp_mat_vrstni_red(krovni) where visible;
create unique index if not exists fp_mat_vrstni_red_nalog_uq on fp_mat_vrstni_red(krovni, st_naloga) where visible;

drop trigger if exists fp_mat_vrstni_red_updated_at on fp_mat_vrstni_red;
create trigger fp_mat_vrstni_red_updated_at before update on fp_mat_vrstni_red
  for each row execute function fp_set_updated_at();

alter table fp_mat_vrstni_red enable row level security;
drop policy if exists fp_mat_vrstni_red_select on fp_mat_vrstni_red;
drop policy if exists fp_mat_vrstni_red_insert on fp_mat_vrstni_red;
drop policy if exists fp_mat_vrstni_red_update on fp_mat_vrstni_red;
create policy fp_mat_vrstni_red_select on fp_mat_vrstni_red for select to authenticated using (true);
create policy fp_mat_vrstni_red_insert on fp_mat_vrstni_red for insert to authenticated with check (true);
create policy fp_mat_vrstni_red_update on fp_mat_vrstni_red for update to authenticated using (true) with check (true);
