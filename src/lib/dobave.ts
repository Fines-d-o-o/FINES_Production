// Dobave materiala: odprte postavke naročil dobaviteljem (izvoz "Naročila dobavitelju").
// Vir rokov dobave za Pripravljenost materiala (Proizvodnja -> Planiranje).
import * as XLSX from "xlsx";
import { parseAnyDate, type IsoDate } from "./dates";
import { parseNum } from "./stevila";
import { fetchAll, getSupabase, kosi } from "./supabase";

// =====================================================================
// TIPI
// =====================================================================

/** Od kod je rok dobave: potrjen od dobavitelja, želeni (naš) ali predviden (datum naročila + dni nabave). */
export type VrstaRoka = "potrjen" | "zeljen" | "predviden";

export const OPIS_VRSTE_ROKA: Record<VrstaRoka, string> = {
  potrjen: "Potrjen rok dobavitelja",
  zeljen: "Želeni rok (dobavitelj ga ni potrdil)",
  predviden: "Predviden: datum naročila + dni nabave",
};

export const KRATKA_VRSTA_ROKA: Record<VrstaRoka, string> = { potrjen: "potrjen", zeljen: "želeni", predviden: "predviden" };

/** Odprta postavka naročila dobavitelju. */
export type Dobava = {
  vd: string | null;
  stevilka: string;
  datum: IsoDate | null;
  dobavitelj: string | null;
  naziv_dobavitelja: string | null;
  referent: string | null;
  delovni_nalog: string | null;
  potrjeno: boolean;
  ident: string;
  naziv: string | null;
  em: string | null;
  kolicina: number;
  prevzeto: number;
  odprto: number;
  rok_potrjen: IsoDate | null;
  rok_zeljen: IsoDate | null;
  predviden: IsoDate | null;
  /** Efektivni rok: potrjen -> želeni -> predviden. */
  rok: IsoDate | null;
  vrsta_roka: VrstaRoka | null;
};

export type DobaveUvoz = { id: number; datoteka: string; st_postavk: number; created_at: string };

export type DobaveUvozPregled = { dobave: Dobava[]; opozorila: string[] };

// =====================================================================
// UVOZ XLSX
// =====================================================================

/** "PROIZVODNA ŠIFRA" -> "proizvodna šifra", "Rok dobave\r\n(željen)" -> "rok dobave (željen)". */
const norm = (s: unknown) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/_x000d_/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const txt = (x: unknown) => (x === null || x === undefined || String(x).trim() === "" ? null : String(x).trim());
const st = (x: unknown) => parseNum(x) ?? 0;
const da = (x: unknown) =>
  String(x ?? "")
    .trim()
    .toUpperCase() === "DA";

type Polje =
  | "vd"
  | "stevilka"
  | "datum"
  | "dobavitelj"
  | "naziv_dobavitelja"
  | "referent"
  | "dn_glava"
  | "dn_postavka"
  | "okvirno"
  | "potrjeno"
  | "zaprto_glava"
  | "zaprt_postavka"
  | "ident"
  | "naziv"
  | "em"
  | "kolicina"
  | "prevzeto"
  | "rok_zeljen_glava"
  | "rok_potrjen_glava"
  | "rok_zeljen"
  | "rok_potrjen"
  | "predviden";

/** Glava izvoza -> polje (imena so normirana z `norm`). Prvo ujemanje velja - "številka (2)" je odpoklic, ne naročilo. */
const STOLPCI: Record<string, Polje> = {
  vd: "vd",
  številka: "stevilka",
  datum: "datum",
  dobavitelj: "dobavitelj",
  naziv: "naziv_dobavitelja",
  "nabavni referent": "referent",
  "delovni nalog": "dn_glava",
  "postavka - delovni nalog": "dn_postavka",
  "okvirno naročilo": "okvirno",
  potrjeno: "potrjeno",
  zaprto: "zaprto_glava",
  zaprt: "zaprt_postavka",
  "proizvodna šifra": "ident",
  "naziv identa": "naziv",
  em: "em",
  količina: "kolicina",
  "prevzeta količina": "prevzeto",
  "rok dobave (željen)": "rok_zeljen_glava",
  "rok dobave (potrjen)": "rok_potrjen_glava",
  "postavka - rok dobave (željen)": "rok_zeljen",
  "potrjen rok dobave": "rok_potrjen",
  "predviden datum dobave (datum naročila + dni nabave)": "predviden",
};

/**
 * Prebere izvoz "Naročila dobavitelju" (avtomatski izvoz ima glavo v 1. vrstici, ročni nad njo še
 * "NAROČILA DOBAVITELJU" in "GLAVA / POSTAVKE NAROČILA"). Shrani samo odprte postavke.
 */
export async function preberiDobaveXlsx(file: File): Promise<DobaveUvozPregled> {
  const wb = XLSX.read(await file.arrayBuffer(), { dense: true, cellText: false, cellHTML: false, cellFormula: false });
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
  const glavaIdx = rows
    .slice(0, 15)
    .findIndex((r) => r.some((c) => norm(c) === "proizvodna šifra") && r.some((c) => norm(c) === "prevzeta količina"));
  if (glavaIdx < 0)
    throw new Error('V datoteki ni stolpcev "Proizvodna šifra" in "Prevzeta količina". Ali je to izvoz Naročila dobavitelju?');

  const glava = rows[glavaIdx].map(norm);
  const indeksi: [number, Polje][] = [];
  for (const [ime, polje] of Object.entries(STOLPCI)) {
    const i = glava.indexOf(ime);
    if (i >= 0) indeksi.push([i, polje]);
  }
  for (const p of ["stevilka", "ident", "kolicina", "prevzeto"] as const) {
    if (!indeksi.some(([, x]) => x === p)) throw new Error(`V datoteki manjka stolpec za "${p}". Ali je to izvoz naročil dobavitelju?`);
  }

  const dobave: Dobava[] = [];
  let okvirnih = 0;
  let brezRoka = 0;
  for (const r of rows.slice(glavaIdx + 1)) {
    const v: Partial<Record<Polje, unknown>> = {};
    for (const [i, polje] of indeksi) v[polje] = r[i];
    const ident = txt(v.ident);
    const stevilka = txt(v.stevilka);
    if (!ident || !stevilka) continue;
    if (da(v.zaprto_glava) || da(v.zaprt_postavka)) continue;
    const kolicina = st(v.kolicina);
    const prevzeto = st(v.prevzeto);
    const odprto = kolicina - prevzeto;
    if (odprto <= 1e-6) continue;
    // Okvirno naročilo je napoved količin za leto - ERP ga ne šteje v naročeno (material pride z odpoklici)
    if (da(v.okvirno)) {
      okvirnih++;
      continue;
    }
    const rok_potrjen = parseAnyDate(v.rok_potrjen) ?? parseAnyDate(v.rok_potrjen_glava);
    const rok_zeljen = parseAnyDate(v.rok_zeljen) ?? parseAnyDate(v.rok_zeljen_glava);
    const predviden = parseAnyDate(v.predviden);
    const vrsta_roka: VrstaRoka | null = rok_potrjen ? "potrjen" : rok_zeljen ? "zeljen" : predviden ? "predviden" : null;
    if (!vrsta_roka) brezRoka++;
    dobave.push({
      vd: txt(v.vd),
      stevilka,
      datum: parseAnyDate(v.datum),
      dobavitelj: txt(v.dobavitelj),
      naziv_dobavitelja: txt(v.naziv_dobavitelja),
      referent: txt(v.referent),
      delovni_nalog: txt(v.dn_postavka) ?? txt(v.dn_glava),
      potrjeno: da(v.potrjeno),
      ident,
      naziv: txt(v.naziv),
      em: txt(v.em),
      kolicina,
      prevzeto,
      odprto,
      rok_potrjen,
      rok_zeljen,
      predviden,
      rok: rok_potrjen ?? rok_zeljen ?? predviden,
      vrsta_roka,
    });
  }
  if (dobave.length === 0) throw new Error("V datoteki ni odprtih postavk naročil.");
  const opozorila: string[] = [];
  if (okvirnih) opozorila.push(`${okvirnih} odprtih postavk okvirnih naročil ni uvoženih (ERP jih ne šteje v naročeno).`);
  if (brezRoka) opozorila.push(`${brezRoka} odprtih postavk nima nobenega roka dobave.`);
  return { dobave, opozorila };
}

/** Shrani uvoz (vrstice v kosih) in ga aktivira, ko so vse vrstice vpisane. */
export async function shraniDobaveUvoz(datoteka: string, p: DobaveUvozPregled) {
  const sb = getSupabase();
  const { data: uvoz, error } = await sb
    .from("fp_mat_dobave_uvozi")
    .insert({ datoteka, st_postavk: p.dobave.length })
    .select("id")
    .single();
  if (error) throw error;
  for (const kos of kosi(p.dobave)) {
    const { error: e } = await sb.from("fp_mat_dobave").insert(kos.map((x) => ({ ...x, uvoz_id: uvoz.id })));
    if (e) throw new Error(`Podatki niso bili v celoti shranjeni (uvoz ni aktiviran - ponovi uvoz): ${e.message}`);
  }
  const { error: e2 } = await sb.from("fp_mat_dobave_uvozi").update({ aktiven: true }).eq("id", uvoz.id);
  if (e2) throw e2;
}

// =====================================================================
// BRANJE
// =====================================================================

const POLJA =
  "vd, stevilka, datum, dobavitelj, naziv_dobavitelja, referent, delovni_nalog, potrjeno, ident, naziv, em, kolicina, prevzeto, odprto, rok_potrjen, rok_zeljen, predviden, rok, vrsta_roka";

export async function naloziDobave(): Promise<{ uvoz: DobaveUvoz | null; dobave: Dobava[] }> {
  const sb = getSupabase();
  const { data: uvoz, error } = await sb
    .from("fp_mat_dobave_uvozi")
    .select("id, datoteka, st_postavk, created_at")
    .eq("aktiven", true)
    .eq("visible", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!uvoz) return { uvoz: null, dobave: [] };
  const dobave = await fetchAll<Dobava>((from, to) =>
    sb.from("fp_mat_dobave").select(POLJA).eq("uvoz_id", uvoz.id).eq("visible", true).order("id").range(from, to),
  );
  return {
    uvoz,
    dobave: dobave.map((d) => ({
      ...d,
      kolicina: Number(d.kolicina),
      prevzeto: Number(d.prevzeto),
      odprto: Number(d.odprto),
    })),
  };
}
