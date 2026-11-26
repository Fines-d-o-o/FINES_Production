-- =====================================================================
-- FINES - Production | 044: Odstopanja zaključenih krovnih (Produktivnost → Zaključeni krovni)
--
-- Povratna informacija o odstopanju krovnega od normativa: klik na krovni odpre desni panel,
-- ki izračuna strošek ur nad normativom (delo + delovno mesto + oportunitetni strošek), vodja
-- izbere vzrok, napiše razlago in shrani (nato izvoz e-maila za Outlook).
--
-- fp_odst_nastavitve: urne postavke (skupne za vse), ključ / vrednost:
--   cena_dela            €/h - strošek ure delavca
--   cena_delovnega_mesta €/h - strošek ure delovnega mesta / stroja
--   oportunitetni        €/h - izgubljen dobiček na uro kapacitete (smo polni):
--                        (povprečna cena peči - lastna cena) / normativne ure peči
--                        npr. FB5: (5.200 € - 2.089 €) / 14,5 h ≈ 215 €/h; privzeto 200 €/h (spodnja meja)
-- fp_odst_krovni: en zapis na krovni + oddelek (zadnji velja). Shrani POSNETEK ur, postavk in
--   zneskov ob shranjevanju - poznejša sprememba postavk ne spremeni starih zapisov.
--   avtor / uredil se zapišeta v bazi (prijavljeni e-mail).
--
-- RLS: samo authenticated, brez DELETE (visible). Pisanje samo z dostopom do strani Produktivnost
-- (fp_ima_stran iz 033). Zaženi PO 043. Idempotentno.
-- =====================================================================

begin;

create table if not exists public.fp_odst_nastavitve (
  id          bigint generated always as identity primary key,
  kljuc       text not null unique,
  vrednost    numeric(12, 2) not null default 0,
  visible     boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

insert into public.fp_odst_nastavitve (kljuc, vrednost) values
  ('cena_dela', 25), ('cena_delovnega_mesta', 25), ('oportunitetni', 200)
on conflict (kljuc) do nothing;

create table if not exists public.fp_odst_krovni (
  id                    bigint generated always as identity primary key,
  krovni                text not null,
  oddelek               text not null,           -- koda oddelka (P, M, E, T)
  celica                text,                     -- delovno mesto ob shranjevanju
  zakljucen             date,                     -- datum zaključka krovnega
  normativ_ure          numeric(10, 2) not null default 0,
  stempljane_ure        numeric(10, 2) not null default 0,
  razlika_ure           numeric(10, 2) not null default 0,  -- štempljano - normativ (+ = več ur)
  produktivnost         numeric(8, 4),
  cena_dela             numeric(12, 2) not null default 0,
  cena_delovnega_mesta  numeric(12, 2) not null default 0,
  oportunitetni         numeric(12, 2) not null default 0,
  strosek_dela          numeric(12, 2) not null default 0,
  strosek_delovnega_mesta numeric(12, 2) not null default 0,
  strosek_oportunitetni numeric(12, 2) not null default 0,
  strosek_skupaj        numeric(12, 2) not null default 0,
  vzrok                 text,
  razlaga               text,
  avtor                 text default (auth.jwt() ->> 'email'),
  uredil                text default (auth.jwt() ->> 'email'),
  visible               boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index if not exists fp_odst_krovni_krovni_oddelek_idx on public.fp_odst_krovni (krovni, oddelek) where visible;

-- uredil = prijavljeni ob vsaki spremembi (ne glede na to, kaj pošlje aplikacija)
create or replace function public.fp_odst_krovni_uredil()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.uredil := coalesce(auth.jwt() ->> 'email', new.uredil);
  if tg_op = 'INSERT' then new.avtor := coalesce(auth.jwt() ->> 'email', new.avtor); end if;
  return new;
end $$;
revoke all on function public.fp_odst_krovni_uredil() from public, anon;

drop trigger if exists fp_odst_krovni_uredil on public.fp_odst_krovni;
create trigger fp_odst_krovni_uredil before insert or update on public.fp_odst_krovni
  for each row execute function public.fp_odst_krovni_uredil();

do $$
declare t text;
begin
  foreach t in array array['fp_odst_nastavitve', 'fp_odst_krovni'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.fp_set_updated_at()', t || '_updated_at', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.fp_ima_stran(''/proizvodnja/zasedenost/produktivnost''))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.fp_ima_stran(''/proizvodnja/zasedenost/produktivnost'')) with check (public.fp_ima_stran(''/proizvodnja/zasedenost/produktivnost''))', t || '_update', t);
    execute format('revoke all on public.%I from anon, public', t);
    execute format('revoke delete, truncate, references, trigger on public.%I from authenticated', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
    execute format('revoke all on sequence public.%I from anon, public', t || '_id_seq');
    execute format('grant usage, select on sequence public.%I to authenticated', t || '_id_seq');
  end loop;
end;
$$;

commit;
