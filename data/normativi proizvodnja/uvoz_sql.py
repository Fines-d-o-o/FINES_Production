# -*- coding: utf-8 -*-
"""
Pripravi SQL za uvoz normativov proizvodnje (analiza -> spl_normativi, fp_normativi_operacije).

Pravila za šifre, ki v bazi že imajo normativ (odločitev 2026-11-25) - preverijo se V BAZI ob uvozu:
  - predlog < -50 % obstoječega  -> pusti kot je (vrstica se ne spremeni)
  - predlog > +100 % obstoječega -> dvigni samo za 50 % (1,5 × obstoječi), razdelitev po predlogu
  - sicer                         -> predlog analize
Nove šifre in šifre z normativom 0 dobijo predlog analize.

Izhod:
  uvoz_normativi.sql            - spl_normativi (insert / update po ident), ena transakcija
  uvoz_normativi_operacije.sql  - fp_normativi_operacije (zahteva migracijo 040; zaženi PO prvem)

Zagon:  py uvoz_sql.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import analiza_normativov as a  # noqa: E402

MAPA = a.MAPA
VEJ = ",\n"
OP_KODA = {
    "Programiranje": "PROG", "Razrez": "RAZ", "Krivljenje": "KRIV", "Uporovno varjenje": "UPO",
    "Varjenje": "VAR", "Brušenje": "BRU", "Vijaki in matice": "VIJ", "Vrtanje": "VRT",
    "Odstranjevanje folije - proizvodnja": "FOL", "Sestavljanje - proizvodnja": "SES",
}


def t(s):
    return "'" + str(s).replace("'", "''") + "'"


def main():
    sez, pred, det, vir, por, delavci = a.analiziraj()
    povp, _ = a.povprecenje(pred)

    vr, ops = [], []
    for _, r in povp.sort_values(["Klas", "Sifra"]).iterrows():
        if not (isinstance(r["Povp"], float) and r["Povp"] > 0) or not r["OddPovp"]:
            continue
        odd = r["OddPovp"]
        s = round(float(r["Povp"]), 3)
        assert abs(sum(odd.values()) - s) <= 0.0005 and all(v >= 0 for v in odd.values()), r["Sifra"]
        naj = max(odd, key=odd.get)
        vr.append(f"  ({t(r['Sifra'])}, {t(r['Naziv'])}, {s:.3f}, {odd['P']:.3f}, {odd['M']:.3f}, "
                  f"{odd['E']:.3f}, {odd['T']:.3f}, {t(naj)})")
        od = {k: v for k, v in (r["OpDel"] or {}).items() if v and v > 0}
        vs = sum(od.values())
        if odd["P"] > 0 and vs > 0:
            kmax = max(od, key=od.get)
            for k, v in od.items():
                ops.append(f"  ({t(r['Sifra'])}, {t(OP_KODA[k])}, {v / vs:.6f}, {'true' if k == kmax else 'false'})")

    sql = f"""-- =====================================================================
-- Uvoz normativov proizvodnje (096 / 097 / 099 / 110) v spl_normativi
-- Vir: Analiza normativov proizvodnja (v2).xlsx - pripravil data/normativi proizvodnja/uvoz_sql.py
-- {len(vr)} šifer s predlogom.
--
-- Pravila (preverijo se ob uvozu proti trenutni vrednosti v bazi):
--   NOV / NASTAVI   - šifre ni ali ima normativ 0      -> predlog analize
--   PUSTI           - predlog < -50 % obstoječega      -> vrstica ostane, kot je
--   DVIG            - predlog > +100 % obstoječega     -> 1,5 × obstoječi, razdelitev P/M/E/T po predlogu
--   POSODOBI        - ostalo                           -> predlog analize
-- Spremenijo se samo stolpci normativov (naziv, družina, opomba ostanejo).
-- En sam stavek (brez začasnih tabel) - atomaren: ali se uvozi vse ali nič.
-- Rezultat: povzetek po akcijah (ident prazen) + seznam izjem PUSTI / DVIG.
-- =====================================================================
with uvoz(ident, naziv, predlog, p, m, e, t, najvecji) as (values
{VEJ.join(vr)}
),
nacrt as (
  select u.*, coalesce(n.normativ_skupni, 0) as obst,
         case when n.id is null                        then 'NOV'
              when n.normativ_skupni <= 0              then 'NASTAVI (bil 0)'
              when u.predlog < 0.5 * n.normativ_skupni then 'PUSTI (< -50 %)'
              when u.predlog > 2 * n.normativ_skupni   then 'DVIG +50 % (> +100 %)'
              else 'POSODOBI' end as akcija
  from uvoz u
  left join public.spl_normativi n on n.ident = u.ident
),
skupni as (
  select *, case when akcija like 'DVIG%' then round(obst * 1.5, 3) else predlog end as s from nacrt
),
zaokr as (
  select *, round(p / predlog * s, 3) as rp, round(m / predlog * s, 3) as rm,
            round(e / predlog * s, 3) as re, round(t / predlog * s, 3) as rt
  from skupni
),
koncno as (  -- ostanek zaokroževanja gre največjemu oddelku (P+M+E+T = skupni)
  select *, s - (rp + rm + re + rt) as ost from zaokr
),
vpis as (
  insert into public.spl_normativi as n
    (ident, naziv, normativ_skupni, normativ_proizvodnja, normativ_montaza, normativ_elektro, normativ_testiranje)
  select ident, naziv, s,
         rp + case when najvecji = 'P' then ost else 0 end,
         rm + case when najvecji = 'M' then ost else 0 end,
         re + case when najvecji = 'E' then ost else 0 end,
         rt + case when najvecji = 'T' then ost else 0 end
  from koncno where akcija not like 'PUSTI%'
  on conflict (ident) do update set
    normativ_skupni      = excluded.normativ_skupni,
    normativ_proizvodnja = excluded.normativ_proizvodnja,
    normativ_montaza     = excluded.normativ_montaza,
    normativ_elektro     = excluded.normativ_elektro,
    normativ_testiranje  = excluded.normativ_testiranje
  returning n.ident
)
select akcija, count(*) as sifer, null::text as ident, null::text as naziv, null::numeric as obstojeci,
       null::numeric as predlog, null::numeric as razlika_pct, null::numeric as v_bazi,
       (select count(*) from vpis) as zapisanih
from koncno group by akcija
union all
select akcija, null, ident, naziv, obst, predlog, round((predlog / nullif(obst, 0) - 1) * 100),
       case when akcija like 'PUSTI%' then obst else s end, null
from koncno where akcija like 'PUSTI%' or akcija like 'DVIG%'
order by ident nulls first, akcija;
"""
    (MAPA / "uvoz_normativi.sql").write_text(sql, encoding="utf-8")

    sql2 = f"""-- =====================================================================
-- Razdelitev normativa proizvodnje po operacijah (fp_normativi_operacije)
-- ZAHTEVA migracijo 040_normativi_operacije.sql. Zaženi PO uvoz_normativi.sql.
-- Deleži operacij so iz analize; ure = delež × normativ_proizvodnja, ki je v bazi
-- (tudi pri šifrah PUSTI / DVIG). Vsota operacij šifre = normativ_proizvodnja.
-- {len(ops)} vrstic.
-- =====================================================================
with uvoz_op(ident, koda, delez, najvecji) as (values
{VEJ.join(ops)}
),
izr as (
  select n.id as normativ_id, o.id as operacija_id, u.najvecji, n.normativ_proizvodnja as p,
         round(u.delez * n.normativ_proizvodnja, 3) as ure
  from uvoz_op u
  join public.spl_normativi n on n.ident = u.ident and n.normativ_proizvodnja > 0
  join public.fp_operacije o on o.koda = u.koda
),
koncno as (  -- ostanek zaokroževanja gre največji operaciji (vsota = normativ_proizvodnja)
  select normativ_id, operacija_id,
         ure + case when najvecji then p - sum(ure) over (partition by normativ_id) else 0 end as ure
  from izr
)
insert into public.fp_normativi_operacije (normativ_id, operacija_id, ure)
select normativ_id, operacija_id, ure from koncno
on conflict (normativ_id, operacija_id) do update set ure = excluded.ure, visible = true;

-- kontrola: pričakovano 0 vrstic
select n.ident, n.normativ_proizvodnja, sum(no.ure) as vsota_operacij
from public.spl_normativi n
join public.fp_normativi_operacije no on no.normativ_id = n.id and no.visible
group by n.id, n.ident, n.normativ_proizvodnja
having abs(n.normativ_proizvodnja - sum(no.ure)) > 0.0005;
"""
    (MAPA / "uvoz_normativi_operacije.sql").write_text(sql2, encoding="utf-8")
    print("šifer:", len(vr), "| vrstic operacij:", len(ops))


if __name__ == "__main__":
    main()
