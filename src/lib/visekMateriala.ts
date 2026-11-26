// Orodja → Višek materiala: iskanje vzroka, zakaj je po zaključenem nalogu na celici ostal material.
//
// Štiri kontrole za vsako postavko viška (ident + količina):
//   1. Kosovnice - koliko kosov identa gre na izdelek vsakega naloga; primerjava s podobnimi izdelki
//      (podoben naziv). Odgovor je vedno "verjetno": kosovnica je verjetno pravilna / verjetno napačna.
//   2. Izdani material - izdano na nalog (Kreiranje izdaj v proizvodnjo) proti planu DN in kosovnici.
//   3. Prevzem iz proizvodnje - prevzetih manj kosov, kot je razpisanih (material za neizdelane kose).
//   4. Zaloga - matična zaloga identa (Material pregled planirane porabe) za kontrolo skladiščnika
//      in aktivni nalogi, ki ident še potrebujejo (kam z viškom).
//
// Analiza (čiste funkcije) je ločena od branja iz baze - testirana na pravih izvozih.
import { zgradiDrevo, type KosovnicaVrstica, type Vozlisce } from "./kosovnice";
import { fetchAll, getSupabase, kosi } from "./supabase";
import { naloziPrevzemeNalogov, type PrevzemNaloga } from "./prevzemProizvodnje";

// =====================================================================
// TIPI
// =====================================================================

export type VisNalog = {
  st_naloga: string;
  krovni_dn: string | null;
  koda_artikla: string | null;
  naziv_artikla: string | null;
  razpisana_kolicina: number | null;
  izdelana_kolicina: number | null;
  status: string | null;
  rok_izdelave: string | null;
  zakljucen: boolean;
};

/** Material na nalogu. porabljeno / planirano NULL = izvoz nima podatka (ni 0). */
export type VisIzdaja = {
  st_naloga: string;
  koda_artikla: string | null;
  naziv_artikla: string | null;
  razpisana_kolicina: number;
  ident: string;
  naziv: string | null;
  em: string | null;
  porabljeno: number | null;
  planirano: number | null;
  za_izdajo: number | null;
  rok_izdelave: string | null;
};

export type KorenKosovnice = { sifra: string; naziv: string; izdelek: string };

export type ZalogaIdenta = {
  ident: string;
  naziv: string | null;
  em: string | null;
  zaloga: number;
  razpolozljiva: number;
  potreba_dn: number;
  prosta_zaloga: number;
  narocena_kolicina: number;
};

/** Postavka viška, ki jo vpiše uporabnik. */
export type PostavkaViska = { ident: string; naziv: string; em: string | null; kolicina: number };

/** ok = ni vzrok · vzrok = verjetni vzrok viška · nejasno = ni zanesljive ocene · kontrola = potrebna ročna kontrola · ni_podatkov */
export type Ocena = "ok" | "vzrok" | "nejasno" | "kontrola" | "ni_podatkov";

// =====================================================================
// PODOBNOST NAZIVOV
// =====================================================================

const EPS = 1e-6;
const norm = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
const besede = (t: string) => norm(t).split(/[^a-z0-9]+/).filter(Boolean);
function trigrami(t: string) {
  const s = ` ${besede(t).join(" ")} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= s.length; i++) out.add(s.slice(i, i + 3));
  return out;
}
const dice = <T,>(a: Set<T>, b: Set<T>) => {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return (2 * n) / (a.size + b.size);
};

/** Podobnost nazivov 0-1: polovica ujemanje besed, polovica ujemanje črk (trigrami) - "HTB-5" ~ "HTB-10". */
export function podobnostNazivov(a: string, b: string) {
  return 0.5 * dice(new Set(besede(a)), new Set(besede(b))) + 0.5 * dice(trigrami(a), trigrami(b));
}

/** Najmanjša podobnost naziva, da izdelek šteje kot kontrolni. */
export const PRAG_KONTROLNEGA = 0.5;
/** Najmanjša podobnost naziva komponente, da šteje kot enakovredna (npr. drug motor iste vrste). */
const PRAG_ENAKOVREDNE = 0.55;

/** Izdelki s čim bolj podobnim nazivom (in iste družine šifre) - za primerjavo kosovnice. */
export function kontrolniIzdelki(koda: string, naziv: string, koreni: KorenKosovnice[], najvec = 6) {
  const druzina = koda.slice(0, 7);
  return koreni
    .filter((k) => k.sifra !== koda)
    .map((k) => ({ ...k, podobnost: Math.min(1, podobnostNazivov(naziv, k.naziv) + (k.sifra.slice(0, 7) === druzina ? 0.05 : 0)) }))
    .filter((k) => k.podobnost >= PRAG_KONTROLNEGA)
    .sort((a, b) => b.podobnost - a.podobnost || a.sifra.localeCompare(b.sifra, "sl", { numeric: true }))
    .slice(0, najvec);
}

// =====================================================================
// KOSOVNICA: POJAVITVE IDENTA
// =====================================================================

export type Pojavitev = {
  /** Nadrejeni sestavi od izdelka do identa (brez izdelka samega). */
  pot: { sifra: string; naziv: string }[];
  /** Količina na nadrejeni sestav. */
  naSestav: number;
  /** Količina na en izdelek (pomnožena po nivojih). */
  naIzdelek: number;
  /** Prvi nadrejeni sestav, ki ima svoj nalog v istem krovnem - material gre na tisti nalog. */
  drugNalog: string | null;
};

/** Vse pojavitve identa v kosovnici; `sorodni` = izdelki drugih nalogov istega krovnega. */
export function pojavitve(koren: Vozlisce, ident: string, sorodni: Set<string> = new Set()): Pojavitev[] {
  const out: Pojavitev[] = [];
  function obisk(n: Vozlisce, pot: Vozlisce[]) {
    for (const o of n.otroci) {
      if (o.sifra === ident)
        out.push({
          pot: pot.map((p) => ({ sifra: p.sifra, naziv: p.naziv })),
          naSestav: o.kolicina,
          naIzdelek: o.skupaj,
          drugNalog: pot.find((p) => sorodni.has(p.sifra))?.sifra ?? null,
        });
      obisk(o, [...pot, o]);
    }
  }
  obisk(koren, []);
  return out;
}

const vsota = (p: Pojavitev[]) => p.reduce((s, x) => s + x.naIzdelek, 0);

export type KolicinaKontrolnega =
  | { tip: "enak"; sifra: string; naziv: string; kolicina: number; mest: number }
  | { tip: "enakovreden"; sifra: string; naziv: string; kolicina: number; mest: number; podobnost: number }
  | { tip: "ni" };

/** Koliko kosov identa (ali enakovredne komponente: isti klasifikat, podoben naziv) ima kontrolni izdelek. */
export function kolicinaVKontrolnem(drevo: Vozlisce, ident: string, identNaziv: string): KolicinaKontrolnega {
  const enak = pojavitve(drevo, ident);
  if (enak.length) return { tip: "enak", sifra: ident, naziv: identNaziv, kolicina: vsota(enak), mest: enak.length };
  const klas = ident.slice(0, 3);
  let naj: { sifra: string; naziv: string; podobnost: number } | null = null;
  const obisk = (n: Vozlisce) => {
    for (const o of n.otroci) {
      if (o.sifra.slice(0, 3) === klas) {
        const p = podobnostNazivov(identNaziv, o.naziv);
        if (p >= PRAG_ENAKOVREDNE && (!naj || p > naj.podobnost)) naj = { sifra: o.sifra, naziv: o.naziv, podobnost: p };
      }
      obisk(o);
    }
  };
  obisk(drevo);
  if (!naj) return { tip: "ni" };
  const { sifra, naziv, podobnost } = naj;
  const p = pojavitve(drevo, sifra);
  return { tip: "enakovreden", sifra, naziv, kolicina: vsota(p), mest: p.length, podobnost };
}

// =====================================================================
// KONTROLA 1: KOSOVNICE
// =====================================================================

export type Kontrolni = KorenKosovnice & { podobnost: number; rezultat: KolicinaKontrolnega | null };

export type K1Izdelek = {
  koda: string;
  naziv: string;
  nalogi: string[];
  razpisano: number;
  /** Kosov identa na en izdelek; null = izdelek nima kosovnice. */
  naIzdelek: number | null;
  pojavitve: Pojavitev[];
  kontrolni: Kontrolni[];
  /** Količina, ki jo ima večina podobnih izdelkov (utež = podobnost naziva). */
  vecina: { kolicina: number; delez: number; stevilo: number; od: number } | null;
  ocena: Ocena;
  besedilo: string;
};

export type Kontrola1 = { ocena: Ocena; povzetek: string; izdelki: K1Izdelek[] };

const fmt = new Intl.NumberFormat("sl-SI", { maximumFractionDigits: 3 });
const f = (n: number) => fmt.format(n);
/** Enota identa za besedila ("kos", "m" ...). */
const enota = (p: PostavkaViska) => (p.em ?? "kos").toLowerCase();

/** Večina med kontrolnimi izdelki: količina z največjo vsoto podobnosti. */
function vecinaKontrolnih(kontrolni: Kontrolni[]) {
  const prim = kontrolni.filter((k) => k.rezultat && k.rezultat.tip !== "ni");
  if (!prim.length) return null;
  const utez = new Map<number, { w: number; n: number }>();
  for (const k of prim) {
    const q = Math.round((k.rezultat as { kolicina: number }).kolicina * 1000) / 1000;
    const u = utez.get(q) ?? { w: 0, n: 0 };
    u.w += k.podobnost;
    u.n += 1;
    utez.set(q, u);
  }
  const skupaj = [...utez.values()].reduce((s, u) => s + u.w, 0);
  const [kolicina, u] = [...utez.entries()].sort((a, b) => b[1].w - a[1].w)[0];
  return { kolicina, delez: u.w / skupaj, stevilo: u.n, od: prim.length };
}

/** Delež podobnih izdelkov (po podobnosti), ki mora imeti isto količino, da je ocena zanesljiva. */
const PRAG_VECINE = 0.6;
/** Podobnost, nad katero je kontrolni izdelek "dvojček" (npr. leva / desna izvedba istega izdelka). */
const PRAG_DVOJCKA = 0.95;

export function kontrola1(
  izdelki: { koda: string; naziv: string; nalogi: string[]; razpisano: number; drevo: Vozlisce | null; kontrolni: Kontrolni[] }[],
  postavka: PostavkaViska,
  /** Nalogi, kjer je ident v materialu DN (plan ali izdaja) - iz izdaj. */
  naDn: string[] = [],
): Kontrola1 {
  const e = enota(postavka);
  const rez: K1Izdelek[] = izdelki.map((i) => {
    const osnova = { koda: i.koda, naziv: i.naziv, nalogi: i.nalogi, razpisano: i.razpisano, kontrolni: i.kontrolni };
    if (!i.drevo)
      return { ...osnova, naIzdelek: null, pojavitve: [], vecina: null, ocena: "ni_podatkov", besedilo: `Za izdelek ${i.koda} ni uvožene kosovnice.` };
    const poj = pojavitve(i.drevo, postavka.ident);
    const q = vsota(poj);
    const vecina = vecinaKontrolnih(i.kontrolni);
    const k = { ...osnova, naIzdelek: q, pojavitve: poj, vecina };
    if (!poj.length) return { ...k, ocena: "ok", besedilo: `Ident ni v kosovnici izdelka ${i.koda}.` };
    const mesta = poj.length > 1 ? ` Ident je v kosovnici na ${poj.length} mestih (${poj.map((p) => p.pot.at(-1)?.sifra ?? "izdelek").join(", ")}).` : "";
    if (!vecina)
      return { ...k, ocena: "nejasno", besedilo: `Kosovnica ima ${f(q)} ${e} na izdelek. Ni podobnih izdelkov z istim ali enakovrednim materialom - kosovnico preveri ročno.${mesta}` };
    const opisVecine = `${vecina.stevilo} od ${vecina.od} podobnih izdelkov ima ${f(vecina.kolicina)} ${e}`;
    if (Math.abs(q - vecina.kolicina) < EPS)
      return { ...k, ocena: "ok", besedilo: `Kosovnica za ${i.koda} je verjetno pravilna: ${f(q)} ${e} na izdelek, ${opisVecine}.` };
    if (vecina.delez < PRAG_VECINE)
      return { ...k, ocena: "nejasno", besedilo: `Kosovnica ima ${f(q)} ${e} na izdelek, podobni izdelki imajo različne količine (največ: ${opisVecine}). Zanesljive ocene ni.${mesta}` };
    // Skoraj enak izdelek (npr. leva / desna izvedba) z enako količino je močnejši dokaz kot večina
    const dvojcek = i.kontrolni.find((c) => c.podobnost >= PRAG_DVOJCKA && c.rezultat?.tip !== "ni" && c.rezultat && Math.abs(c.rezultat.kolicina - q) < EPS);
    if (q > vecina.kolicina && dvojcek)
      return {
        ...k,
        ocena: "nejasno",
        besedilo: `Kosovnica ima ${f(q)} ${e} na izdelek - enako kot najbolj podoben izdelek ${dvojcek.sifra} (${dvojcek.naziv}), ${opisVecine}. Verjetno je izvedba drugačna; preveri ročno.${mesta}`,
      };
    if (q > vecina.kolicina)
      return {
        ...k,
        ocena: "vzrok",
        besedilo: `Kosovnica za ident ${i.koda} je verjetno napačna: ima ${f(q)} ${e} na izdelek, ${opisVecine}. Pri ${f(i.razpisano)} kos naloga je to ${f((q - vecina.kolicina) * i.razpisano)} ${e} preveč.${mesta}`,
      };
    return { ...k, ocena: "ok", besedilo: `Kosovnica ni vzrok viška: ima ${f(q)} ${e} na izdelek, manj kot podobni izdelki (${opisVecine}) - morda kos v kosovnici manjka.` };
  });
  const zIdentom = rez.filter((r) => r.pojavitve.length);
  const napacne = rez.filter((r) => r.ocena === "vzrok");
  if (napacne.length)
    return { ocena: "vzrok", povzetek: `Kosovnica za ident ${napacne.map((r) => r.koda).join(", ")} je verjetno napačna.`, izdelki: rez };
  if (!rez.some((r) => r.naIzdelek !== null))
    return { ocena: "ni_podatkov", povzetek: "Za izdelke izbranih nalogov ni uvoženih kosovnic.", izdelki: rez };
  if (!zIdentom.length) {
    const brez = rez.filter((r) => r.naIzdelek === null).map((r) => r.koda);
    if (naDn.length)
      return {
        ocena: "nejasno",
        povzetek: `Ident ${postavka.ident} ni v trenutnih kosovnicah, je pa v materialu naloga ${naDn.join(", ")} - kosovnica je bila verjetno spremenjena po razpisu ali gre za nadomestni material (glej kontrolo 2).`,
        izdelki: rez,
      };
    if (brez.length)
      return { ocena: "ni_podatkov", povzetek: `Ident ${postavka.ident} ni v uvoženih kosovnicah; za izdelke ${brez.join(", ")} kosovnice ni, zato ocena ni mogoča.`, izdelki: rez };
    return {
      ocena: "vzrok",
      povzetek: `Ident ${postavka.ident} ni v nobeni kosovnici izbranih nalogov in ni v materialu nalogov - material verjetno ne pripada temu nalogu (pomešani nalogi ali napačna izdaja).`,
      izdelki: rez,
    };
  }
  const nejasne = zIdentom.filter((r) => r.ocena === "nejasno");
  if (nejasne.length)
    return { ocena: "nejasno", povzetek: `Kosovnice so verjetno pravilne, za ${nejasne.map((r) => r.koda).join(", ")} primerjava s podobnimi izdelki ni zanesljiva.`, izdelki: rez };
  return { ocena: "ok", povzetek: "Kosovnice so verjetno pravilne.", izdelki: rez };
}

// =====================================================================
// KONTROLA 2: IZDANI MATERIAL
// =====================================================================

export type K2Nalog = {
  st_naloga: string;
  koda: string | null;
  naziv: string | null;
  razpisano: number;
  zakljucen: boolean;
  /** Potreba po trenutni kosovnici za ta nalog (razpisano × kos; brez sestavov z lastnim nalogom). null = ni kosovnice. */
  poKosovnici: number | null;
  /** Planirano na DN v ERP; null = nalog nima plana materiala. */
  planirano: number | null;
  /** Izdano na nalog; null = izvoz nima podatka. */
  izdano: number | null;
  osnova: "plan" | "kosovnica" | null;
  /** izdano − osnova (pozitivno = izdano preveč). */
  razlika: number | null;
  opombe: string[];
};

export type Kontrola2 = { ocena: Ocena; povzetek: string; nalogi: K2Nalog[]; prevec: number; brezPodatkov: string[] };

export function kontrola2(
  nalogi: { nalog: VisNalog; drevo: Vozlisce | null }[],
  izdaje: VisIzdaja[],
  sorodni: Set<string>,
  postavka: PostavkaViska,
): Kontrola2 {
  const poNalogu = new Map<string, VisIzdaja[]>();
  for (const r of izdaje) poNalogu.set(r.st_naloga, [...(poNalogu.get(r.st_naloga) ?? []), r]);
  const brezPodatkov: string[] = [];
  const rez: K2Nalog[] = [];
  for (const { nalog, drevo } of nalogi) {
    const vrstice = poNalogu.get(nalog.st_naloga) ?? [];
    const r = vrstice.find((x) => x.ident === postavka.ident);
    const razpisano = nalog.razpisana_kolicina ?? vrstice[0]?.razpisana_kolicina ?? 0;
    if (!vrstice.length) brezPodatkov.push(nalog.st_naloga);
    // Na ta nalog gre samo material, ki ni v sestavu z lastnim nalogom v istem krovnem
    const drugi = new Set([...sorodni].filter((s) => s !== nalog.koda_artikla));
    const poj = drevo ? pojavitve(drevo, postavka.ident, drugi).filter((p) => !p.drugNalog) : [];
    const poKosovnici = drevo ? vsota(poj) * razpisano : null;
    const imaPlan = vrstice.some((x) => (x.planirano ?? 0) > EPS);
    const planirano = r ? (r.planirano ?? 0) : vrstice.length ? 0 : null;
    const imaIzdano = vrstice.some((x) => x.porabljeno !== null);
    const izdano = r?.porabljeno ?? (imaIzdano ? 0 : null);
    if (!r && !(poKosovnici && poKosovnici > EPS)) continue; // ident na tem nalogu ni ne planiran ne izdan
    // Osnova po vrstici: plan, kadar ga vrstica ima; plan 0 je v ERP pogost (tudi ob pravilni izdaji) - takrat kosovnica
    const osnova = (planirano ?? 0) > EPS ? "plan" : poKosovnici !== null ? "kosovnica" : r ? "plan" : null;
    const pricakovano = osnova === "plan" ? (planirano ?? 0) : osnova === "kosovnica" ? poKosovnici : null;
    const razlika = izdano !== null && pricakovano !== null ? izdano - pricakovano : null;
    const opombe: string[] = [];
    if (vrstice.length && !imaPlan) opombe.push("Nalog nima plana materiala v ERP - primerjava s kosovnico.");
    else if (r && (planirano ?? 0) < EPS && osnova === "kosovnica") opombe.push("Vrstica nima plana na DN - primerjava s kosovnico.");
    if (!r && vrstice.length && poKosovnici)
      opombe.push("Ident je v kosovnici, a ni v materialu DN - verjetno se ne izdaja po nalogu (npr. pločevina iz lastne proizvodnje, drobni material).");
    if (r && (planirano ?? 0) > EPS && poKosovnici !== null && Math.abs((planirano ?? 0) - poKosovnici) > EPS)
      opombe.push(`Plan DN (${f(planirano ?? 0)}) se razlikuje od trenutne kosovnice (${f(poKosovnici)}) - kosovnica je bila verjetno spremenjena po razpisu naloga.`);
    if (izdano === null && vrstice.length) opombe.push("Izvoz nima podatka o izdani količini.");
    if ((izdano ?? 0) > EPS && (pricakovano ?? 0) < EPS)
      opombe.push("Izdano, čeprav ident ni ne v planu ne v kosovnici naloga - dodatna izdaja ali nadomestni material za drug ident.");
    rez.push({
      st_naloga: nalog.st_naloga,
      koda: nalog.koda_artikla ?? r?.koda_artikla ?? null,
      naziv: nalog.naziv_artikla ?? r?.naziv_artikla ?? null,
      razpisano,
      zakljucen: nalog.zakljucen,
      poKosovnici,
      planirano,
      izdano,
      osnova,
      razlika,
      opombe,
    });
  }
  const prevec = rez.reduce((s, n) => s + Math.max(0, n.razlika ?? 0), 0);
  const premalo = rez.reduce((s, n) => s + Math.min(0, n.razlika ?? 0), 0);
  const v = postavka.kolicina;
  const e = enota(postavka);
  if (!rez.some((n) => n.izdano !== null)) {
    const brez = brezPodatkov.length ? ` Brez podatka: ${brezPodatkov.join(", ")}.` : "";
    return { ocena: "ni_podatkov", povzetek: `Za izbrane naloge ni podatka o izdanem materialu za ta ident.${brez}`, nalogi: rez, prevec, brezPodatkov };
  }
  const nalogiPrevec = rez.filter((n) => (n.razlika ?? 0) > EPS).map((n) => n.st_naloga);
  if (prevec >= v - EPS)
    return { ocena: "vzrok", povzetek: `Na nalog ${nalogiPrevec.join(", ")} je bilo izdano ${f(prevec)} ${e} več, kot je bilo potrebno - to pojasni višek ${f(v)} ${e}.`, nalogi: rez, prevec, brezPodatkov };
  if (prevec > EPS)
    return { ocena: "vzrok", povzetek: `Na nalog ${nalogiPrevec.join(", ")} je bilo izdano ${f(prevec)} ${e} več, kot je bilo potrebno - to pojasni del viška (${f(prevec)} od ${f(v)} ${e}).`, nalogi: rez, prevec, brezPodatkov };
  if (premalo < -EPS)
    return { ocena: "ok", povzetek: `Izdano je ${f(-premalo)} ${e} MANJ, kot je potrebno - višek ni nastal pri izdaji na te naloge (material je verjetno z drugega naloga ali iz zaloge).`, nalogi: rez, prevec, brezPodatkov };
  return { ocena: "ok", povzetek: "Izdane količine se ujemajo s planom in kosovnico - višek ni nastal pri izdaji.", nalogi: rez, prevec, brezPodatkov };
}

// =====================================================================
// KONTROLA 3: PREVZEM IZ PROIZVODNJE
// =====================================================================

export type K3Nalog = {
  st_naloga: string;
  koda: string | null;
  naziv: string | null;
  razpisano: number;
  zakljucen: boolean;
  /** Prevzeto na zalogo; null = nalog nima podatka v izvozu prevzemov. */
  prevzeto: number | null;
  neizdelano: number | null;
  /** Kos identa na en izdelek naloga (plan DN ali kosovnica). */
  naKos: number | null;
  /** Material identa za neizdelane kose. */
  ostanek: number | null;
  zadnjiPrevzem: string | null;
};

export type Kontrola3 = { ocena: Ocena; povzetek: string; nalogi: K3Nalog[]; ostanek: number };

/**
 * Prevzetih manj kosov, kot je razpisanih (npr. 9 od 10 - ena peč ni bila narejena): material za neizdelane
 * kose ostane. Sešteje se z razliko izdaje (kontrola 2): ostanek = izdano − prevzeto × kos na izdelek.
 * Zaključen nalog brez prevzema v izvozu = ni podatka (izven obdobja izvoza); aktiven = 0 prevzetih.
 */
export function kontrolaPrevzema(k2: Kontrola2, prevzemi: PrevzemNaloga[], imaPodatke: boolean, postavka: PostavkaViska): Kontrola3 {
  const e = enota(postavka);
  const rez: K3Nalog[] = k2.nalogi.map((n) => {
    const p = prevzemi.filter((x) => x.st_naloga === n.st_naloga && (!n.koda || x.ident === n.koda));
    const prevzeto = p.length ? p.reduce((s, x) => s + x.kolicina, 0) : imaPodatke && !n.zakljucen ? 0 : null;
    const osnova = n.osnova === "plan" ? n.planirano : n.osnova === "kosovnica" ? n.poKosovnici : null;
    const naKos = osnova !== null && n.razpisano > EPS ? osnova / n.razpisano : null;
    const neizdelano = prevzeto === null ? null : Math.max(0, n.razpisano - prevzeto);
    const ostanek = neizdelano !== null && naKos !== null ? neizdelano * naKos : null;
    const zadnji = p.map((x) => x.zadnji_datum).filter((d): d is string => !!d).sort().at(-1) ?? null;
    return { st_naloga: n.st_naloga, koda: n.koda, naziv: n.naziv, razpisano: n.razpisano, zakljucen: n.zakljucen, prevzeto, neizdelano, naKos, ostanek, zadnjiPrevzem: zadnji };
  });
  const ostanek = rez.reduce((s, n) => s + (n.ostanek ?? 0), 0);
  const v = postavka.kolicina;
  if (!imaPodatke) return { ocena: "ni_podatkov", povzetek: "Prevzem iz proizvodnje ni uvožen - kontrola ni mogoča.", nalogi: rez, ostanek };
  if (!rez.some((n) => n.prevzeto !== null))
    return { ocena: "ni_podatkov", povzetek: "Za izbrane naloge ni prevzema v izvozu (nalog je izven obdobja izvoza).", nalogi: rez, ostanek };
  const delni = rez.filter((n) => (n.ostanek ?? 0) > EPS);
  if (!delni.length) return { ocena: "ok", povzetek: "Vsi razpisani kosi so prevzeti - prevzem ni vzrok viška.", nalogi: rez, ostanek };
  const opis = delni.map((n) => `${n.st_naloga}: prevzetih ${f(n.prevzeto ?? 0)} od ${f(n.razpisano)} kos${n.zakljucen ? "" : " (nalog še aktiven)"}`).join("; ");
  const aktivni = delni.some((n) => !n.zakljucen) ? " Pri aktivnem nalogu je to lahko material za še neizdelane kose." : "";
  return {
    ocena: "vzrok",
    povzetek: `${opis} - material za neizdelane kose je ${f(ostanek)} ${e}${ostanek >= v - EPS ? `, kar pojasni višek ${f(v)} ${e}` : `, kar pojasni del viška (${f(ostanek)} od ${f(v)} ${e})`}.${aktivni}`,
    nalogi: rez,
    ostanek,
  };
}

// =====================================================================
// KONTROLA 4: ZALOGA + PREDLOG
// =====================================================================

export type Kontrola4 = { ocena: Ocena; povzetek: string; zaloga: ZalogaIdenta | null; potrebujejo: VisIzdaja[] };

export function kontrolaZaloge(zaloga: ZalogaIdenta | null, potrebujejo: VisIzdaja[], k1: Kontrola1, k2: Kontrola2, k3: Kontrola3, postavka: PostavkaViska): Kontrola4 {
  const pojasnjeno = k1.ocena === "vzrok" || k2.prevec + k3.ostanek >= postavka.kolicina - EPS;
  const em = zaloga?.em ?? postavka.em ?? "kos";
  if (!zaloga) return { ocena: "ni_podatkov", povzetek: "Ident ni v zadnjem uvozu materiala (zaloge).", zaloga, potrebujejo };
  if (pojasnjeno)
    return { ocena: "ok", povzetek: `Kontrola zaloge ni nujna (vzrok je verjetno že najden). Matična zaloga v sistemu: ${f(zaloga.zaloga)} ${em}.`, zaloga, potrebujejo };
  return {
    ocena: "kontrola",
    povzetek: `Kosovnica, izdaja in prevzem višku ne dajejo (celotnega) razloga - kontrola zaloge. Matična zaloga v sistemu: ${f(zaloga.zaloga)} ${em}. Skladiščnik naj prešteje ident na lokaciji in primerja s stanjem v sistemu.`,
    zaloga,
    potrebujejo,
  };
}

export type Predlog = { ocena: Ocena; naslov: string; koraki: string[] };

/** Kaj narediti z viškom - iz rezultatov štirih kontrol. Izdaja in prevzem se seštejeta (oba sta lahko vzrok). */
export function predlog(p: PostavkaViska, k1: Kontrola1, k2: Kontrola2, k3: Kontrola3, k4: Kontrola4): Predlog {
  const koraki: string[] = [];
  const vzroki: string[] = [];
  const e = enota(p);
  const napacne = k1.izdelki.filter((i) => i.ocena === "vzrok");
  const nalogiPrevec = k2.nalogi.filter((n) => (n.razlika ?? 0) > EPS);
  const nalogiDelni = k3.nalogi.filter((n) => (n.ostanek ?? 0) > EPS);
  if (napacne.length) {
    vzroki.push("napačna kosovnica");
    koraki.push(`Tehnologiji sporoči preverbo kosovnice ${napacne.map((i) => i.koda).join(", ")} (ident ${p.ident}).`);
    koraki.push(`Višek vrni na zalogo s povratnico na nalog ${[...new Set(napacne.flatMap((i) => i.nalogi))].join(", ")}.`);
  } else if (k1.ocena === "vzrok") {
    vzroki.push("material ne pripada temu nalogu");
    koraki.push("Preveri, ali je bil material pomotoma pripravljen za drug nalog (pomešani nalogi).");
    koraki.push(k4.potrebujejo.length ? "Material prenesi na nalog, ki ga potrebuje (spodaj), ali ga vrni na zalogo." : "Material vrni na zalogo.");
  } else {
    if (nalogiPrevec.length) {
      vzroki.push("izdano več, kot je potrebno");
      koraki.push(`Izdano preveč (${f(k2.prevec)} ${e}): vrni na zalogo s povratnico na nalog ${nalogiPrevec.map((n) => n.st_naloga).join(", ")}.`);
    }
    if (nalogiDelni.length) {
      vzroki.push("prevzetih manj kosov, kot je razpisanih");
      const zaklj = nalogiDelni.filter((n) => n.zakljucen);
      const akt = nalogiDelni.filter((n) => !n.zakljucen);
      if (zaklj.length)
        koraki.push(`Material za neizdelane kose (${f(zaklj.reduce((s, n) => s + (n.ostanek ?? 0), 0))} ${e}) vrni na zalogo s povratnico na nalog ${zaklj.map((n) => n.st_naloga).join(", ")}.`);
      if (akt.length)
        koraki.push(`Nalog ${akt.map((n) => n.st_naloga).join(", ")} še ni zaključen - preveri, ali bodo manjkajoči kosi še narejeni (material počaka) ali se nalog zapre z manjšo količino.`);
    }
    const pojasni = k2.prevec + k3.ostanek;
    if (vzroki.length && pojasni < p.kolicina - EPS) koraki.push(`Izdaja in prevzem pojasnita ${f(pojasni)} od ${f(p.kolicina)} ${e} - za ostanek kontrola zaloge.`);
    if (!vzroki.length) {
      koraki.push(k4.zaloga ? `Skladiščnik prešteje ident ${p.ident} (v sistemu ${f(k4.zaloga.zaloga)} ${(k4.zaloga.em ?? e).toLowerCase()}).` : `Skladiščnik prešteje ident ${p.ident}.`);
      koraki.push("Če se stanje ne ujema, uskladi zalogo (inventurna razlika); višek vrni na zalogo.");
    }
  }
  if (k4.potrebujejo.length)
    koraki.push(`Ident trenutno potrebujejo nalogi: ${k4.potrebujejo.slice(0, 5).map((n) => `${n.st_naloga} (${f(n.za_izdajo ?? 0)} ${(n.em ?? p.em ?? "kos").toLowerCase()})`).join(", ")}${k4.potrebujejo.length > 5 ? " ..." : ""} - material lahko gre neposredno tja.`);
  return { ocena: vzroki.length ? "vzrok" : "kontrola", naslov: vzroki.length ? `Verjetni vzrok: ${vzroki.join(" + ")}` : "Vzrok ni najden - kontrola zaloge", koraki };
}

// =====================================================================
// BRANJE IZ BAZE
// =====================================================================

const niMigracije = (m: string) => /fp_vis_|does not exist|schema cache|PGRST202/i.test(m);
const NAPAKA_MIGRACIJE = "Zaženi migracijo 042_visek_materiala.sql - do takrat so na voljo samo aktivni nalogi.";

/** Nalogi za izbiro (tudi zaključeni). Brez migracije 042: samo nalogi zadnjega uvoza + opozorilo. */
export async function naloziNalogeVisek(): Promise<{ nalogi: VisNalog[]; opozorilo: string | null }> {
  const sb = getSupabase();
  try {
    const vrstice = await fetchAll<VisNalog>((od, doV) => sb.rpc("fp_vis_nalogi").range(od, doV));
    return {
      nalogi: vrstice.map((n) => ({
        ...n,
        razpisana_kolicina: n.razpisana_kolicina === null ? null : Number(n.razpisana_kolicina),
        izdelana_kolicina: n.izdelana_kolicina === null ? null : Number(n.izdelana_kolicina),
      })),
      opozorilo: null,
    };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (!niMigracije(m)) throw e;
    const { naloziZadnjiUvoz } = await import("./zasedenost");
    const { nalogi } = await naloziZadnjiUvoz();
    return {
      nalogi: nalogi.map((n) => ({
        st_naloga: n.st_naloga,
        krovni_dn: n.krovni_dn,
        koda_artikla: n.koda_artikla,
        naziv_artikla: n.naziv_artikla,
        razpisana_kolicina: n.razpisana_kolicina,
        izdelana_kolicina: n.izdelana_kolicina,
        status: n.status,
        rok_izdelave: n.rok_izdelave,
        zakljucen: false,
      })),
      opozorilo: NAPAKA_MIGRACIJE,
    };
  }
}

const POLJA_IZDAJE = "st_naloga, koda_artikla, naziv_artikla, razpisana_kolicina, ident, naziv, em, porabljeno, planirano, za_izdajo, rok_izdelave";
const stNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const vIzdajo = (r: VisIzdaja): VisIzdaja => ({
  ...r,
  razpisana_kolicina: Number(r.razpisana_kolicina ?? 0),
  porabljeno: stNull(r.porabljeno),
  planirano: stNull(r.planirano),
  za_izdajo: stNull(r.za_izdajo),
});

async function aktivniUvozIzdaj(): Promise<{ id: number; created_at: string } | null> {
  const { data, error } = await getSupabase()
    .from("fp_doi_izdaje_uvozi")
    .select("id, created_at")
    .eq("aktiven", true)
    .eq("visible", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Material nalogov: aktivni iz zadnjega uvoza izdaj, zaključeni iz fp_vis_izdaje.
 * Nalog, ki je v obeh (ponovno odprt), se vzame iz zadnjega uvoza.
 * Opomba: v zadnjem uvozu je porabljeno brez podatka shranjeno kot 0.
 */
export async function naloziIzdajeNalogov(stevilke: string[]): Promise<{ izdaje: VisIzdaja[]; opozorilo: string | null }> {
  const sb = getSupabase();
  const uvoz = await aktivniUvozIzdaj();
  const aktivne: VisIzdaja[] = [];
  const zakljucene: VisIzdaja[] = [];
  let opozorilo: string | null = null;
  for (const kos of kosi(stevilke, 100)) {
    if (uvoz)
      aktivne.push(
        ...(await fetchAll<VisIzdaja>((od, doV) =>
          sb.from("fp_doi_izdaje").select(POLJA_IZDAJE).eq("uvoz_id", uvoz.id).eq("visible", true).in("st_naloga", kos).order("id").range(od, doV),
        )),
      );
    if (!opozorilo)
      try {
        zakljucene.push(
          ...(await fetchAll<VisIzdaja>((od, doV) =>
            sb.from("fp_vis_izdaje").select(POLJA_IZDAJE).eq("visible", true).in("st_naloga", kos).order("id").range(od, doV),
          )),
        );
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        if (!niMigracije(m)) throw e;
        opozorilo = "Izdaje zaključenih nalogov niso na voljo - zaženi migracijo 042_visek_materiala.sql in ponovno uvozi Izdaje v proizvodnjo.";
      }
  }
  const vAktivnih = new Set(aktivne.map((r) => r.st_naloga));
  return { izdaje: [...aktivne, ...zakljucene.filter((r) => !vAktivnih.has(r.st_naloga))].map(vIzdajo), opozorilo };
}

/** Aktivni nalogi, ki ident še potrebujejo (za izdajo > 0) - kam z viškom. */
export async function naloziPotrebeIdenta(ident: string): Promise<VisIzdaja[]> {
  const uvoz = await aktivniUvozIzdaj();
  if (!uvoz) return [];
  const { data, error } = await getSupabase()
    .from("fp_doi_izdaje")
    .select(POLJA_IZDAJE)
    .eq("uvoz_id", uvoz.id)
    .eq("visible", true)
    .eq("ident", ident)
    .gt("za_izdajo", 0)
    .order("rok_izdelave", { ascending: true, nullsFirst: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return ((data ?? []) as VisIzdaja[]).map(vIzdajo);
}

async function aktivniUvozKosovnic(): Promise<number | null> {
  const { data, error } = await getSupabase().from("spl_kosovnice_uvozi").select("id").eq("aktiven", true).eq("visible", true).maybeSingle();
  if (error) throw new Error(`Kosovnice niso pripravljene (skripta 027): ${error.message}`);
  return data?.id ?? null;
}

let koreniCache: { uvoz: number; koreni: KorenKosovnice[] } | null = null;

/** Vsi izdelki s kosovnico (nivo 1) - za iskanje podobnih izdelkov. */
export async function naloziKoreneKosovnic(): Promise<{ uvoz: number | null; koreni: KorenKosovnice[] }> {
  const uvoz = await aktivniUvozKosovnic();
  if (!uvoz) return { uvoz: null, koreni: [] };
  if (koreniCache?.uvoz === uvoz) return koreniCache;
  const sb = getSupabase();
  const koreni = await fetchAll<KorenKosovnice>((od, doV) =>
    sb.from("spl_kosovnice").select("sifra, naziv, izdelek").eq("uvoz_id", uvoz).eq("nivo", 1).eq("visible", true).order("vrstica").range(od, doV),
  );
  koreniCache = { uvoz, koreni };
  return koreniCache;
}

/** Kosovnice več izdelkov naenkrat (šifra izdelka -> drevo). Izdelek s pokvarjeno hierarhijo izpade. */
export async function naloziDrevesa(uvoz: number, sifre: string[], koreni: KorenKosovnice[]): Promise<Map<string, Vozlisce>> {
  const sb = getSupabase();
  const izdelekSifre = new Map(koreni.map((k) => [k.sifra, k.izdelek]));
  const izdelki = [...new Set(sifre.map((s) => izdelekSifre.get(s)).filter((x): x is string => !!x))];
  const poIzdelku = new Map<string, KosovnicaVrstica[]>();
  for (const kos of kosi(izdelki, 20)) {
    const vrstice = await fetchAll<KosovnicaVrstica>((od, doV) =>
      sb
        .from("spl_kosovnice")
        .select("vrstica, izdelek, nivo, risp_sifra, sifra, naziv, klasifikat, vrsta, kolicina")
        .eq("uvoz_id", uvoz)
        .eq("visible", true)
        .in("izdelek", kos)
        .order("vrstica")
        .range(od, doV),
    );
    for (const v of vrstice) poIzdelku.set(v.izdelek, [...(poIzdelku.get(v.izdelek) ?? []), { ...v, kolicina: Number(v.kolicina) }]);
  }
  const out = new Map<string, Vozlisce>();
  for (const vrstice of poIzdelku.values()) {
    try {
      const d = zgradiDrevo(vrstice);
      out.set(d.sifra, d);
    } catch {
      /* pokvarjena kosovnica v izvozu - izdelek se prikaže kot "ni kosovnice" */
    }
  }
  return out;
}

/** Zaloga identa iz zadnjega uvoza materiala. */
export async function naloziZalogoIdenta(ident: string): Promise<{ zaloga: ZalogaIdenta | null; uvozeno: string | null }> {
  const sb = getSupabase();
  const { data: uvoz, error } = await sb
    .from("spl_material_uvozi")
    .select("id, created_at")
    .eq("aktiven", true)
    .eq("visible", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!uvoz) return { zaloga: null, uvozeno: null };
  const { data, error: e2 } = await sb
    .from("spl_material")
    .select("ident, naziv, em, zaloga, razpolozljiva, potreba_dn, prosta_zaloga, narocena_kolicina")
    .eq("ident", ident)
    .eq("uvoz_id", uvoz.id)
    .eq("visible", true)
    .maybeSingle();
  if (e2) throw new Error(e2.message);
  if (!data) return { zaloga: null, uvozeno: uvoz.created_at };
  const n = (k: keyof ZalogaIdenta) => Number((data as Record<string, unknown>)[k] ?? 0);
  return {
    zaloga: { ...(data as ZalogaIdenta), zaloga: n("zaloga"), razpolozljiva: n("razpolozljiva"), potreba_dn: n("potreba_dn"), prosta_zaloga: n("prosta_zaloga"), narocena_kolicina: n("narocena_kolicina") },
    uvozeno: uvoz.created_at,
  };
}

// =====================================================================
// CELOTNA ANALIZA
// =====================================================================

export type RezultatPostavke = {
  postavka: PostavkaViska;
  k1: Kontrola1;
  k2: Kontrola2;
  k3: Kontrola3;
  k4: Kontrola4;
  predlog: Predlog;
};

export type Analiza = {
  nalogi: VisNalog[];
  rezultati: RezultatPostavke[];
  opozorila: string[];
  zalogaUvozena: string | null;
  /** Obdobje izvoza prevzemov iz proizvodnje. */
  prevzemObdobje: { od: string | null; do: string | null } | null;
};

/**
 * Izbor: krovni (vsi njegovi nalogi) ali en nalog. `vsiNalogi` je seznam za izbiro (fp_vis_nalogi).
 * Za en nalog so izdelki drugih nalogov istega krovnega vseeno upoštevani (material sestava z lastnim nalogom gre tja).
 */
export async function analizirajVisek(izbor: { krovni: string | null; nalog: string | null }, vsiNalogi: VisNalog[], postavke: PostavkaViska[]): Promise<Analiza> {
  const opozorila: string[] = [];
  const izNaloga = izbor.nalog ? vsiNalogi.find((n) => n.st_naloga === izbor.nalog) : null;
  const krovni = izbor.krovni ?? izNaloga?.krovni_dn ?? null;
  const vKrovnem = krovni ? vsiNalogi.filter((n) => n.krovni_dn === krovni || n.st_naloga === krovni) : [];
  const nalogi: VisNalog[] = (
    izbor.nalog
      ? [izNaloga ?? { st_naloga: izbor.nalog, krovni_dn: null, koda_artikla: null, naziv_artikla: null, razpisana_kolicina: null, izdelana_kolicina: null, status: null, rok_izdelave: null, zakljucen: true }]
      : vKrovnem
  ).map((n) => ({ ...n }));
  if (!nalogi.length) throw new Error("Za izbrani krovni ni najdenih nalogov.");
  const [{ izdaje, opozorilo }, prev] = await Promise.all([
    naloziIzdajeNalogov(nalogi.map((n) => n.st_naloga)),
    naloziPrevzemeNalogov(nalogi.map((n) => n.st_naloga)),
  ]);
  if (opozorilo) opozorila.push(opozorilo);
  if (prev.opozorilo) opozorila.push(prev.opozorilo);
  // Nalog brez podatkov o izdelku (samo v izdajah) dobi izdelek iz izdaj
  for (const n of nalogi) {
    const r = izdaje.find((x) => x.st_naloga === n.st_naloga);
    if (r) {
      n.koda_artikla ??= r.koda_artikla;
      n.naziv_artikla ??= r.naziv_artikla;
      n.razpisana_kolicina ??= r.razpisana_kolicina;
    }
  }
  const sorodni = new Set([...nalogi, ...vKrovnem].map((n) => n.koda_artikla).filter((x): x is string => !!x));

  const { uvoz, koreni } = await naloziKoreneKosovnic();
  if (!uvoz) opozorila.push("Kosovnice še niso uvožene - kontrola kosovnic ni mogoča.");
  const kode = [...new Set(nalogi.map((n) => n.koda_artikla).filter((x): x is string => !!x))];
  // Kontrolni izdelki za vsak izdelek; kosovnice izdelkov in kontrolnih se naložijo naenkrat
  const kontrolni = new Map(kode.map((k) => [k, kontrolniIzdelki(k, koreni.find((x) => x.sifra === k)?.naziv ?? nalogi.find((n) => n.koda_artikla === k)?.naziv_artikla ?? k, koreni)]));
  const drevesa = uvoz ? await naloziDrevesa(uvoz, [...kode, ...[...kontrolni.values()].flat().map((k) => k.sifra)], koreni) : new Map<string, Vozlisce>();

  let zalogaUvozena: string | null = null;
  const rezultati: RezultatPostavke[] = [];
  for (const p of postavke) {
    const izdelki = kode.map((koda) => {
      const nn = nalogi.filter((n) => n.koda_artikla === koda);
      return {
        koda,
        naziv: nn[0]?.naziv_artikla ?? koda,
        nalogi: nn.map((n) => n.st_naloga),
        razpisano: nn.reduce((s, n) => s + (n.razpisana_kolicina ?? 0), 0),
        drevo: drevesa.get(koda) ?? null,
        kontrolni: (kontrolni.get(koda) ?? []).map((k) => {
          const d = drevesa.get(k.sifra);
          return { ...k, rezultat: d ? kolicinaVKontrolnem(d, p.ident, p.naziv) : null };
        }),
      };
    });
    const naDn = [...new Set(izdaje.filter((x) => x.ident === p.ident).map((x) => x.st_naloga))];
    const k1 = kontrola1(izdelki, p, naDn);
    const k2 = kontrola2(
      nalogi.map((n) => ({ nalog: n, drevo: n.koda_artikla ? (drevesa.get(n.koda_artikla) ?? null) : null })),
      izdaje,
      sorodni,
      p,
    );
    const [{ zaloga, uvozeno }, potrebujejo] = await Promise.all([naloziZalogoIdenta(p.ident), naloziPotrebeIdenta(p.ident)]);
    zalogaUvozena = uvozeno;
    const izbrani = new Set(nalogi.map((n) => n.st_naloga));
    const k3 = kontrolaPrevzema(k2, prev.prevzemi, !!prev.obdobje, p);
    const k4 = kontrolaZaloge(zaloga, potrebujejo.filter((x) => !izbrani.has(x.st_naloga)), k1, k2, k3, p);
    rezultati.push({ postavka: p, k1, k2, k3, k4, predlog: predlog(p, k1, k2, k3, k4) });
  }
  return { nalogi, rezultati, opozorila, zalogaUvozena, prevzemObdobje: prev.obdobje };
}
