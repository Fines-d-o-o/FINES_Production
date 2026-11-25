-- =====================================================================
-- FINES - Production | 040: Normativi operacij proizvodnje
--
-- Montaža naredi celoten normativ šifre na eni celici, proizvodnja pa ga razdeli na
-- stroje (delovna mesta). Zato ima vsaka šifra z normativom proizvodnje > 0 tudi
-- razdelitev normativa proizvodnje po operacijah.
--
-- fp_operacije:            šifrant operacij proizvodnje (skupine ERP operacij) in
--                          privzeto delovno mesto (fp_delovna_mesta); null = izbere se ob planu
--                          (npr. Krivljenje - 1 / 2, Varjenje - malo / veliko).
-- fp_normativi_operacije:  ure na kos po operaciji za normativ (spl_normativi).
--                          Vsota operacij mora biti enaka normativ_proizvodnja (kontrola v aplikaciji).
--
-- Tabela normativov operacij ostane PRAZNA - podatki se uvozijo šele po pregledu analize
-- (data/normativi proizvodnja/Analiza normativov proizvodnja.xlsx, zavihek 8).
-- Zaženi PO 039. Idempotentno. Dostop samo za prijavljene, brez DELETE.
-- =====================================================================

create table if not exists public.fp_operacije (
  id                bigint generated always as identity primary key,
  koda              text not null unique,
  naziv             text not null,
  oddelek_id        bigint not null references public.fp_oddelki(id),
  delovno_mesto_id  bigint references public.fp_delovna_mesta(id),
  vrstni_red        integer not null default 0,
  opomba            text,
  visible           boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.fp_normativi_operacije (
  id            bigint generated always as identity primary key,
  normativ_id   bigint not null references public.spl_normativi(id),
  operacija_id  bigint not null references public.fp_operacije(id),
  ure           numeric(10, 3) not null default 0,     -- h/kos
  opomba        text,
  visible       boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint fp_normativi_operacije_uq unique (normativ_id, operacija_id),
  constraint fp_normativi_operacije_ure check (ure >= 0)
);
create index if not exists fp_normativi_operacije_normativ_idx on public.fp_normativi_operacije(normativ_id);

-- Šifrant operacij proizvodnje (predlog - preveri delovna mesta)
insert into public.fp_operacije (koda, naziv, oddelek_id, delovno_mesto_id, vrstni_red, opomba)
select v.koda, v.naziv, o.id, dm.id, v.vrstni_red, v.opomba
from (values
  ('PROG', 'Programiranje',                       10, 'Razrez',              'ERP: Programiranje'),
  ('RAZ',  'Razrez',                              20, 'Razrez',              'ERP: Razrez - laser, prebijanje, TS razrez, razrez - ostalo'),
  ('KRIV', 'Krivljenje',                          30, null,                  'ERP: Krivljenje, TS krivljenje, TS vlek. Stroj (Krivljenje - 1 / 2) se izbere ob planu'),
  ('UPO',  'Uporovno varjenje',                   40, 'Varjenje - točkovno', 'ERP: Uporovno varjenje'),
  ('VAR',  'Varjenje',                            50, null,                  'ERP: TIG, MIG/MAG, laser, podpora, TS sestavljanje in varjenje. Mesto (malo / veliko) se izbere ob planu'),
  ('BRU',  'Brušenje',                            60, 'Brušenje',            'ERP: Brušenje'),
  ('VIJ',  'Vijaki in matice',                    70, 'Dodatno delo',        'ERP: Varjenje vijakov, vtiskovanje matic'),
  ('VRT',  'Vrtanje',                             80, 'Dodatno delo',        'ERP: Vrtanje'),
  ('FOL',  'Odstranjevanje folije - proizvodnja', 90, 'Dodatno delo',        'ERP: Odstranjevanje folije (delavec proizvodnje)'),
  ('SES',  'Sestavljanje - proizvodnja',         100, 'Dodatno delo',        'ERP: Sestavljanje (delavec proizvodnje), vrata, prezračevanje, generator, razrez izolacije')
) as v(koda, naziv, vrstni_red, dm_naziv, opomba)
join public.fp_oddelki o on o.koda = 'P'
left join public.fp_delovna_mesta dm on dm.naziv = v.dm_naziv and dm.oddelek_id = o.id and dm.visible
on conflict (koda) do nothing;

-- updated_at + RLS (samo prijavljeni, brez DELETE)
do $$
declare t text;
begin
  foreach t in array array['fp_operacije', 'fp_normativi_operacije'] loop
    execute format('drop trigger if exists %I on %I', t || '_updated_at', t);
    execute format(
      'create trigger %I before update on %I for each row execute function fp_set_updated_at()',
      t || '_updated_at', t);

    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format('drop policy if exists %I on %I', t || '_insert', t);
    execute format('drop policy if exists %I on %I', t || '_update', t);
    execute format('create policy %I on %I for select to authenticated using (true)', t || '_select', t);
    execute format('create policy %I on %I for insert to authenticated with check (true)', t || '_insert', t);
    execute format('create policy %I on %I for update to authenticated using (true) with check (true)', t || '_update', t);
    execute format('drop policy if exists fos_dostop on %I', t);
    execute format(
      'create policy fos_dostop on %I as restrictive for all to authenticated using ((select public.fos_ima_dostop(%L))) with check ((select public.fos_ima_dostop(%L)))',
      t, t, t);
    execute format('grant select, insert, update on %I to authenticated', t);
    execute format('revoke all on %I from anon', t);
  end loop;
end;
$$;
