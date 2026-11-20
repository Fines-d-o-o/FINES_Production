// Pripravljenost materiala (Proizvodnja -> Planiranje): ali je ves material za krovni nalog na zalogi
// in, če ni, kdaj pride z naročili dobaviteljem. Logika je opisana pri funkciji izracunajPripravljenost.
import { addDays, fromIso, type IsoDate } from "./dates";
import type { Dobava, VrstaRoka } from "./dobave";
import type { IzdajaVrstica } from "./doizdaja";
import type { Material } from "./material";
import type { RocniVrstniRed } from "./materialVrstniRed";
import type { Postavitev } from "./plan";
import type { NalogDodelitev } from "./prioritete";
import type { Nalog } from "./zasedenost";

// =====================================================================
// TIPI
// =====================================================================

/**
 * Stanje vrstice materiala (od najboljšega do najslabšega):
 *   zaloga      - v celoti pokrito z zalogo matičnega skladišča,
 *   pride       - pokrito z dobavami, ki pridejo do začetka v planu (ali nalog ni v planu),
 *   zapadel     - pokrito z dobavo, katere rok je že mimo, a še ni prevzeta,
 *   prepozno    - dobava pride po začetku v planu,
 *   ni_naroceno - del potrebe ni pokrit ne z zalogo ne z odprtimi naročili.
 */
export type StanjeMateriala = "zaloga" | "pride" | "zapadel" | "prepozno" | "ni_naroceno";

export const STANJA: StanjeMateriala[] = ["ni_naroceno", "prepozno", "zapadel", "pride", "zaloga"];

export const OPIS_STANJA_MAT: Record<StanjeMateriala, string> = {
  zaloga: "Na zalogi",
  pride: "Pride pravočasno",
  zapadel: "Rok dobave zapadel",
  prepozno: "Pride prepozno",
  ni_naroceno: "Ni naročeno",
};

/**
 * Imena in razlage stolpcev količin (zaslon, Excel / TXT, PDF) - povsod enaka.
 * Velja: Še za izdati = Pokrije zaloga + Čaka dobavo + Manjka.
 */
export const STOLPCI_KOLICIN = {
  potrebno: {
    ime: "Še za izdati",
    opis: "Količina, ki jo nalog še potrebuje iz skladišča (planirano na nalogu - že izdano).",
  },
  zaloge: {
    ime: "Pokrije zaloga",
    opis: "Del, ki ga pokrije zaloga matičnega skladišča - kar ostane, ko zalogo vzamejo nalogi z višjo prioriteto (tudi drugi krovni).",
  },
  dobave: {
    ime: "Čaka dobavo",
    opis: "Del, ki je naročen pri dobavitelju in še ni v hiši - kdaj pride, je v stolpcu Pride.",
  },
  manjka: {
    ime: "Manjka",
    opis: "Ni na zalogi in ni naročeno - treba naročiti.",
  },
} as const;

export const LEGENDA_KOLICIN = `${STOLPCI_KOLICIN.potrebno.ime} = ${STOLPCI_KOLICIN.zaloge.ime} + ${STOLPCI_KOLICIN.dobave.ime} + ${STOLPCI_KOLICIN.manjka.ime}`;

/** Resnost stanja (višje = slabše) - stanje skupine je najslabše stanje vrstic. */
const RESNOST: Record<StanjeMateriala, number> = { zaloga: 0, pride: 1, zapadel: 2, prepozno: 3, ni_naroceno: 4 };
export const slabse = (a: StanjeMateriala, b: StanjeMateriala) => (RESNOST[a] >= RESNOST[b] ? a : b);
export const resnost = (s: StanjeMateriala) => RESNOST[s];

/** Del dobave, ki je dodeljen potrebi. */
export type DelDobave = {
  stevilka: string;
  dobavitelj: string | null;
  rok: IsoDate | null;
  vrsta_roka: VrstaRoka | null;
  kolicina: number;
};

/** Potreba enega naloga po enem materialu (neizdano) in kako je pokrita. */
export type VrsticaPotrebe = {
  st_naloga: string;
  krovni: string;
  ident: string;
  naziv: string | null;
  skupina: string | null;
  em: string | null;
  /** Neizdana količina (planirano - izdano na nalog). */
  potrebno: number;
  /** Pokrito z zalogo matičnega skladišča (po vrstnem redu plana). */
  izZaloge: number;
  /** Pokrito z odprtimi naročili (po roku dobave). */
  dobave: DelDobave[];
  /** Ni pokrito ne z zalogo ne z naročili. */
  manjka: number;
  /** Začetek naloga v planu (najzgodnejša postavitev); null = ni v planu. */
  zacetek: IsoDate | null;
  /**
   * Dan, ko je material za to vrstico v hiši - za izračun rezerve (danes = na zalogi; zamujena dobava ne more
   * priti pred danes, zato je tudi takrat danes); null = ni naročeno ali dobava brez roka.
   */
  kompleten: IsoDate | null;
  /** Najkasnejši rok dobav, ki pokrivajo vrstico, kot je v naročilu (lahko že mimo); null = brez dobav ali brez roka. */
  rokDobave: IsoDate | null;
  /** Nepotrjen rok (želeni ali predviden) je že mimo - kdaj pride, ni znano. */
  rokNeznan: boolean;
  stanje: StanjeMateriala;
};

export type NalogPotrebe = {
  st_naloga: string;
  krovni: string;
  koda_artikla: string | null;
  naziv: string | null;
  /** Glavna družina izdelka iz normativov (OCB-e -> OCB); null = izdelek nima normativa / družine. */
  druzina: string | null;
  /** Odprta količina naloga (razpisano - izdelano); null = nalog ni v uvozu nalogov. */
  kos: number | null;
  narocnik: string | null;
  rok: IsoDate | null;
  zacetek: IsoDate | null;
  /** Naročila (odpreme), ki jih nalog pokrije - kot na Prioritetah / Zamudah dobav, po datumu odpreme. */
  odpreme: NalogDodelitev[];
  /** Najzgodnejša odprema naloga; null = nalog dela na zalogo (brez naročila). */
  prvaOdprema: IsoDate | null;
  /** Mesto naloga v krovnem pri razdelitvi materiala (1 = prvi dobi material). */
  vrstniRed: number;
  /** Mesto po privzetem vrstnem redu (plan, nato najzgodnejša odprema). */
  privzetiRed: number;
  vrstice: VrsticaPotrebe[];
};

export type KrovniPripravljenost = {
  krovni: string;
  /** Glavne družine izdelkov krovnega po vrstnem redu nalogov (krovni ima več nalogov z različnimi izdelki). */
  druzine: string[];
  /** Najzgodnejši začetek nalogov krovnega v planu; null = ni v planu. */
  zacetek: IsoDate | null;
  /** Oddelek / celica najzgodnejše postavitve. */
  oddelek_id: number | null;
  delovno_mesto_id: number | null;
  rok: IsoDate | null;
  /** Nalogi po vrstnem redu za material (prvi dobi material prvi). */
  nalogi: NalogPotrebe[];
  /** Ročno nastavljen vrstni red za material (velja namesto privzetega); null = privzeti. */
  rocniRed: RocniVrstniRed | null;
  /** Vse neizdane vrstice nalogov (brez izločenih skupin). */
  vrstice: VrsticaPotrebe[];
  /** Vrstice, ki niso na zalogi. */
  manjkajocih: number;
  /** Ves material v hiši (null = ni znano - ni naročeno ali dobava brez roka). */
  kompleten: IsoDate | null;
  /** Material bi moral biti že v hiši (vsi roki dobav so mimo), a še ni prevzet - kompleten je takrat danes. */
  zamuja: boolean;
  /** Koledarski dnevi od dneva, ko je material kompleten, do začetka (+ rezerva, - zamuda); null = ni znano. */
  rezerva: number | null;
  stanje: StanjeMateriala;
};

/** Material, ki manjka na zalogi za vsaj en nalog. */
export type MaterialPripravljenost = {
  ident: string;
  naziv: string | null;
  skupina: string | null;
  em: string | null;
  /** Neizdana potreba vseh aktivnih nalogov. */
  potrebno: number;
  /** Zaloga matičnega skladišča (3). */
  zaloga: number;
  /** Zaloga ostalih skladišč (4) - samo informativno, ne šteje se. */
  zalogaOstalo: number;
  /** Naročeno po ERP (stolpec 5 v izvozu materiala). */
  narocenoErp: number | null;
  /** Seštevek odprtih postavk naročil (uvoz Naročila dobavitelju). */
  narocenoPostavke: number;
  /** Ne pokrito ne z zalogo ne z naročili. */
  manjka: number;
  /** Odprte postavke naročil (po roku). */
  dobave: Dobava[];
  /** Neizdane vrstice nalogov, ki niso na zalogi. */
  vrstice: VrsticaPotrebe[];
  krovni: string[];
  stanje: StanjeMateriala;
};

export type Pripravljenost = {
  danes: IsoDate;
  krovni: KrovniPripravljenost[];
  material: MaterialPripravljenost[];
  skupine: string[];
  klasifikati: Record<string, string>;
  /** Identi, kjer se naročeno po ERP razlikuje od seštevka odprtih postavk (npr. izvoz naročil ni popoln). */
  razlikeNarocil: number;
};

// =====================================================================
// IZRAČUN
// =====================================================================

const EPS = 1e-6;

/** Klasifikat materiala: številčna predpona šifre ("096-10129" -> "096"). */
const klasifikat = (ident: string) => ident.match(/^(\d+)-/)?.[1] ?? null;

/** Koledarski dnevi od a do b (b - a). */
export const razlikaDni = (a: IsoDate, b: IsoDate) => Math.round((fromIso(b).getTime() - fromIso(a).getTime()) / 86400000);

const maxDatum = (a: IsoDate | null, b: IsoDate | null) => (a === null ? b : b === null ? a : a > b ? a : b);

/** Skupine materiala iz izvoza izdaj in njihovi klasifikati ("096 · Pločevina"), razvrščene po klasifikatu. */
export function skupineMateriala(izdaje: IzdajaVrstica[]) {
  const klasifikatiSkupin = new Map<string, Set<string>>();
  for (const v of izdaje) {
    if (!v.skupina) continue;
    const k = klasifikat(v.ident);
    if (!klasifikatiSkupin.has(v.skupina)) klasifikatiSkupin.set(v.skupina, new Set());
    if (k) klasifikatiSkupin.get(v.skupina)!.add(k);
  }
  const klasifikati: Record<string, string> = Object.fromEntries(
    [...klasifikatiSkupin].map(([s, ks]) => [s, [...ks].sort((a, b) => a.localeCompare(b, "sl", { numeric: true })).join(", ")]),
  );
  const skupine = [...klasifikatiSkupin.keys()].sort(
    (a, b) => klasifikati[a].localeCompare(klasifikati[b], "sl", { numeric: true }) || a.localeCompare(b, "sl"),
  );
  return { skupine, klasifikati };
}

/**
 * 1. Potreba: za vsak aktiven nalog (izvoz izdaj) neizdana količina materiala ("Za izdajo"), brez izločenih skupin.
 * 2. Prioriteta naloga: začetek v delovnem planu (najzgodnejša postavitev, ki ga vključuje; postavitev brez izbire
 *    nalogov vključuje vse naloge krovnega), nato najzgodnejša odprema, ki jo nalog pokrije (ista razdelitev naročil
 *    kot na Prioritetah / v Zamudah dobav), nalogi brez odpreme (na zalogo) zadnji, nato številka naloga.
 *    Rok izdelave iz ERP se ne upošteva (je samo okviren). Nalogi, ki niso v planu, so za vsemi v planu.
 *    Ročni vrstni red krovnega (vrstniRed) nalogom krovnega zamenja mesta - krovni ostane na istem mestu med
 *    ostalimi krovnimi, znotraj njega pa material dobijo nalogi v ročnem vrstnem redu.
 * 3. Po tem vrstnem redu se za vsak material razdeli zaloga matičnega skladišča (zaloga ostalih skladišč se ne šteje),
 *    nato naročila, oddana za ta delovni nalog (postavka naročila ima vpisan nalog), nato ostale odprte postavke
 *    po roku dobave (najprej najzgodnejše). Naročilo za drug aktiven nalog najprej pokrije tisti nalog, ostanek
 *    je prost. Kar ostane, ni naročeno.
 * 4. Stanje vrstice: vse z zaloge = na zalogi; dobava z rokom po začetku = prepozno; dobava z rokom pred danes
 *    = zapadel; ostalo pride pravočasno. Material krovnega je kompleten na najkasnejši rok dobave njegovih vrstic.
 */
export function izracunajPripravljenost({
  izdaje,
  nalogi,
  postavitve,
  material,
  dobave,
  izlocene,
  druzine = new Map(),
  odpremeNalogov = new Map(),
  vrstniRed = new Map(),
  danes,
}: {
  izdaje: IzdajaVrstica[];
  nalogi: Nalog[];
  postavitve: Postavitev[];
  material: Map<string, Material>;
  dobave: Dobava[];
  izlocene: Set<string>;
  /** Ident izdelka -> glavna družina (normativi). */
  druzine?: Map<string, string>;
  /** Delovni nalog -> naročila (odpreme), ki jih pokrije (dodelitveNalogov). */
  odpremeNalogov?: Map<string, NalogDodelitev[]>;
  /** Krovni -> ročni vrstni red nalogov za material. */
  vrstniRed?: Map<string, RocniVrstniRed>;
  danes: IsoDate;
}): Pripravljenost {
  const { skupine, klasifikati } = skupineMateriala(izdaje);

  // ---- krovni in nazivi iz uvoza delovnih nalogov
  const nalogPodatki = new Map(nalogi.map((n) => [n.st_naloga, n]));
  const krovniNaloga = (st: string) => nalogPodatki.get(st)?.krovni_dn ?? st;
  const nalogiKrovnega = new Map<string, string[]>();
  for (const n of nalogi) {
    const k = n.krovni_dn ?? n.st_naloga;
    const xs = nalogiKrovnega.get(k);
    if (xs) xs.push(n.st_naloga);
    else nalogiKrovnega.set(k, [n.st_naloga]);
  }

  // ---- 2. začetek naloga v planu
  type Zacetek = { datum: IsoDate; oddelek_id: number; delovno_mesto_id: number };
  const zacetekNaloga = new Map<string, Zacetek>();
  for (const p of postavitve) {
    if (p.prosta) continue;
    const vkljuceni = p.nalogi ?? nalogiKrovnega.get(p.krovni_dn) ?? [p.krovni_dn];
    for (const st of vkljuceni) {
      const z = zacetekNaloga.get(st);
      if (!z || p.datum_zacetka < z.datum)
        zacetekNaloga.set(st, { datum: p.datum_zacetka, oddelek_id: p.oddelek_id, delovno_mesto_id: p.delovno_mesto_id });
    }
  }

  // ---- 1. potrebe (vsota, če je ident na nalogu večkrat)
  const potrebe = new Map<string, VrsticaPotrebe>();
  const podatkiNaloga = new Map<string, IzdajaVrstica>();
  for (const v of izdaje) {
    if (!podatkiNaloga.has(v.st_naloga)) podatkiNaloga.set(v.st_naloga, v);
    if (v.za_izdajo <= EPS || izlocene.has(v.skupina ?? "")) continue;
    const kljuc = `${v.st_naloga}|${v.ident}`;
    const o = potrebe.get(kljuc);
    if (o) {
      o.potrebno += v.za_izdajo;
      continue;
    }
    potrebe.set(kljuc, {
      st_naloga: v.st_naloga,
      krovni: krovniNaloga(v.st_naloga),
      ident: v.ident,
      naziv: v.naziv,
      skupina: v.skupina,
      em: v.em,
      potrebno: v.za_izdajo,
      izZaloge: 0,
      dobave: [],
      manjka: 0,
      zacetek: zacetekNaloga.get(v.st_naloga)?.datum ?? null,
      kompleten: null,
      rokDobave: null,
      rokNeznan: false,
      stanje: "zaloga",
    });
  }

  // ---- 2. prioriteta: začetek v planu, nato najzgodnejša odprema, nato številka naloga
  const rokNaloga = (st: string) => nalogPodatki.get(st)?.rok_izdelave ?? podatkiNaloga.get(st)?.rok_izdelave ?? null;
  const prvaOdprema = (st: string) => odpremeNalogov.get(st)?.find((d) => d.datum)?.datum ?? null;
  type Kljuc = { zacetek: string; odprema: string; st: string };
  const primerjaj = (a: Kljuc, b: Kljuc) =>
    a.zacetek.localeCompare(b.zacetek) || a.odprema.localeCompare(b.odprema) || a.st.localeCompare(b.st, "sl", { numeric: true });
  const vsiNalogi = new Set<string>(podatkiNaloga.keys());
  for (const p of potrebe.values()) vsiNalogi.add(p.st_naloga);
  const privzeti = new Map<string, Kljuc>(
    [...vsiNalogi].map((st) => [st, { zacetek: zacetekNaloga.get(st)?.datum ?? "9999", odprema: prvaOdprema(st) ?? "9999", st }]),
  );
  // Ročni vrstni red: nalogi krovnega si v ročnem vrstnem redu razdelijo mesta (ključe) svojih nalogov
  const efektivni = new Map(privzeti);
  const aktivniKrovnega = new Map<string, Set<string>>();
  for (const st of vsiNalogi) {
    const k = krovniNaloga(st);
    if (!aktivniKrovnega.has(k)) aktivniKrovnega.set(k, new Set());
    aktivniKrovnega.get(k)!.add(st);
  }
  for (const [krovni, red] of vrstniRed) {
    const aktivni = aktivniKrovnega.get(krovni);
    if (!aktivni) continue;
    const izbrani = [...new Set(red.nalogi)].filter((st) => aktivni.has(st));
    const mesta = izbrani.map((st) => privzeti.get(st)!).sort(primerjaj);
    izbrani.forEach((st, i) => efektivni.set(st, mesta[i]));
  }
  const rang = new Map([...vsiNalogi].sort((a, b) => primerjaj(efektivni.get(a)!, efektivni.get(b)!)).map((st, i) => [st, i]));
  const rangNaloga = (st: string) => rang.get(st) ?? Number.MAX_SAFE_INTEGER;
  const prioriteta = (a: VrsticaPotrebe, b: VrsticaPotrebe) => rangNaloga(a.st_naloga) - rangNaloga(b.st_naloga);

  const poIdentu = new Map<string, VrsticaPotrebe[]>();
  for (const p of potrebe.values()) {
    const xs = poIdentu.get(p.ident);
    if (xs) xs.push(p);
    else poIdentu.set(p.ident, [p]);
  }
  const dobavePoIdentu = new Map<string, Dobava[]>();
  for (const d of dobave) {
    const xs = dobavePoIdentu.get(d.ident);
    if (xs) xs.push(d);
    else dobavePoIdentu.set(d.ident, [d]);
  }
  for (const xs of dobavePoIdentu.values())
    xs.sort((a, b) => (a.rok ?? "9999").localeCompare(b.rok ?? "9999") || a.stevilka.localeCompare(b.stevilka, "sl", { numeric: true }));

  // ---- 3. razdelitev zaloge in dobav
  const zalogaIzIzdaj = new Map<string, number>();
  for (const v of izdaje) zalogaIzIzdaj.set(v.ident, Math.max(zalogaIzIzdaj.get(v.ident) ?? 0, v.zaloga));

  const materialOut: MaterialPripravljenost[] = [];
  let razlikeNarocil = 0;
  for (const [ident, xs] of poIdentu) {
    xs.sort(prioriteta);
    const m = material.get(ident);
    // Zaloga matičnega skladišča; brez izvoza materiala trenutna zaloga iz izvoza izdaj
    let zaloga = Math.max(0, m ? m.zaloga : (zalogaIzIzdaj.get(ident) ?? 0));
    const zalogaZacetna = zaloga;
    const dobaveIdenta = dobavePoIdentu.get(ident) ?? [];
    const ostanek = dobaveIdenta.map((d) => d.odprto);
    const vzemi = (p: VrsticaPotrebe, i: number, kolicina: number) => {
      const d = dobaveIdenta[i];
      const o = p.dobave.find((x) => x.stevilka === d.stevilka && x.rok === d.rok);
      if (o) o.kolicina += kolicina;
      else p.dobave.push({ stevilka: d.stevilka, dobavitelj: d.naziv_dobavitelja, rok: d.rok, vrsta_roka: d.vrsta_roka, kolicina });
      ostanek[i] -= kolicina;
    };

    // Rezervacije: naročilo z vpisanim delovnim nalogom najprej pokrije ta nalog (kar ne pokrije zaloga)
    const potrebeNaloga = new Map(xs.map((p) => [p.st_naloga, p]));
    const rezervirano = new Map<VrsticaPotrebe, [number, number][]>();
    for (let i = 0; i < dobaveIdenta.length; i++) {
      const dn = dobaveIdenta[i].delovni_nalog;
      const p = dn ? potrebeNaloga.get(dn) : undefined;
      if (!p) continue;
      const ze = (rezervirano.get(p) ?? []).reduce((s, [, q]) => s + q, 0);
      const q = Math.min(ostanek[i], p.potrebno - ze);
      if (q <= EPS) continue;
      ostanek[i] -= q;
      rezervirano.set(p, [...(rezervirano.get(p) ?? []), [i, q]]);
    }

    for (const p of xs) {
      let rest = p.potrebno;
      const iz = Math.min(zaloga, rest);
      p.izZaloge = iz;
      zaloga -= iz;
      rest -= iz;
      // lastne rezervacije (nepotreben del se vrne med proste)
      for (const [i, q] of rezervirano.get(p) ?? []) {
        ostanek[i] += q;
        const vzami = Math.min(q, rest);
        if (vzami > EPS) {
          vzemi(p, i, vzami);
          rest -= vzami;
        }
      }
      for (let i = 0; i < dobaveIdenta.length && rest > EPS; i++) {
        const vzami = Math.min(ostanek[i], rest);
        if (vzami > EPS) {
          vzemi(p, i, vzami);
          rest -= vzami;
        }
      }
      p.manjka = rest > EPS ? rest : 0;

      // ---- 4. stanje vrstice
      const roki = p.dobave.map((d) => d.rok);
      const brezRoka = roki.some((r) => r === null);
      p.rokDobave = brezRoka ? null : roki.reduce<IsoDate | null>((a, r) => maxDatum(a, r), null);
      // Nepotrjen rok, ki je že mimo, ne pove ničesar - kdaj pride, ni znano
      p.rokNeznan = p.dobave.some((d) => d.rok !== null && d.rok < danes && d.vrsta_roka !== "potrjen");
      if (p.manjka > 0) {
        p.stanje = "ni_naroceno";
        p.kompleten = null;
      } else if (p.dobave.length === 0) {
        p.stanje = "zaloga";
        p.kompleten = danes;
      } else {
        // Zapadla dobava (rok mimo, ni prevzeta) ne more priti pred danes
        const prihod = maxDatum(p.rokDobave, danes);
        p.kompleten = brezRoka || p.rokNeznan ? null : prihod;
        if (p.zacetek && prihod && prihod > p.zacetek) p.stanje = "prepozno";
        else if (roki.some((r) => r !== null && r < danes)) p.stanje = "zapadel";
        else p.stanje = "pride";
      }
    }

    const narocenoPostavke = dobaveIdenta.reduce((s, d) => s + d.odprto, 0);
    const narocenoErp = m ? m.narocena_kolicina : null;
    if (narocenoErp !== null && Math.abs(narocenoErp - narocenoPostavke) > 0.01) razlikeNarocil++;
    const niNaZalogi = xs.filter((p) => p.stanje !== "zaloga");
    if (niNaZalogi.length === 0) continue;
    materialOut.push({
      ident,
      naziv: xs[0].naziv ?? m?.naziv ?? null,
      skupina: xs[0].skupina,
      em: xs[0].em ?? m?.em ?? null,
      potrebno: xs.reduce((s, p) => s + p.potrebno, 0),
      zaloga: zalogaZacetna,
      zalogaOstalo: m?.zaloga_ostalo ?? 0,
      narocenoErp,
      narocenoPostavke,
      manjka: xs.reduce((s, p) => s + p.manjka, 0),
      dobave: dobaveIdenta,
      vrstice: niNaZalogi,
      krovni: [...new Set(niNaZalogi.map((p) => p.krovni))],
      stanje: niNaZalogi.reduce<StanjeMateriala>((a, p) => slabse(a, p.stanje), "zaloga"),
    });
  }

  // ---- krovni nalogi
  const poKrovnem = new Map<string, VrsticaPotrebe[]>();
  for (const p of potrebe.values()) {
    const xs = poKrovnem.get(p.krovni);
    if (xs) xs.push(p);
    else poKrovnem.set(p.krovni, [p]);
  }
  // Tudi aktivni nalogi brez neizdanega materiala (vse izdano) - pokažejo se kot "na zalogi"
  for (const st of podatkiNaloga.keys()) {
    const k = krovniNaloga(st);
    if (!poKrovnem.has(k)) poKrovnem.set(k, []);
  }

  const krovniOut: KrovniPripravljenost[] = [];
  for (const [krovni, vrstice] of poKrovnem) {
    const stNalogov = new Set<string>(vrstice.map((v) => v.st_naloga));
    for (const st of podatkiNaloga.keys()) if (krovniNaloga(st) === krovni) stNalogov.add(st);
    const poPrivzetem = [...stNalogov].sort((a, b) => primerjaj(privzeti.get(a)!, privzeti.get(b)!));
    const nalogiK: NalogPotrebe[] = [...stNalogov]
      .sort((a, b) => rangNaloga(a) - rangNaloga(b))
      .map((st, i) => {
        const n = nalogPodatki.get(st);
        const iz = podatkiNaloga.get(st);
        const koda = n?.koda_artikla ?? iz?.koda_artikla ?? null;
        return {
          st_naloga: st,
          krovni,
          koda_artikla: koda,
          druzina: (koda && druzine.get(koda)) || null,
          naziv: n?.naziv_artikla ?? iz?.naziv_artikla ?? iz?.opis ?? null,
          kos: n ? Math.max(0, n.razpisana_kolicina - n.izdelana_kolicina) : null,
          narocnik: n?.narocnik ?? null,
          rok: rokNaloga(st),
          zacetek: zacetekNaloga.get(st)?.datum ?? null,
          odpreme: odpremeNalogov.get(st) ?? [],
          prvaOdprema: prvaOdprema(st),
          vrstniRed: i + 1,
          privzetiRed: poPrivzetem.indexOf(st) + 1,
          vrstice: vrstice.filter((v) => v.st_naloga === st),
        };
      });
    const zacetki = [...stNalogov].map((st) => zacetekNaloga.get(st)).filter((z): z is Zacetek => !!z);
    const prvi = zacetki.sort((a, b) => a.datum.localeCompare(b.datum))[0] ?? null;
    const roki = nalogiK.map((n) => n.rok).filter((r): r is IsoDate => !!r).sort();
    const stanje = vrstice.reduce<StanjeMateriala>((a, v) => slabse(a, v.stanje), "zaloga");
    const neznano = vrstice.some((v) => v.kompleten === null);
    const kompleten = neznano ? null : vrstice.reduce<IsoDate>((a, v) => (v.kompleten! > a ? v.kompleten! : a), danes);
    krovniOut.push({
      krovni,
      druzine: [...new Set(nalogiK.map((n) => n.druzina).filter((d): d is string => !!d))],
      zacetek: prvi?.datum ?? null,
      oddelek_id: prvi?.oddelek_id ?? null,
      delovno_mesto_id: prvi?.delovno_mesto_id ?? null,
      rok: roki[0] ?? null,
      nalogi: nalogiK,
      rocniRed: vrstniRed.get(krovni) ?? null,
      vrstice,
      manjkajocih: vrstice.filter((v) => v.stanje !== "zaloga").length,
      kompleten,
      zamuja: kompleten === danes && vrstice.some((v) => v.rokDobave !== null && v.rokDobave < danes),
      rezerva: kompleten && prvi ? razlikaDni(kompleten, prvi.datum) : null,
      stanje,
    });
  }
  krovniOut.sort(
    (a, b) =>
      (a.zacetek ?? "9999").localeCompare(b.zacetek ?? "9999") ||
      (a.rok ?? "9999").localeCompare(b.rok ?? "9999") ||
      a.krovni.localeCompare(b.krovni, "sl", { numeric: true }),
  );
  materialOut.sort((a, b) => RESNOST[b.stanje] - RESNOST[a.stanje] || a.ident.localeCompare(b.ident, "sl", { numeric: true }));

  return { danes, krovni: krovniOut, material: materialOut, skupine, klasifikati, razlikeNarocil };
}

/** Material krovnega, združen po identu (vsi nalogi krovnega) - za PDF / TV in izvoz posameznega krovnega. */
export type MaterialKrovnega = {
  ident: string;
  naziv: string | null;
  em: string | null;
  potrebno: number;
  izZaloge: number;
  /** Pokrito z naročili. */
  naDobavi: number;
  /** Ni naročeno. */
  manjka: number;
  /** Naročila (združena po številki in roku). */
  narocila: DelDobave[];
  /** Ko je ves material identa v hiši (danes = na zalogi ali zamuja); null = ni znano. */
  prihod: IsoDate | null;
  /** Najkasnejši rok dobave iz naročil (lahko že mimo = zamuja); null = brez dobav ali brez roka. */
  rokDobave: IsoDate | null;
  /** Nepotrjen rok je že mimo - kdaj pride, ni znano. */
  rokNeznan: boolean;
  stanje: StanjeMateriala;
};

export function materialKrovnega(k: KrovniPripravljenost, { samoManjkajoci = true } = {}): MaterialKrovnega[] {
  const poIdentu = new Map<string, MaterialKrovnega & { neznano: boolean }>();
  for (const v of k.vrstice) {
    if (samoManjkajoci && v.stanje === "zaloga") continue;
    let m = poIdentu.get(v.ident);
    if (!m) {
      m = { ident: v.ident, naziv: v.naziv, em: v.em, potrebno: 0, izZaloge: 0, naDobavi: 0, manjka: 0, narocila: [], prihod: null, rokDobave: null, rokNeznan: false, stanje: "zaloga", neznano: false };
      poIdentu.set(v.ident, m);
    }
    m.potrebno += v.potrebno;
    m.izZaloge += v.izZaloge;
    m.manjka += v.manjka;
    for (const d of v.dobave) {
      m.naDobavi += d.kolicina;
      const o = m.narocila.find((x) => x.stevilka === d.stevilka && x.rok === d.rok);
      if (o) o.kolicina += d.kolicina;
      else m.narocila.push({ ...d });
    }
    if (v.kompleten === null) m.neznano = true;
    else m.prihod = maxDatum(m.prihod, v.kompleten);
    m.rokDobave = maxDatum(m.rokDobave, v.rokDobave);
    if (v.rokNeznan) m.rokNeznan = true;
    m.stanje = slabse(m.stanje, v.stanje);
  }
  return [...poIdentu.values()]
    .map(({ neznano, ...m }) => ({
      ...m,
      prihod: neznano ? null : m.prihod,
      rokDobave: m.rokDobave,
      narocila: m.narocila.sort((a, b) => (a.rok ?? "9999").localeCompare(b.rok ?? "9999")),
    }))
    .sort(
      (a, b) =>
        RESNOST[b.stanje] - RESNOST[a.stanje] ||
        (a.prihod ?? "9999").localeCompare(b.prihod ?? "9999") ||
        a.ident.localeCompare(b.ident, "sl", { numeric: true }),
    );
}

/**
 * Kdaj pride material vrstice (besedilo): rok dobave iz naročila; če je že mimo, "zamuja" (material še ni prevzet,
 * novega roka ne poznamo).
 */
export function prihodTxt(
  v: { stanje: StanjeMateriala; rokDobave: IsoDate | null; rokNeznan: boolean; manjka: number; imaDobave: boolean },
  danes: IsoDate,
  datum: (d: IsoDate) => string,
) {
  if (v.stanje === "zaloga") return "na zalogi";
  if (!v.imaDobave) return v.manjka > 0 ? "ni naročeno" : "–";
  if (v.rokNeznan) return "ni znano (nepotrjen rok je mimo)";
  if (!v.rokDobave) return "brez roka";
  if (v.rokDobave < danes) return `zamuja (rok ${datum(v.rokDobave)})`;
  return datum(v.rokDobave);
}

/** "Material kompleten" krovnega (besedilo). */
export const kompletenTxt = (k: KrovniPripravljenost, datum: (d: IsoDate) => string, vHisi = "v hiši") =>
  k.stanje === "zaloga" ? vHisi : !k.kompleten ? "ni znano" : k.zamuja ? "zamuja" : datum(k.kompleten);

/** Prvi rok dobave v prihodnosti (za prikaz "naslednja dobava"). */
export const naslednjaDobava = (dobave: Dobava[], danes: IsoDate) =>
  dobave.find((d) => d.rok !== null && d.rok >= danes) ?? null;

/** Datum začetka: "danes", "jutri" ali datum. */
export const relativno = (d: IsoDate, danes: IsoDate) => (d === danes ? "danes" : d === addDays(danes, 1) ? "jutri" : null);
