// Odstopanja zaključenih krovnih (Produktivnost → Zaključeni krovni → klik na krovni): strošek ur nad normativom,
// vzrok in razlaga (migracija 044). E-mail za Outlook je v odstopanjaEmail.ts (naloži se šele ob kliku).
//
// Strošek = Δh × (cena dela + cena delovnega mesta + oportunitetni strošek), Δh = štempljane - normativne ure
// (samo nalogi z normativom, operacije oddelka - isto kot na kartici krovnega), zaokroženo na 0,1 h. Δh < 0 = prihranek.
// Oportunitetni strošek = izgubljen DOBIČEK na uro kapacitete (smo vedno polni), ne prihodek: ura, ki je šla
// v odstopanje, bi naredila del druge peči. Na uro: (povprečna cena peči - lastna cena) / normativne ure peči.
import type { IsoDate } from "./dates";
import type { OddelekKoda } from "./normativi";
import type { KrovniZakljucen } from "./produktivnostPlana";
import { getSupabase } from "./supabase";

export type Postavke = {
  /** €/h - strošek ure delavca. */
  cenaDela: number;
  /** €/h - strošek ure delovnega mesta / stroja. */
  cenaDelovnegaMesta: number;
  /** €/h - izgubljen dobiček na uro kapacitete. */
  oportunitetni: number;
};

export const PRIVZETE_POSTAVKE: Postavke = { cenaDela: 25, cenaDelovnegaMesta: 25, oportunitetni: 200 };

const KLJUCI: Record<keyof Postavke, string> = {
  cenaDela: "cena_dela",
  cenaDelovnegaMesta: "cena_delovnega_mesta",
  oportunitetni: "oportunitetni",
};

/** Kratka definicija oportunitetnega stroška (panel in e-mail). */
export const OPIS_OPORTUNITETNEGA =
  "Oportunitetni strošek = izgubljen dobiček na uro kapacitete (smo vedno polni): ura odstopanja bi naredila del druge peči.";
/** Izračun postavke s primerom (samo hover v panelu - interni podatki, ne gre v e-mail). */
export const IZRACUN_OPORTUNITETNEGA =
  "(povprečna cena peči - lastna cena) / normativne ure peči. Npr. FB5: (≈ 5.200 € - 2.089 €) / 14,5 h ≈ 215 €/h; " +
  "razpon po različicah ≈ 200-430 €/h, privzeto 200 €/h (spodnja meja). Šteje se dobiček, ne prihodek - material in delo neizdelane peči bi tudi plačali.";

export const VZROKI = [
  "Material manjkal / slab material",
  "Napaka v risbi / dokumentaciji",
  "Nov delavec / uvajanje",
  "Okvara stroja / orodja",
  "Popravilo / ponovno delo",
  "Napačen normativ",
  "Napaka štempljanja",
  "Drugo",
] as const;

export type Strosek = {
  /** Štempljane - normativne ure (+ = več ur od normativa). */
  razlika: number;
  delo: number;
  delovnoMesto: number;
  oportunitetni: number;
  skupaj: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Krovni brez normativnih ur nima izračuna odstopanja. */
export const imaNormativ = (k: Pick<KrovniZakljucen, "normUre">) => k.normUre > 0.005;

export function izracunajStrosek(k: Pick<KrovniZakljucen, "normUre" | "ure">, p: Postavke): Strosek {
  // na 0,1 h - isto kot je prikazano, da se izračun da preveriti na roke
  const razlika = Math.round((k.ure - k.normUre) * 10) / 10;
  const delo = r2(razlika * p.cenaDela);
  const delovnoMesto = r2(razlika * p.cenaDelovnegaMesta);
  const oportunitetni = r2(razlika * p.oportunitetni);
  return { razlika, delo, delovnoMesto, oportunitetni, skupaj: r2(delo + delovnoMesto + oportunitetni) };
}

// =====================================================================
// BAZA
// =====================================================================

const niTabele = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" || /fp_odst_/.test(e.message ?? ""));

/** Urne postavke; null = tabel še ni (migracija 044). */
export async function naloziPostavke(): Promise<Postavke | null> {
  const { data, error } = await getSupabase().from("fp_odst_nastavitve").select("kljuc, vrednost").eq("visible", true);
  if (niTabele(error)) return null;
  if (error) throw error;
  const v = new Map((data ?? []).map((r) => [r.kljuc as string, Number(r.vrednost)]));
  const out = { ...PRIVZETE_POSTAVKE };
  for (const k of Object.keys(KLJUCI) as (keyof Postavke)[]) if (v.has(KLJUCI[k])) out[k] = v.get(KLJUCI[k])!;
  return out;
}

export async function shraniPostavke(p: Postavke) {
  const { error } = await getSupabase()
    .from("fp_odst_nastavitve")
    .upsert(
      (Object.keys(KLJUCI) as (keyof Postavke)[]).map((k) => ({ kljuc: KLJUCI[k], vrednost: p[k], visible: true })),
      { onConflict: "kljuc" },
    );
  if (error) throw error;
}

export type Odstopanje = {
  id: number;
  krovni: string;
  oddelek: string;
  celica: string | null;
  zakljucen: IsoDate | null;
  normativ_ure: number;
  stempljane_ure: number;
  razlika_ure: number;
  produktivnost: number | null;
  cena_dela: number;
  cena_delovnega_mesta: number;
  oportunitetni: number;
  strosek_skupaj: number;
  vzrok: string | null;
  razlaga: string | null;
  avtor: string | null;
  uredil: string | null;
  created_at: string;
  updated_at: string;
};

const STOLPCI =
  "id, krovni, oddelek, celica, zakljucen, normativ_ure, stempljane_ure, razlika_ure, produktivnost, cena_dela, cena_delovnega_mesta, oportunitetni, strosek_skupaj, vzrok, razlaga, avtor, uredil, created_at, updated_at";

const stevilka = (o: Record<string, unknown>): Odstopanje =>
  ({
    ...o,
    normativ_ure: Number(o.normativ_ure),
    stempljane_ure: Number(o.stempljane_ure),
    razlika_ure: Number(o.razlika_ure),
    produktivnost: o.produktivnost === null ? null : Number(o.produktivnost),
    cena_dela: Number(o.cena_dela),
    cena_delovnega_mesta: Number(o.cena_delovnega_mesta),
    oportunitetni: Number(o.oportunitetni),
    strosek_skupaj: Number(o.strosek_skupaj),
  }) as Odstopanje;

/** Shranjena odstopanja oddelka po krovnem; null = tabel še ni (migracija 044). */
export async function naloziOdstopanja(oddelek: OddelekKoda): Promise<Map<string, Odstopanje> | null> {
  const { data, error } = await getSupabase().from("fp_odst_krovni").select(STOLPCI).eq("oddelek", oddelek).eq("visible", true);
  if (niTabele(error)) return null;
  if (error) throw error;
  return new Map((data ?? []).map((r) => [r.krovni as string, stevilka(r as Record<string, unknown>)]));
}

/** Shrani (ali posodobi) odstopanje krovnega - posnetek ur, postavk in zneskov ob shranjevanju. */
export async function shraniOdstopanje({
  k,
  oddelek,
  celica,
  postavke,
  vzrok,
  razlaga,
  obstojeci,
}: {
  k: KrovniZakljucen;
  oddelek: OddelekKoda;
  celica: string;
  postavke: Postavke;
  vzrok: string | null;
  razlaga: string;
  obstojeci: Odstopanje | null;
}): Promise<Odstopanje> {
  const s = izracunajStrosek(k, postavke);
  const zapis = {
    krovni: k.krovni,
    oddelek,
    celica,
    zakljucen: k.zakljucen,
    normativ_ure: r2(k.normUre),
    stempljane_ure: r2(k.ure),
    razlika_ure: s.razlika,
    produktivnost: k.produktivnost === null ? null : Math.round(k.produktivnost * 10000) / 10000,
    cena_dela: postavke.cenaDela,
    cena_delovnega_mesta: postavke.cenaDelovnegaMesta,
    oportunitetni: postavke.oportunitetni,
    strosek_dela: s.delo,
    strosek_delovnega_mesta: s.delovnoMesto,
    strosek_oportunitetni: s.oportunitetni,
    strosek_skupaj: s.skupaj,
    vzrok,
    razlaga: razlaga.trim() || null,
  };
  const sb = getSupabase();
  const { data, error } = obstojeci
    ? await sb.from("fp_odst_krovni").update(zapis).eq("id", obstojeci.id).select(STOLPCI).single()
    : await sb.from("fp_odst_krovni").insert(zapis).select(STOLPCI).single();
  if (error) throw error;
  return stevilka(data as Record<string, unknown>);
}

