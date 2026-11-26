-- =====================================================================
-- FINES - Production | 042: Orodja - Višek materiala
--
-- Višek materiala ostane na celici po ZAKLJUČENEM nalogu. Uvoz "Kreiranje izdaj v
-- proizvodnjo" (fp_doi_izdaje) hrani samo aktivne naloge (Doizdaja, Pripravljenost),
-- zato zaključeni nalogi dobijo svojo tabelo:
--
--   fp_vis_izdaje - material zaključenih nalogov (status Z) zadnjih ~13 mesecev, en zapis
--                   na nalog + ident (v izvozu je par unikaten). Uvoz izdaj (sync) vpiše
--                   naloge, ki jih še ni, in posodobi naloge z rokom v zadnjih 60 dneh
--                   (povratnica lahko spremeni zaključen nalog). Ni posnetkov po uvozih -
--                   vsak sync bi sicer dodal ~50.000 vrstic.
--                   porabljeno / planirano sta lahko NULL (izvoz nima podatka) - to ni 0.
--
--   fp_vis_nalogi()          - nalogi za izbiro na strani: zadnji znani podatek vsakega
--                              naloga iz VSEH uvozov nalogov (krovni DN; zaključeni izpadejo
--                              iz zadnjega uvoza) + zaključeni nalogi iz fp_vis_izdaje.
--   fp_vis_izdaje_nalogi(od) - nalogi, ki so že v fp_vis_izdaje (uvoz vpiše samo nove).
--
-- RLS po vzoru 041: samo authenticated, brez DELETE. Zaženi PO 041. Idempotentno.
-- =====================================================================

begin;

create table if not exists public.fp_vis_izdaje (
  id                  bigint generated always as identity primary key,
  uvoz_id             bigint references public.fp_doi_izdaje_uvozi(id),  -- zadnji uvoz, ki je zapis vpisal / posodobil
  st_naloga           text not null,
  opis                text,
  koda_artikla        text,
  naziv_artikla       text,
  status              text,
  status_naloga       text,
  rok_izdelave        date,
  razpisana_kolicina  numeric(14, 3) not null default 0,
  ident               text not null,
  naziv               text,
  skupina             text,
  skl                 text,
  em                  text,
  porabljeno          numeric(14, 3),   -- izdano na nalog (NULL = izvoz nima podatka)
  planirano           numeric(14, 3),   -- planirano na DN (NULL = izvoz nima podatka)
  za_izdajo           numeric(14, 3),
  visible             boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint fp_vis_izdaje_uq unique (st_naloga, ident)
);
create index if not exists fp_vis_izdaje_ident_idx on public.fp_vis_izdaje(ident);
create index if not exists fp_vis_izdaje_rok_idx on public.fp_vis_izdaje(rok_izdelave);

drop trigger if exists fp_vis_izdaje_updated_at on public.fp_vis_izdaje;
create trigger fp_vis_izdaje_updated_at before update on public.fp_vis_izdaje
  for each row execute function public.fp_set_updated_at();

alter table public.fp_vis_izdaje enable row level security;
drop policy if exists fp_vis_izdaje_select on public.fp_vis_izdaje;
drop policy if exists fp_vis_izdaje_insert on public.fp_vis_izdaje;
drop policy if exists fp_vis_izdaje_update on public.fp_vis_izdaje;
create policy fp_vis_izdaje_select on public.fp_vis_izdaje for select to authenticated using (true);
create policy fp_vis_izdaje_insert on public.fp_vis_izdaje for insert to authenticated with check (true);
create policy fp_vis_izdaje_update on public.fp_vis_izdaje for update to authenticated using (true) with check (true);
revoke all on public.fp_vis_izdaje from anon, public;
revoke delete, truncate, references, trigger on public.fp_vis_izdaje from authenticated;
grant select, insert, update on public.fp_vis_izdaje to authenticated;
revoke all on sequence public.fp_vis_izdaje_id_seq from anon, public;
grant usage, select on sequence public.fp_vis_izdaje_id_seq to authenticated;

-- Indeks za iskanje zadnjega znanega podatka naloga čez vse uvoze nalogov
create index if not exists fp_zas_nalogi_nalog_uvoz_idx on public.fp_zas_nalogi(st_naloga, uvoz_id desc);

create or replace function public.fp_vis_nalogi()
returns table (
  st_naloga text, krovni_dn text, koda_artikla text, naziv_artikla text,
  razpisana_kolicina numeric, izdelana_kolicina numeric, status text, rok_izdelave date, zakljucen boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with aktiven as (
    select id from fp_zas_uvozi where aktiven and visible order by created_at desc limit 1
  ),
  z as (
    select distinct on (n.st_naloga) n.st_naloga, n.krovni_dn, n.koda_artikla, n.naziv_artikla,
           n.razpisana_kolicina, n.izdelana_kolicina, n.status, n.rok_izdelave, n.uvoz_id
    from fp_zas_nalogi n
    where n.visible
    order by n.st_naloga, n.uvoz_id desc
  ),
  i as (
    select distinct on (v.st_naloga) v.st_naloga, v.koda_artikla, v.naziv_artikla,
           v.razpisana_kolicina, v.status, v.rok_izdelave
    from fp_vis_izdaje v
    where v.visible
    order by v.st_naloga
  )
  select coalesce(z.st_naloga, i.st_naloga),
         z.krovni_dn,
         coalesce(z.koda_artikla, i.koda_artikla),
         coalesce(z.naziv_artikla, i.naziv_artikla),
         coalesce(z.razpisana_kolicina, i.razpisana_kolicina),
         z.izdelana_kolicina,
         coalesce(i.status, z.status),
         coalesce(z.rok_izdelave, i.rok_izdelave),
         -- zaključen: v izdajah ima status Z ali ga ni več v zadnjem uvozu nalogov
         (i.st_naloga is not null) or (z.uvoz_id is distinct from (select id from aktiven))
  from z
  full join i on i.st_naloga = z.st_naloga
  order by 1;  -- stalen vrstni red za branje po straneh (range)
$$;

create or replace function public.fp_vis_izdaje_nalogi(p_od date)
returns table (st_naloga text)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct v.st_naloga from fp_vis_izdaje v
  where v.visible and (p_od is null or v.rok_izdelave is null or v.rok_izdelave >= p_od)
  order by 1;
$$;

revoke all on function public.fp_vis_nalogi(), public.fp_vis_izdaje_nalogi(date) from public, anon;
grant execute on function public.fp_vis_nalogi(), public.fp_vis_izdaje_nalogi(date) to authenticated;

commit;
