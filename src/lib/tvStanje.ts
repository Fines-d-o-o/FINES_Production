// Stanje komponent FIN:TV (lahek modul - brez PDF): vklop in zadnja objava iz FinOS, skupine komponent za stran
// Sync v TV in glavo ter enotno stanje (ikona stanja) iz baze in vrste objav te seje.
import { formatDatumUra, toIso } from "./dates";
import { ODDELKI_NORMATIVA, type OddelekKoda } from "./normativi";
import { getSupabase } from "./supabase";
import type { SyncDatotekaKljuc } from "./syncDatoteke";
import { ODDELKI_TV, kodaDela, kodaPregleda, kodaPripravljenosti, kodaWorkflowa, kodaZakljucenih } from "./tvIzpisi";
import type { OpraviloTv } from "./tvVrsta";

/** Stanje komponente v FinOS: ali obstaja, ali je vklopljena, zadnja objava. */
export type StanjeTvKomponente = {
  koda: string;
  ime: string | null;
  /** null = komponente ni v FinOS (migracija ni zagnana) ali ni dostopa. */
  vklopljena: boolean | null;
  /** `danes` = koliko strani zadnje objave TV kaže danes. */
  zadnja: { cas: string; izvor: string; strani: number; danes: number } | null;
};

/** Stanje izbranih komponent FIN:TV (fos_tv_viri + fos_tv_zadnje_objave). */
export async function stanjeTvKomponent(kode: string[]): Promise<StanjeTvKomponente[]> {
  const sb = getSupabase();
  const { data: viri, error } = await sb.from("fos_tv_viri").select("id, koda, ime, vklopljen").in("koda", kode).eq("visible", true);
  if (error) throw new Error(error.message);
  const ids = (viri ?? []).map((v) => v.id as number);
  const { data: objave } = ids.length
    ? await sb.from("fos_tv_zadnje_objave").select("*").in("id_vira", ids) // * = z in brez FinOS 030 (podatki)
    : { data: [] };
  const danes = toIso(new Date());
  return kode.map((koda) => {
    const v = (viri ?? []).find((x) => x.koda === koda);
    const o = v ? (objave ?? []).find((x) => x.id_vira === v.id) : undefined;
    // animirana objava (FinOS 030): elementi podatkov namesto strani
    const podatki = (o?.podatki as unknown[] | null | undefined) ?? [];
    const strani = podatki.length ? podatki : ((o?.strani as string[] | null) ?? []);
    const od = (o?.velja_od as (string | null)[] | null) ?? [];
    const doo = (o?.velja_do as (string | null)[] | null) ?? [];
    // Stran brez veljavnosti velja vedno (kot veljavneStrani v FinOS)
    const veljajo = strani.filter((_, i) => (!od[i] || od[i]! <= danes) && (!doo[i] || doo[i]! >= danes)).length;
    return {
      koda,
      ime: (v?.ime as string) ?? null,
      vklopljena: v ? !!v.vklopljen : null,
      zadnja: o ? { cas: o.created_at as string, izvor: (o.izvor as string) ?? "", strani: strani.length, danes: veljajo } : null,
    };
  });
}

// =====================================================================
// SKUPINE KOMPONENT (stran Sync v TV, glava)
// =====================================================================

export const NAZIV_ODDELKA = Object.fromEntries(ODDELKI_NORMATIVA.map((o) => [o.koda, o.label])) as Record<OddelekKoda, string>;

/**
 * Skupina = kar se objavi naenkrat: delovni plan oddelka (workflow + pregled, ob Shrani plan / Sync v TV) ali
 * komponenta, ki jo objavi uvoz Poročanega dela za vse oddelke (samodejno).
 */
export type SkupinaTv = {
  /** Enako kot id opravila v vrsti objav (plan:M, delo, zakljuceni). */
  id: string;
  naslov: string;
  /** Plan: oddelek, ki ga objavi Sync. */
  oddelek: OddelekKoda | null;
  /** Objavi se sama ob uvozu teh datotek (Sync na strani Podatki); prazno = samo Shrani plan / gumb Sync. */
  samodejno: SyncDatotekaKljuc[];
  /** Gumb Sync na strani Sync v TV (ročna objava). */
  rocno: boolean;
  komponente: { naslov: string; koda: string }[];
};

export const SKUPINE_TV: SkupinaTv[] = [
  ...ODDELKI_TV.map((o) => ({
    id: `plan:${o}`,
    naslov: `Delovni plan · ${NAZIV_ODDELKA[o]}`,
    oddelek: o,
    samodejno: [],
    rocno: true,
    komponente: [
      { naslov: "Workflow", koda: kodaWorkflowa(o) },
      { naslov: "Pregled (roki)", koda: kodaPregleda(o) },
    ],
  })),
  {
    id: "delo",
    naslov: "Delo - prejšnji dan",
    oddelek: null,
    samodejno: ["porocano"],
    rocno: true,
    komponente: ODDELKI_TV.map((o) => ({ naslov: NAZIV_ODDELKA[o], koda: kodaDela(o) })),
  },
  {
    id: "zakljuceni",
    naslov: "Zaključeni krovni",
    oddelek: null,
    samodejno: ["porocano"],
    rocno: true,
    komponente: ODDELKI_TV.map((o) => ({ naslov: NAZIV_ODDELKA[o], koda: kodaZakljucenih(o) })),
  },
  {
    id: "pripravljenost",
    naslov: "Pripravljenost materiala",
    oddelek: null,
    samodejno: ["izdaje", "material", "dobave", "nalogi"],
    rocno: true,
    komponente: ODDELKI_TV.map((o) => ({ naslov: NAZIV_ODDELKA[o], koda: kodaPripravljenosti(o) })),
  },
];

export const VSE_KODE_TV = SKUPINE_TV.flatMap((s) => s.komponente.map((k) => k.koda));

// =====================================================================
// ENOTNO STANJE (StanjeIkona)
// =====================================================================

/** Stanje za ikono: od najhujšega - napaka, v teku, čaka, opozorilo, ok, neznano (izklopljeno / ni podatka). */
export type StanjeTv = "napaka" | "v_teku" | "caka" | "opozorilo" | "ok" | "neznano";

const TEZA: Record<StanjeTv, number> = { napaka: 5, v_teku: 4, caka: 3, opozorilo: 2, ok: 1, neznano: 0 };

export type OcenaTv = { stanje: StanjeTv; opis: string };

/** Opravilo vrste, ki objavlja komponento (zadnje dodano). */
export const opraviloZa = (koda: string, opravila: OpraviloTv[]) => [...opravila].reverse().find((o) => o.kode.includes(koda));

/** Napredek opravila, npr. " - teden 2 / 7". */
export const napredekOpravila = (o: OpraviloTv) => (o.vseh ? ` - teden ${Math.min(o.korak + 1, o.vseh)} / ${o.vseh}` : "");

/** Stanje ene komponente: najprej vrsta objav te seje (teče / čaka / napaka), sicer zadnja objava v FinOS. */
export function ocenaKomponente(koda: string, s: StanjeTvKomponente | undefined, opravila: OpraviloTv[]): OcenaTv {
  const o = opraviloZa(koda, opravila);
  if (o?.stanje === "tece") return { stanje: "v_teku", opis: `Objavljam na TV${napredekOpravila(o)}` };
  if (o?.stanje === "caka") return { stanje: "caka", opis: "Čaka na objavo (v vrsti)" };
  if (o?.stanje === "napaka") return { stanje: "napaka", opis: `Objava ni uspela: ${o.sporocilo}` };
  if (!s || s.vklopljena === null) return { stanje: "neznano", opis: "Komponente ni v FinOS ali ni dostopa" };
  if (!s.vklopljena) return { stanje: "neznano", opis: "Izklopljena v FinOS - ne objavlja se" };
  if (!s.zadnja) return { stanje: "opozorilo", opis: "Še ni objave" };
  const kdaj = formatDatumUra(s.zadnja.cas);
  if (!s.zadnja.danes) return { stanje: "opozorilo", opis: `Danes ni strani na TV (zadnja objava ${kdaj})` };
  return { stanje: "ok", opis: `Objavljeno ${kdaj} · danes ${s.zadnja.danes} str.` };
}

/** Najhujše stanje več komponent (skupina, stran, glava). Opis = najhujša komponenta, z imenom. */
export function najhujse(ocene: { naslov: string; ocena: OcenaTv }[]): OcenaTv {
  let naj: { naslov: string; ocena: OcenaTv } | null = null;
  for (const x of ocene) if (!naj || TEZA[x.ocena.stanje] > TEZA[naj.ocena.stanje]) naj = x;
  if (!naj) return { stanje: "neznano", opis: "Ni komponent" };
  if (naj.ocena.stanje === "neznano") return { stanje: "neznano", opis: "Komponente so izklopljene ali jih ni v FinOS" };
  if (naj.ocena.stanje === "ok") return { stanje: "ok", opis: "Vse vklopljene komponente so na TV" };
  return { stanje: naj.ocena.stanje, opis: `${naj.naslov}: ${naj.ocena.opis}` };
}

/** Stanje skupine (vse njene komponente). */
export const ocenaSkupine = (s: SkupinaTv, komponente: Map<string, StanjeTvKomponente> | null, opravila: OpraviloTv[]) =>
  najhujse(s.komponente.map((k) => ({ naslov: k.naslov, ocena: ocenaKomponente(k.koda, komponente?.get(k.koda), opravila) })));

/** Zadnja objava katerekoli komponente skupine (ISO) ali null. */
export const zadnjaObjavaSkupine = (s: SkupinaTv, komponente: Map<string, StanjeTvKomponente> | null) =>
  s.komponente.reduce<string | null>((m, k) => {
    const c = komponente?.get(k.koda)?.zadnja?.cas ?? null;
    return c && (!m || c > m) ? c : m;
  }, null);
