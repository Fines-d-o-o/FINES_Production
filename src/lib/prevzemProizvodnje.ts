// Prevzem iz proizvodnje (Prevzem_proizvodnja.xlsx): koliko kosov izdelka je bilo z naloga prevzetih na zalogo.
// Za Višek materiala - prevzetih manj kosov, kot je razpisanih (npr. 9 od 10), pomeni ostanek materiala.
// Izvoz ima vrstico na kos / saržo; uvoz jih sešteje po nalogu + izdelku (migracija 043).
import * as XLSX from "xlsx";
import { parseAnyDate, type IsoDate } from "./dates";
import { parseNum } from "./stevila";
import { fetchAll, getSupabase, kosi } from "./supabase";

export type PrevzemNaloga = {
  st_naloga: string;
  ident: string;
  naziv: string | null;
  em: string | null;
  kolicina: number;
  st_prevzemov: number;
  prvi_datum: IsoDate | null;
  zadnji_datum: IsoDate | null;
};

export type PrevzemProizvodnjeUvoz = { prevzemi: PrevzemNaloga[]; od: IsoDate | null; do: IsoDate | null; opozorila: string[] };

const norm = (s: unknown) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
const txt = (x: unknown) => (x === null || x === undefined || String(x).trim() === "" ? null : String(x).trim());

export async function preberiPrevzemProizvodnjeXlsx(file: File): Promise<PrevzemProizvodnjeUvoz> {
  const wb = XLSX.read(await file.arrayBuffer(), { dense: true, cellText: false, cellHTML: false, cellFormula: false });
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
  const glavaIdx = rows
    .slice(0, 15)
    .findIndex((r) => r.some((c) => norm(c) === "proizvodna šifra") && r.some((c) => norm(c) === "postavka - delovni nalog"));
  if (glavaIdx < 0)
    throw new Error('V datoteki ni stolpcev "PROIZVODNA ŠIFRA" in "Postavka - Delovni nalog". Ali je to izvoz Prevzem iz proizvodnje?');
  const glava = rows[glavaIdx].map(norm);
  const i = (ime: string) => glava.indexOf(ime);
  const [iPost, iGlava, iIdent, iNaziv, iKol, iEm, iDatum] = [
    i("postavka - delovni nalog"),
    i("delovni nalog"),
    i("proizvodna šifra"),
    i("naziv identa"),
    i("količina"),
    i("em"),
    i("datum"),
  ];
  if (iKol < 0) throw new Error('V datoteki manjka stolpec "KOLIČINA".');

  const po = new Map<string, PrevzemNaloga>();
  let brezNaloga = 0;
  for (const r of rows.slice(glavaIdx + 1)) {
    const ident = txt(r[iIdent]);
    if (!ident) continue;
    // Nalog postavke; glava prevzema lahko združuje več nalogov
    const nalog = txt(r[iPost]) ?? (iGlava >= 0 ? txt(r[iGlava]) : null);
    if (!nalog) {
      brezNaloga++;
      continue;
    }
    const datum = iDatum >= 0 ? parseAnyDate(r[iDatum]) : null;
    const k = `${nalog}\u0000${ident}`;
    const p = po.get(k) ?? { st_naloga: nalog, ident, naziv: txt(r[iNaziv]), em: iEm >= 0 ? txt(r[iEm]) : null, kolicina: 0, st_prevzemov: 0, prvi_datum: null, zadnji_datum: null };
    p.kolicina += parseNum(r[iKol]) ?? 0;
    p.st_prevzemov += 1;
    if (datum && (!p.prvi_datum || datum < p.prvi_datum)) p.prvi_datum = datum;
    if (datum && (!p.zadnji_datum || datum > p.zadnji_datum)) p.zadnji_datum = datum;
    po.set(k, p);
  }
  const prevzemi = [...po.values()];
  if (!prevzemi.length) throw new Error("V datoteki ni prevzemov iz proizvodnje.");
  const datumi = prevzemi.flatMap((p) => [p.prvi_datum, p.zadnji_datum]).filter((d): d is IsoDate => !!d).sort();
  return {
    prevzemi,
    od: datumi[0] ?? null,
    do: datumi.at(-1) ?? null,
    opozorila: brezNaloga ? [`${brezNaloga} vrstic nima delovnega naloga - niso upoštevane.`] : [],
  };
}

export async function shraniPrevzemProizvodnjeUvoz(datoteka: string, p: PrevzemProizvodnjeUvoz) {
  const sb = getSupabase();
  const { data: uvoz, error } = await sb
    .from("fp_vis_prevzemi_uvozi")
    .insert({ datoteka, st_postavk: p.prevzemi.length, obdobje_od: p.od, obdobje_do: p.do })
    .select("id")
    .single();
  if (error) throw new Error(`Prevzem iz proizvodnje ni pripravljen - zaženi migracijo 043_prevzem_proizvodnje.sql. (${error.message})`);
  for (const kos of kosi(p.prevzemi, 1000)) {
    const { error: e } = await sb.from("fp_vis_prevzemi").insert(kos.map((x) => ({ ...x, uvoz_id: uvoz.id })));
    if (e) throw new Error(`Podatki niso bili v celoti shranjeni (uvoz ni aktiviran - ponovi uvoz): ${e.message}`);
  }
  const { error: e2 } = await sb.from("fp_vis_prevzemi_uvozi").update({ aktiven: true }).eq("id", uvoz.id);
  if (e2) throw new Error(e2.message);
}

/** Prevzemi izbranih nalogov iz zadnjega uvoza; `obdobje` = datumi prevzemov v izvozu (nalog izven obdobja nima podatka). */
export async function naloziPrevzemeNalogov(
  stevilke: string[],
): Promise<{ prevzemi: PrevzemNaloga[]; obdobje: { od: IsoDate | null; do: IsoDate | null } | null; opozorilo: string | null }> {
  const sb = getSupabase();
  const { data: uvoz, error } = await sb
    .from("fp_vis_prevzemi_uvozi")
    .select("id, obdobje_od, obdobje_do")
    .eq("aktiven", true)
    .eq("visible", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { prevzemi: [], obdobje: null, opozorilo: "Prevzem iz proizvodnje ni na voljo - zaženi migracijo 043_prevzem_proizvodnje.sql in uvozi Prevzem iz proizvodnje." };
  if (!uvoz) return { prevzemi: [], obdobje: null, opozorilo: "Prevzem iz proizvodnje še ni uvožen (stran Podatki) - kontrola prevzema ni mogoča." };
  const prevzemi: PrevzemNaloga[] = [];
  for (const kos of kosi(stevilke, 100))
    prevzemi.push(
      ...(await fetchAll<PrevzemNaloga>((od, doV) =>
        sb
          .from("fp_vis_prevzemi")
          .select("st_naloga, ident, naziv, em, kolicina, st_prevzemov, prvi_datum, zadnji_datum")
          .eq("uvoz_id", uvoz.id)
          .eq("visible", true)
          .in("st_naloga", kos)
          .order("id")
          .range(od, doV),
      )),
    );
  return { prevzemi: prevzemi.map((p) => ({ ...p, kolicina: Number(p.kolicina) })), obdobje: { od: uvoz.obdobje_od, do: uvoz.obdobje_do }, opozorilo: null };
}
