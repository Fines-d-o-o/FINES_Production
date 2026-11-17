-- =====================================================================
-- FINES - Production | 038: Dobave materiala (naročila dobaviteljem)
--
-- Uvoz izvoza "Naročila dobavitelju" (Narocila_dobavitelju.xlsx) - vir rokov
-- dobave za Proizvodnja -> Planiranje -> Pripravljenost materiala.
-- Shranijo se samo ODPRTE postavke:
--   - ni okvirno naročilo (okvirna so napoved, ERP jih ne šteje v naročeno),
--   - glava (Zaprto) in postavka (Zaprt) nista zaprti,
--   - odprto = količina - prevzeta količina > 0.
-- Seštevek odprto po identu se ujema z "Naročena količina (5)" v spl_material.
--
-- Rok dobave (rok) = prvi znan: potrjen rok postavke -> potrjen rok glave ->
-- želeni rok postavke -> želeni rok glave -> predviden datum (naročilo + dni nabave).
-- vrsta_roka pove, od kod je rok: potrjen | zeljen | predviden.
-- Aktiven je zadnji uvoz. Zaženi PO 001_schema.sql. Idempotentno. Dostop samo za prijavljene.
-- =====================================================================

create table if not exists fp_mat_dobave_uvozi (
  id           bigint generated always as identity primary key,
  datoteka     text not null,
  st_postavk   integer not null default 0,
  aktiven      boolean not null default false,  -- aplikacija ga aktivira, ko so vse vrstice vpisane
  visible      boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists fp_mat_dobave (
  id                 bigint generated always as identity primary key,
  uvoz_id            bigint not null references fp_mat_dobave_uvozi(id),
  vd                 text,             -- vrsta dokumenta (121, 127 ...)
  stevilka           text not null,    -- številka naročila
  datum              date,             -- datum naročila
  dobavitelj         text,             -- šifra dobavitelja
  naziv_dobavitelja  text,
  referent           text,             -- nabavni referent
  delovni_nalog      text,             -- naročeno za delovni nalog (postavka ali glava)
  potrjeno           boolean not null default false,  -- dobavitelj je potrdil naročilo
  ident              text not null,    -- proizvodna šifra
  naziv              text,
  em                 text,
  kolicina           numeric(14, 3) not null default 0,
  prevzeto           numeric(14, 3) not null default 0,
  odprto             numeric(14, 3) not null default 0,  -- kolicina - prevzeto
  rok_potrjen        date,
  rok_zeljen         date,
  predviden          date,
  rok                date,             -- efektivni rok (glej zgoraj)
  vrsta_roka         text,             -- potrjen | zeljen | predviden
  visible            boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists fp_mat_dobave_uvoz_idx on fp_mat_dobave(uvoz_id);

-- Ko uvoz postane aktiven, prejšnji uvozi niso več aktivni (funkcija iz 023)
drop trigger if exists fp_mat_dobave_uvozi_deaktiviraj on fp_mat_dobave_uvozi;
create trigger fp_mat_dobave_uvozi_deaktiviraj
  after insert or update of aktiven on fp_mat_dobave_uvozi
  for each row execute function fp_doi_uvozi_deaktiviraj();

-- Sync: dovoljen par ključ / tabela za dobave (ostalo enako kot v 036)
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
    ('dobave','fp_mat_dobave_uvozi')
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

-- updated_at + RLS (samo prijavljeni, brez DELETE)
do $$
declare t text;
begin
  foreach t in array array['fp_mat_dobave_uvozi', 'fp_mat_dobave'] loop
    execute format('drop trigger if exists %I on %I', t || '_updated_at', t);
    execute format(
      'create trigger %I before update on %I for each row execute function fp_set_updated_at()',
      t || '_updated_at', t);

    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format('drop policy if exists %I on %I', t || '_insert', t);
    execute format('drop policy if exists %I on %I', t || '_update', t);
    execute format(
      'create policy %I on %I for select to authenticated using (true)', t || '_select', t);
    execute format(
      'create policy %I on %I for insert to authenticated with check (true)', t || '_insert', t);
    execute format(
      'create policy %I on %I for update to authenticated using (true) with check (true)',
      t || '_update', t);
  end loop;
end;
$$;
