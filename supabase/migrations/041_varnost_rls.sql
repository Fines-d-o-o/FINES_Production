-- =====================================================================
-- FINES - Production | 041: varnost - zaklep baze za neprijavljene (anon)
--
-- ZAKAJ: na produkciji so tabele iz 001 / 002 / 004 / 005 (npr. spl_normativi,
-- fp_delovna_mesta, fp_zas_nalogi, fp_pri_postavke) in slike v košari
-- fp-rutina-slike dostopne BREZ prijave, samo z javnim (publishable) ključem -
-- politike so še vedno "to anon, authenticated" (006 ni v veljavi ali pa je bila
-- katera od 001-005 pozneje znova zagnana in je politike vrnila na anon).
-- Poleg tega ima vloga anon privzete pravice (grant) na vseh tabelah, tako da je
-- edina obramba RLS.
--
-- KAJ NAREDI (samo za objekte te aplikacije - seznam spodaj; fos_*, wi_*,
-- spl_identi in druge skupne objekte pusti pri miru):
--   1. RLS vklopi na vseh tabelah aplikacije.
--   2. Vse politike, ki veljajo za anon ali public, preklopi na authenticated.
--   3. Vlogama anon in public odvzame vse pravice na tabelah in sekvencah
--      (druga plast obrambe - tudi če kdo spet doda politiko za anon).
--   4. Prijavljenim (authenticated) izrecno dodeli select / insert / update
--      (ne zanaša se na privzete pravice projekta) in odvzame delete / truncate /
--      references / trigger. Tabele, ki se pišejo samo prek funkcij
--      (fp_uporabniki, fp_vijacni_*, fp_usp_*), ostanejo samo za branje.
--   5. Funkcije (RPC): odvzame execute vlogama public in anon, dodeli authenticated;
--      vsem funkcijam brez search_path nastavi search_path = public.
--   6. Kontrola: če po tem katerakoli tabela aplikacije ostane odprta za anon,
--      se cela transakcija razveljavi z napako.
--   7. Storage (ločeno, da morebitna napaka ne razveljavi točk 1-6):
--      politike fp_slike_* samo za authenticated, košara ni javna.
--   8. Na koncu izpiše pregled preostalih odprtih objektov v shemi public
--      (tudi objektov drugih aplikacij) - pričakovano 0 vrstic.
--
-- Idempotentno; deluje na obstoječi bazi, na prenešeni (dump / restore) in na
-- novi bazi po migracijah 001-040. Tabele, ki še ne obstajajo (npr. 040), preskoči.
-- POZOR pri novi bazi: 030+ potrebujejo objekte FinOS / WorkInstructions
-- (fos_ima_dostop, fos_zaposleni, spl_identi) - ti morajo obstajati pred 030.
-- Aplikacija pred prijavo ne bere ničesar iz baze (samo Supabase Auth), zato
-- ta migracija ne spremeni delovanja za prijavljene uporabnike. Spremeni pa:
--   - skripte, ki berejo samo z javnim ključem brez prijave, ne delujejo več
--     (data/normativi proizvodnja/analiza_normativov.py bere spl_normativi),
--   - DELETE na tabelah aplikacije vrne "permission denied" (prej 0 vrstic zaradi RLS).
-- Preizkušeno na lokalnem Postgresu (PGlite) po 001-040 brez 006: dvakratni zagon,
-- anon zavrnjen, prijavljeni berejo / pišejo, prožilci in RPC delujejo.
-- Zaženi PO 040 (in ponovno po vsaki ponovitvi katerekoli migracije 001-005!).
-- =====================================================================

begin;

do $$
declare
  -- Tabele, ki jih aplikacija piše neposredno (select / insert / update)
  t_pisanje text[] := array[
    'fp_oddelki', 'fp_delovna_mesta', 'fp_pr_rutina', 'fp_pr_rutina_odstopanja', 'fp_pr_rutina_slike',
    'fp_skl_sekcije', 'fp_skl_kontrolne_tocke', 'fp_skl_rutina', 'fp_skl_rutina_slike',
    'spl_druzine', 'spl_normativi', 'fp_zas_uvozi', 'fp_zas_nalogi', 'fp_zas_tedni', 'fp_zas_kapacitete',
    'fp_cm_vodje', 'fp_cm_podrocja', 'ln_fp_cm_vodje_podrocja', 'fp_cm_ocene',
    'fp_plan_zaposleni', 'fp_plan_postavitve',
    'fp_pri_uvozi', 'fp_pri_postavke', 'fp_pri_opombe', 'fp_pri_odp_uvozi', 'fp_pri_odpreme',
    'fp_prod_gemba', 'fp_prod_akcije', 'fp_prod_priloge', 'fp_prod_nastavitve', 'fp_prod_druzine',
    'fp_prod_cilji', 'fp_prod_norm_posnetki', 'fp_prod_norm_posnetki_postavke', 'fp_prod_vprasanja',
    'fp_aud_audit', 'fp_aud_akcije', 'fp_aud_priloge', 'fp_aud_vprasanja', 'fp_aud_oddelki', 'fp_aud_teme',
    'fp_aud_nastavitve',
    'spl_material_uvozi', 'spl_material', 'fp_pak_printano',
    'fp_doi_izdaje_uvozi', 'fp_doi_izdaje', 'fp_doi_prevzemi_uvozi', 'fp_doi_prevzemi', 'fp_doi_cakanje',
    'fp_sync_stanje', 'spl_kosovnice_uvozi', 'spl_kosovnice', 'spl_identi_uvozi',
    'fp_por_uvozi', 'fp_por_delo', 'fp_mat_dobave_uvozi', 'fp_mat_dobave', 'fp_mat_vrstni_red',
    'fp_operacije', 'fp_normativi_operacije'
  ];
  -- Tabele, ki se pišejo samo prek funkcij SECURITY DEFINER (prijavljeni samo berejo)
  t_branje text[] := array[
    'fp_uporabniki', 'fp_vijacni_material', 'fp_vijacni_material_log',
    'fp_usp_stolpci', 'fp_usp_termini', 'fp_usp_ocene'
  ];
  -- Funkcije aplikacije (po imenu; vse preobložitve)
  f_vse text[] := array[
    'fp_set_updated_at', 'fp_pr_rutina_izracun', 'fp_pr_rutina_odstopanja_sync', 'fp_skl_rutina_izracun',
    'fp_zas_uvozi_deaktiviraj', 'fp_pri_uvozi_deaktiviraj', 'fp_pri_odp_uvozi_deaktiviraj',
    'spl_material_uvozi_deaktiviraj', 'fp_doi_uvozi_deaktiviraj', 'spl_identi_uvozi_deaktiviraj',
    'fp_sync_zakleni', 'fp_sync_koncaj', 'fp_sync_odkleni',
    'spl_kosovnice_podaljsaj_zaklep', 'spl_kosovnice_aktiviraj',
    'fp_vijacni_spremeni', 'fp_vijacni_seznam',
    'fp_ima_stran', 'fp_moj_dostop', 'fp_nastavi_dostop',
    'fp_usp_ima_dostop', 'fp_usp_nalozi', 'fp_usp_termin_shrani', 'fp_usp_termin_skrij',
    'fp_usp_ocena_shrani', 'fp_usp_ocena_skrij', 'fp_nalogi_krovnih'
  ];
  t     text;
  p     record;
  s     record;
  f     record;
  odprto text;
begin
  -- ---------- 1-4: tabele ----------
  foreach t in array t_pisanje || t_branje loop
    if to_regclass('public.' || quote_ident(t)) is null then
      raise notice '041: tabela % ne obstaja - preskočeno', t;
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);

    -- politike za anon ali public (prazen seznam vlog = public) -> authenticated
    for p in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = t
        and (roles && array['anon', 'public']::name[])
    loop
      execute format('alter policy %I on public.%I to authenticated', p.policyname, t);
      raise notice '041: politika %.% preklopljena na authenticated', t, p.policyname;
    end loop;

    execute format('revoke all on public.%I from anon, public', t);
    execute format('revoke delete, truncate, references, trigger on public.%I from authenticated', t);
    if t = any (t_branje) then
      execute format('revoke insert, update on public.%I from authenticated', t);
      execute format('grant select on public.%I to authenticated', t);
    else
      execute format('grant select, insert, update on public.%I to authenticated', t);
    end if;

    -- sekvence stolpcev (identity / serial)
    for s in
      select distinct pg_get_serial_sequence('public.' || quote_ident(t), a.attname) as seq
      from pg_attribute a
      where a.attrelid = to_regclass('public.' || quote_ident(t)) and a.attnum > 0 and not a.attisdropped
    loop
      if s.seq is not null then
        execute format('revoke all on sequence %s from anon, public', s.seq);
      end if;
    end loop;
  end loop;

  -- ---------- 5: funkcije ----------
  for f in
    select pr.oid::regprocedure as sig,
           pr.prorettype = 'pg_catalog.trigger'::regtype as je_prozilec,
           not exists (select 1 from unnest(coalesce(pr.proconfig, '{}')) c where c like 'search_path=%') as brez_poti
    from pg_proc pr
    join pg_namespace n on n.oid = pr.pronamespace
    where n.nspname = 'public' and pr.proname = any (f_vse)
  loop
    if f.brez_poti then
      execute format('alter function %s set search_path = public', f.sig);
    end if;
    execute format('revoke all on function %s from public, anon', f.sig);
    -- prožilcev se ne kliče prek API-ja; RPC funkcije samo za prijavljene
    if not f.je_prozilec then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;

  -- ---------- 6: kontrola (napaka = razveljavi vse) ----------
  select string_agg(x.opis, '; ') into odprto
  from (
    select c.relname || ': RLS izklopljen' as opis
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname = any (t_pisanje || t_branje) and not c.relrowsecurity
    union all
    select tablename || ': politika ' || policyname || ' za anon/public'
    from pg_policies
    where schemaname = 'public' and tablename = any (t_pisanje || t_branje)
      and (roles && array['anon', 'public']::name[])
    union all
    select c.relname || ': anon ima pravice na tabeli'
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname = any (t_pisanje || t_branje)
      and has_table_privilege('anon', c.oid, 'select, insert, update, delete')
    union all
    select pr.oid::regprocedure::text || ': anon lahko kliče funkcijo'
    from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
    where n.nspname = 'public' and pr.proname = any (f_vse)
      and has_function_privilege('anon', pr.oid, 'execute')
  ) x;
  if odprto is not null then
    raise exception '041: baza po migraciji ni zaklenjena: %', odprto;
  end if;
end;
$$;

commit;

-- ---------- 7: storage (ločeno od tabel) ----------
do $$
declare p record;
begin
  update storage.buckets set public = false where id = 'fp-rutina-slike' and public;

  for p in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname like 'fp\_slike\_%'
      and (roles && array['anon', 'public']::name[])
  loop
    execute format('alter policy %I on storage.objects to authenticated', p.policyname);
    raise notice '041: storage politika % preklopljena na authenticated', p.policyname;
  end loop;
exception when others then
  raise warning '041: storage politik ni bilo mogoče popraviti (%). Popravi ročno: Storage -> Policies -> fp_slike_* samo za authenticated.', sqlerrm;
end;
$$;

-- ---------- 8: pregled (pričakovano: 0 vrstic) ----------
-- Vrne vse, kar je v shemah public / storage še odprto za neprijavljene - tudi objekte
-- drugih aplikacij v isti bazi (fos_*, wi_* ...), ki jih ta migracija namenoma ne spreminja.
select 'tabela brez RLS' as tezava, c.relname::text as objekt, null::text as podrobnost
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
union all
select 'politika za anon/public', schemaname || '.' || tablename, policyname || ' (' || cmd || ')'
from pg_policies
where schemaname in ('public', 'storage') and (roles && array['anon', 'public']::name[])
union all
select 'pogled brez security_invoker', c.relname::text, 'pogled bere z lastnikovimi pravicami (obide RLS)'
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'v'
  and not coalesce((select option_value::boolean from pg_options_to_table(c.reloptions) where option_name = 'security_invoker'), false)
  and has_table_privilege('anon', c.oid, 'select')
union all
select 'SECURITY DEFINER funkcija, ki jo lahko kliče anon', pr.oid::regprocedure::text,
       case when exists (select 1 from unnest(coalesce(pr.proconfig, '{}')) c where c like 'search_path=%') then null else 'brez search_path' end
from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
where n.nspname = 'public' and pr.prosecdef and pr.prorettype <> 'pg_catalog.trigger'::regtype
  and has_function_privilege('anon', pr.oid, 'execute')
union all
select 'javna košara (storage)', b.id, null
from storage.buckets b where b.public
order by 1, 2;
