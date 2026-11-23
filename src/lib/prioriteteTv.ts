// FIN:TV "Prioritete krovnih" (FinOS 031, vsak oddelek svoja komponenta): krovni nalogi, ki so v delovnem planu oddelka
// v TEKOČEM in NASLEDNJEM tednu (razpored po kapaciteti kot Delovni plan / workflow na TV), in za vsakega vse odpreme po
// nalogih: datum odpreme, ident, naziv, delovni nalog, količina, kupec in lokacija - delavec v montaži iz 25 kos ODC najde
// prave kose. Enak izračun kot stran Prioritete s privzetimi nastavitvami (potrjena naročila in naročila v odpremi, samo
// izdelki, zamik iz nastavitev strani) - iskanje "2351" na strani Prioritete pokaže iste odpreme.
// Oblika podatkov = PrioriteteOddelkaTv v FinOS tvScene.ts (ob spremembi uskladi oba).
import { addDays, mondayOf, toIso, type IsoDate } from "./dates";
import { druzineNalogov } from "./deloVceraj";
import { glavnaDruzina, type OddelekKoda } from "./normativi";
import { krovniKljuc } from "./plan";
import { naloziMaterial, type Material } from "./material";
import {
  izracunajPrioritete,
  kratkoIme,
  naloziZadnjiOdpUvoz,
  naloziZadnjiPriUvoz,
  preberiNastavitvePrioritet,
  type NalogPrioriteta,
} from "./prioritete";
import { izracunajPlanOddelka } from "./tvPlan";
import { naloziZadnjiUvoz, type Nalog } from "./zasedenost";

/** Ena vrstica = en delovni nalog za eno naročilo na en dan odpreme. */
export type OdpremaTv = {
  datum: IsoDate | null;
  ident: string;
  naziv: string | null;
  nalog: string;
  kos: number;
  kupec: string | null;
  lokacija: string | null;
  narocilo: string;
  /** rok izdelave naloga je po odpremi (status ZAMUJA na Prioritetah) */
  zamuja: boolean;
};
export type PrioritetaKrovnegaTv = {
  krovni: string;
  mesto: string;
  zacetek: IsoDate | null;
  druzine: { d: string; kos: number }[];
  kosov: number;
  naroceno: number;
  narocil: number;
  odpreme: OdpremaTv[];
};
export type PrioriteteOddelkaTv = { koda: OddelekKoda; naziv: string; danes: IsoDate; od: IsoDate; do: IsoDate; krovni: PrioritetaKrovnegaTv[] };

/** Tednov plana na TV (tekoči + naslednji, kot workflow plana). */
export const TEDNOV_PRIORITET = 2;

const r2 = (x: number) => Math.round(x * 100) / 100;
const odprto = (n: Nalog) => n.razpisana_kolicina - n.izdelana_kolicina;

export async function pripraviPrioriteteTv(kode: OddelekKoda[]): Promise<PrioriteteOddelkaTv[]> {
  const danes = toIso(new Date());
  const od = mondayOf(danes);
  const doo = addDays(od, TEDNOV_PRIORITET * 7 - 1);
  const [nal, pri, odp, mat] = await Promise.all([
    naloziZadnjiUvoz(),
    naloziZadnjiPriUvoz(),
    naloziZadnjiOdpUvoz().catch(() => ({ odpreme: [] })),
    naloziMaterial().catch(() => ({ material: new Map<string, Material>() })),
  ]);
  if (!pri.uvoz) throw new Error("Ni uvoza naročil (VD200) - prioritet ni mogoče izračunati.");

  // isti izračun kot stran Prioritete (privzete nastavitve strani)
  const { zamikDni } = preberiNastavitvePrioritet();
  const rez = izracunajPrioritete(pri.postavke, nal.nalogi, { danes, zamikDni, vkljuciNepotrjena: false, samoIzdelki: true }, odp.odpreme, mat.material);
  const lokacijaPostavke = new Map(pri.postavke.map((p) => [p.kljuc, p.lokacija]));
  const odprtiPoKrovnem = new Map<string, Nalog[]>();
  for (const n of nal.nalogi) if (odprto(n) > 0) odprtiPoKrovnem.set(krovniKljuc(n), [...(odprtiPoKrovnem.get(krovniKljuc(n)) ?? []), n]);
  const prioPoKrovnem = new Map<string, NalogPrioriteta[]>();
  for (const n of rez.nalogi) prioPoKrovnem.set(krovniKljuc(n), [...(prioPoKrovnem.get(krovniKljuc(n)) ?? []), n]);

  const izid: PrioriteteOddelkaTv[] = [];
  for (const koda of kode) {
    const plan = await izracunajPlanOddelka(koda);
    const druzinaIdenta = new Map(plan.normativi.filter((n) => n.druzina).map((n) => [n.ident, glavnaDruzina(n.druzina)]));
    const imeCelice = new Map(plan.celice.map((c) => [c.id, c.naziv]));

    // krovni, ki jih razpored plana postavi v tekoči ali naslednji teden: prva postavitev v obdobju (celica, začetek)
    // in nalogi, ki jih zajamejo postavitve (null = vsi)
    const vPlanu = new Map<string, { zacetek: IsoDate; mesto: string; nalogi: Set<string> | null }>();
    for (const p of plan.efektivne) {
      const r = plan.razpored.get(p.id);
      if (p.prosta || !r?.od || !r.do || r.do < od || r.od > doo) continue;
      const x = vPlanu.get(p.krovni_dn);
      const nalogi = !p.nalogi || (x && !x.nalogi) ? null : new Set([...(x?.nalogi ?? []), ...p.nalogi]);
      if (!x || r.od < x.zacetek) vPlanu.set(p.krovni_dn, { zacetek: r.od, mesto: imeCelice.get(p.delovno_mesto_id) ?? "", nalogi });
      else x.nalogi = nalogi;
    }

    const krovni: PrioritetaKrovnegaTv[] = [];
    for (const [k, x] of vPlanu) {
      const zajet = (st: string) => !x.nalogi || x.nalogi.has(st);
      const odprti = (odprtiPoKrovnem.get(k) ?? []).filter((n) => zajet(n.st_naloga));
      const kosov = odprti.reduce((s, n) => s + odprto(n), 0);
      if (kosov <= 0) continue; // krovni je narejen

      // odpreme po nalogih: isti nalog za isto naročilo na isti dan sešteto
      const vrstice = new Map<string, OdpremaTv>();
      const narocila = new Set<string>();
      let naroceno = 0;
      for (const n of (prioPoKrovnem.get(k) ?? []).filter((n) => zajet(n.st_naloga))) {
        for (const d of n.dodelitve) {
          const kljuc = `${n.st_naloga}|${d.stevilka}|${d.datum ?? ""}`;
          const y = vrstice.get(kljuc) ?? {
            datum: d.datum,
            ident: n.ident,
            naziv: n.opis,
            nalog: n.st_naloga,
            kos: 0,
            kupec: kratkoIme(d.partner) || null,
            lokacija: lokacijaPostavke.get(d.kljuc) ?? null,
            narocilo: d.stevilka,
            zamuja: false,
          };
          y.kos += d.kolicina;
          // kot status ZAMUJA na Prioritetah: rok izdelave naloga je po odpremi (- zamik)
          if (n.rok && d.datum && addDays(d.datum, -zamikDni) < n.rok) y.zamuja = true;
          vrstice.set(kljuc, y);
          narocila.add(d.stevilka);
          naroceno += d.kolicina;
        }
      }

      krovni.push({
        krovni: k,
        mesto: x.mesto,
        zacetek: x.zacetek,
        druzine: druzineNalogov(odprti.map((n) => ({ druzina: druzinaIdenta.get(n.koda_artikla), kos: odprto(n) }))),
        kosov: r2(Math.max(kosov, naroceno)),
        naroceno: r2(naroceno),
        narocil: narocila.size,
        odpreme: [...vrstice.values()]
          .map((y) => ({ ...y, kos: r2(y.kos) }))
          .sort((a, b) => (a.datum ?? "9999").localeCompare(b.datum ?? "9999") || a.nalog.localeCompare(b.nalog) || a.narocilo.localeCompare(b.narocilo)),
      });
    }
    izid.push({ koda, naziv: plan.oddelek.naziv, danes, od, do: doo, krovni });
  }
  return izid;
}
