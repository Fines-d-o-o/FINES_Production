-- =====================================================================
-- Popravek normativov družine OCA (peči FBM, 100- / 110- / 111-) - 26. 11. 2026
--
-- Vir: analiza štempljanja (ista metoda kot "Analiza normativov proizvodnja"): zaključeni nalogi od 2025,
-- h/kos = štempljane ure / izdelani kosi po oddelkih (mešani operaciji po oddelku delavca), izločeni nalogi
-- brez nosilnega oddelka (P ali M) in zunaj pasu 0,6-1,7 x mediane.
-- Podrobnosti po nalogih: "Analiza normativov OCA.xlsx" (analiza_OCA.py).
--   brez CL: FBM-60S 10 + FBM-40S 5 upoštevanih nalogov (8 krovnih) -> povprečje P 4,39 M 2,78 E 0,54 T 0,55
--   CL:      FBM-60S CL 9 + FBM-60/4S CL 2 upoštevana naloga (5 krovnih) -> povprečje P 4,70 M 6,23 E 0,76 T 0,59
--   FBM-40S CL: samo 1 krovni (13,0 in 26,0 h/kos) - ne šteje v povprečje, dobi normativ skupine CL
-- Enotno za celo družino OCA (podobni izdelki = en normativ):
--   brez CL (vključno FBM-40/60 D, M - od 2025 ni nalogov): 8,30 h = P 4,4 + M 2,8 + E 0,55 + T 0,55
--   CL (cleaning):                                         12,25 h = P 4,7 + M 6,2 + E 0,75 + T 0,6
-- Prej: brez CL 5,66 h (P 1,68 M 3,00 E 0,42 T 0,56), CL 7,00 h (P 1,68 M 4,34 E 0,42 T 0,56).
-- Osnove (OCA-k), plošče elektro (OCA-e) in ožičenja (OCA-o) imajo svoje naloge in normative - ostanejo.
--
-- Spremenijo se samo stolpci normativov. Vsota oddelkov = skupni (pravilo iz 003).
-- Zaženi v Supabase SQL Editorju. Rezultat: seznam spremenjenih šifer (pričakovano 51 vrstic: 39 brez CL, 12 CL).
-- CL = "CL" v nazivu (ujema se z oznako cleaning v bazi).
-- =====================================================================

begin;

with oca as (
  select n.id, n.naziv ~* '\mCL\M' as cl
  from public.spl_normativi n
  join public.spl_druzine d on d.id = n.druzina_id
  where n.visible and d.koda = 'OCA'
)
update public.spl_normativi n
   set normativ_proizvodnja = case when oca.cl then 4.7 else 4.4 end,
       normativ_montaza     = case when oca.cl then 6.2 else 2.8 end,
       normativ_elektro     = case when oca.cl then 0.75 else 0.55 end,
       normativ_testiranje  = case when oca.cl then 0.6 else 0.55 end,
       normativ_skupni      = case when oca.cl then 12.25 else 8.3 end
  from oca
 where n.id = oca.id
returning n.ident, n.naziv, oca.cl as cl, n.normativ_skupni, n.normativ_proizvodnja, n.normativ_montaza, n.normativ_elektro, n.normativ_testiranje;

commit;
