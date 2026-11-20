// Nalaganje podatkov za Pripravljenost materiala (stran in FIN:TV) in krovni po oddelkih delovnega plana.
import { formatDatumUra, todayWorkday, type IsoDate } from "./dates";
import { naloziDobave, type Dobava } from "./dobave";
import { naloziIzdaje, privzeteIzlocene, type IzdajaVrstica } from "./doizdaja";
import { naloziMaterial, type Material } from "./material";
import { naloziVrstniRed, niTabeleVrstnegaReda, type RocniVrstniRed } from "./materialVrstniRed";
import { glavnaDruzina, naloziNormative, type Normativ, type OddelekKoda } from "./normativi";
import { naloziCelice, naloziPostavitve, type Celica, type Postavitev } from "./plan";
import { dodelitveNalogov, naloziZadnjiOdpUvoz, naloziZadnjiPriUvoz, type NalogDodelitev } from "./prioritete";
import { izracunajPripravljenost, skupineMateriala, type KrovniPripravljenost, type Pripravljenost } from "./pripravljenost";
import { naloziZadnjiUvoz, naloziZasOddelke, type Nalog, type ZasOddelek } from "./zasedenost";

/** Napaka, ko tabele dobav v bazi še niso ustvarjene (migracija 038). */
const niTabel = (m: string) => /fp_mat_dobave|does not exist|schema cache/i.test(m);

/** Vsi viri naenkrat; manjkajoč uvoz ne ustavi strani (izračun je takrat le delen). */
export async function naloziPodatkePripravljenosti() {
  const [izd, mat, nal, postavitve, oddelki, celice, normativi, pri, odp, vrstniRed] = await Promise.all([
    naloziIzdaje().catch(() => ({ uvoz: null, vrstice: [] as IzdajaVrstica[] })),
    naloziMaterial().catch(() => ({ uvoz: null, material: new Map<string, Material>() })),
    naloziZadnjiUvoz().catch(() => ({ uvoz: null, nalogi: [] as Nalog[] })),
    naloziPostavitve().catch(() => [] as Postavitev[]),
    naloziZasOddelke().catch(() => [] as ZasOddelek[]),
    naloziCelice(todayWorkday()).catch(() => [] as Celica[]),
    naloziNormative(true).catch(() => [] as Normativ[]),
    naloziZadnjiPriUvoz().catch(() => null),
    naloziZadnjiOdpUvoz().catch(() => ({ odpreme: [] })),
    // brez tabele (migracija 039) velja privzeti vrstni red; ostale napake se pokažejo
    naloziVrstniRed().then(
      (x) => ({ vrstniRed: x, niTabele: false }),
      (e: Error) => {
        if (!niTabeleVrstnegaReda(e.message)) throw e;
        return { vrstniRed: new Map<string, RocniVrstniRed>(), niTabele: true };
      },
    ),
  ]);
  // Naročila, ki jih pokrije posamezen nalog (kot na Prioritetah / v Zamudah dobav) - za vrstni red materiala
  const odpremeNalogov = pri?.uvoz
    ? dodelitveNalogov(pri.postavke, nal.nalogi, odp.odpreme, mat.material)
    : new Map<string, NalogDodelitev[]>();
  const dob = await naloziDobave().then(
    (x) => ({ ...x, niTabel: false }),
    (e: Error) => {
      if (!niTabel(e.message)) throw e;
      return { uvoz: null, dobave: [] as Dobava[], niTabel: true };
    },
  );
  return {
    izd,
    mat,
    nal,
    postavitve,
    oddelki,
    celice,
    dob,
    druzine: druzineIzdelkov(normativi),
    odpremeNalogov,
    /** Brez uvoza naročil (VD200) ni odprem po nalogih - vrstni red je takrat samo po planu in številki naloga. */
    brezOdprem: !pri?.uvoz,
    vrstniRed: vrstniRed.vrstniRed,
    niTabeleVrstnegaReda: vrstniRed.niTabele,
  };
}
export type PodatkiPripravljenosti = Awaited<ReturnType<typeof naloziPodatkePripravljenosti>>;

/** Ident izdelka -> glavna družina (OCB-e -> OCB). */
export const druzineIzdelkov = (normativi: Normativ[]) =>
  new Map(normativi.filter((n) => n.druzina).map((n) => [n.ident, glavnaDruzina(n.druzina)]));

/** Izračun s podatki (izločene skupine: null = privzete kot pri doizdaji). */
export function izracunaj(p: PodatkiPripravljenosti, izlocene: string[] | null, danes: IsoDate): Pripravljenost {
  const { skupine, klasifikati } = skupineMateriala(p.izd.vrstice);
  return izracunajPripravljenost({
    izdaje: p.izd.vrstice,
    nalogi: p.nal.nalogi,
    postavitve: p.postavitve,
    material: p.mat.material,
    dobave: p.dob.dobave,
    izlocene: new Set(izlocene ?? privzeteIzlocene(skupine, klasifikati)),
    druzine: p.druzine,
    odpremeNalogov: p.odpremeNalogov,
    vrstniRed: p.vrstniRed,
    danes,
  });
}

/** Kdaj so bili uvoženi viri izračuna (za PDF / TV). */
export function stanjePodatkov(p: PodatkiPripravljenosti) {
  const cas = (u: { created_at?: string } | null) => (u?.created_at ? formatDatumUra(u.created_at) : "ni uvoza");
  return `Stanje: izdaje ${cas(p.izd.uvoz as { created_at?: string } | null)} · zaloge ${cas(p.mat.uvoz)} · naročila ${cas(p.dob.uvoz)}`;
}

/** Krovni na listu PDF / TV: začetek in mesto v izbranem oddelku. */
export type KrovniNaListu = { k: KrovniPripravljenost; zacetek: IsoDate | null; mesto: string };

/**
 * Krovni iz delovnega plana oddelka (vsaj ena postavitev v oddelku), po začetku v oddelku.
 * Začetek in celica sta od najzgodnejše postavitve v tem oddelku.
 */
export function krovniOddelka(rez: Pripravljenost, p: PodatkiPripravljenosti, oddelekId: number): KrovniNaListu[] {
  const imeCelice = new Map(p.celice.map((c) => [c.id, c.naziv]));
  const prva = new Map<string, Postavitev>();
  for (const x of p.postavitve) {
    if (x.prosta || x.oddelek_id !== oddelekId) continue;
    const o = prva.get(x.krovni_dn);
    if (!o || x.datum_zacetka < o.datum_zacetka) prva.set(x.krovni_dn, x);
  }
  return rez.krovni
    .filter((k) => prva.has(k.krovni))
    .map((k) => {
      const x = prva.get(k.krovni)!;
      return { k, zacetek: x.datum_zacetka, mesto: imeCelice.get(x.delovno_mesto_id) ?? "" };
    })
    .sort((a, b) => (a.zacetek ?? "").localeCompare(b.zacetek ?? "") || a.k.krovni.localeCompare(b.k.krovni, "sl", { numeric: true }));
}

/** Za FIN:TV: krovni iz plana za vsak izbran oddelek (privzete izločene skupine, kot na strani brez sprememb). */
export async function pripraviPripravljenostTv(kode: OddelekKoda[]) {
  const p = await naloziPodatkePripravljenosti();
  const danes = todayWorkday();
  const rez = izracunaj(p, null, danes);
  const stanje = stanjePodatkov(p);
  return p.oddelki
    .filter((o) => kode.includes(o.koda))
    .map((o) => ({ koda: o.koda, naziv: o.naziv, danes, stanje, krovni: krovniOddelka(rez, p, o.id) }));
}
