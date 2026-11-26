-- =====================================================================
-- FINES - Production | 043: Prevzem iz proizvodnje (za Višek materiala)
--
-- Uvoz izvoza "Prevzem iz proizvodnje" (Prevzem_proizvodnja.xlsx): koliko kosov izdelka je
-- bilo z delovnega naloga prevzetih na zalogo. Višek materiala lahko nastane, ker je prevzetih
-- manj kosov, kot je razpisanih (npr. 9 od 10 peči - ena ni bila narejena), material pa je
-- bil izdan za vse.
--
-- fp_vis_prevzemi: izvoz je seštet po nalogu + izdelku (izvoz ima vrstico na kos / saržo).
--   Nalog = stolpec "Postavka - Delovni nalog" (glava prevzema lahko združuje več nalogov).
--   Aktiven je zadnji uvoz (posnetek, ~1.200 vrstic).
-- Sync: nov par ključ / tabela v fp_sync_zakleni (ostalo enako kot v 038).
-- RLS po vzoru 041: samo authenticated, brez DELETE. Zaženi PO 042. Idempotentno.
-- =====================================================================

begin;

create table if not exists public.fp_vis_prevzemi_uvozi (
  id           bigint generated always as identity primary key,
  datoteka     text not null,
  st_postavk   integer not null default 0,
  obdobje_od   date,             -- prvi datum prevzema v izvozu
  obdobje_do   date,             -- zadnji datum prevzema v izvozu
  aktiven      boolean not null default false,  -- aplikacija ga aktivira, ko so vse vrstice vpisane
  visible      boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.fp_vis_prevzemi (
  id            bigint generated always as identity primary key,
  uvoz_id       bigint not null references public.fp_vis_prevzemi_uvozi(id),
  st_naloga     text not null,
  ident         text not null,     -- proizvodna šifra prevzetega izdelka
  naziv         text,
  em            text,
  kolicina      numeric(14, 3) not null default 0,  -- prevzeto skupaj
  st_prevzemov  integer not null default 0,
  prvi_datum    date,
  zadnji_datum  date,
  visible       boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists fp_vis_prevzemi_uvoz_nalog_idx on public.fp_vis_prevzemi(uvoz_id, st_naloga);

drop trigger if exists fp_vis_prevzemi_uvozi_deaktiviraj on public.fp_vis_prevzemi_uvozi;
create trigger fp_vis_prevzemi_uvozi_deaktiviraj
  after insert or update of aktiven on public.fp_vis_prevzemi_uvozi
  for each row execute function public.fp_doi_uvozi_deaktiviraj();

do $$
declare t text;
begin
  foreach t in array array['fp_vis_prevzemi_uvozi', 'fp_vis_prevzemi'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.fp_set_updated_at()', t || '_updated_at', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (true)', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (true) with check (true)', t || '_update', t);
    execute format('revoke all on public.%I from anon, public', t);
    execute format('revoke delete, truncate, references, trigger on public.%I from authenticated', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
    execute format('revoke all on sequence public.%I from anon, public', t || '_id_seq');
    execute format('grant usage, select on sequence public.%I to authenticated', t || '_id_seq');
  end loop;
end;
$$;

-- Sync: dovoljen par ključ / tabela za prevzem iz proizvodnje (ostalo enako kot v 038)
create or replace function public.fp_sync_zakleni(p_kljuc text, p_tabela text, p_cas timestamp with time zone)
 returns text
 language plpgsql
 set search_path to 'public'
as $function$
declare v_izvoz timestamptz; v_uvoz timestamptz; v_zaklep timestamptz; v_kdo text;
begin
  if not exists (select 1 from (values
    ('nalogi','fp_zas_uvozi'), ('material','spl_material_uvozi'), ('narocila','fp_pri_uvozi'),
    ('odpreme','fp_pri_odp_uvozi'), ('prevzemi','fp_doi_prevzemi_uvozi'), ('izdaje','fp_doi_izdaje_uvozi'),
    ('identi','spl_identi_uvozi'), ('kosovnice','spl_kosovnice_uvozi'), ('porocano','fp_por_uvozi'),
    ('dobave','fp_mat_dobave_uvozi'), ('prevzemi_proizvodnje','fp_vis_prevzemi_uvozi')
  ) as t(k,v) where k=p_kljuc and v=p_tabela) then raise exception 'Neznan par ključ/tabela'; end if;
  perform pg_advisory_xact_lock(hashtext('fp_sync:' || p_kljuc));
  select izvoz_cas,zaklenjeno_at,zaklenil into v_izvoz,v_zaklep,v_kdo from fp_sync_stanje where kljuc=p_kljuc;
  if p_cas is not null then
    if v_izvoz is not null and v_izvoz>=p_cas then return 'uvozeno'; end if;
    if v_izvoz is null then
      execute format('select max(created_at) from %I where aktiven and visible',p_tabela) into v_uvoz;
      if v_uvoz is not null and v_uvoz>=p_cas then return 'uvozeno'; end if;
    end if;
  end if;
  if v_zaklep is not null and v_zaklep>now()-interval '5 minutes' then return 'zaklenjeno:' || coalesce(v_kdo,''); end if;
  insert into fp_sync_stanje(kljuc,zaklenjeno_at,zaklenil) values(p_kljuc,now(),auth.jwt()->>'email')
    on conflict(kljuc) do update set zaklenjeno_at=now(),zaklenil=auth.jwt()->>'email';
  return 'ok';
end $function$;
revoke all on function public.fp_sync_zakleni(text, text, timestamptz) from public, anon;
grant execute on function public.fp_sync_zakleni(text, text, timestamptz) to authenticated;

commit;
