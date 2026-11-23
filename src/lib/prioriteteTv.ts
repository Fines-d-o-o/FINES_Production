// FIN:TV "Prioritete krovnih" (FinOS 031, vsak oddelek svoja komponenta): za VSAK krovni nalog iz delovnega plana
// oddelka (z odprtimi kosi) vse odpreme, ki čakajo nanj. Enak izračun kot stran Prioritete s privzetimi nastavitvami
// (potrjena naročila in naročila v odpremi, samo izdelki, zamik iz nastavitev strani) - iskanje "2351" na strani
// Prioritete pokaže iste odpreme kot TV. Oblika podatkov = PrioriteteOddelkaTv v FinOS tvScene.ts (ob spremembi uskladi oba).
import { addDays, toIso, todayWorkday, type IsoDate } from "./dates";
import { druzineNalogov } from "./deloVceraj";
import { glavnaDruzina, naloziNormative, type OddelekKoda } from "./normativi";
import { krovniKljuc, naloziCelice, naloziPostavitve } from "./plan";
import { naloziMaterial, type Material } from "./material";
import {
  izracunajPrioritete,
  kratkoIme,
  naloziZadnjiOdpUvoz,
  naloziZadnjiPriUvoz,
  preberiNastavitvePrioritet,
  type NalogPrioriteta,
} from "./prioritete";
import { naloziZadnjiUvoz, naloziZasOddelke, type Nalog } from "./zasedenost";

export type OdpremaTv = { datum: IsoDate | null; kos: number; kupec: string | null; narocilo: string; druzina: string | null; zamuja: boolean };
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
export type PrioriteteOddelkaTv = { koda: OddelekKoda; naziv: string; danes: IsoDate; krovni: PrioritetaKrovnegaTv[] };

const r2 = (x: number) => Math.round(x * 100) / 100;
const odprto = (n: Nalog) => n.razpisana_kolicina - n.izdelana_kolicina;

/** Krovni iz plana vsakega izbranega oddelka z odpremami (po prvi odpremi uredi FIN:TV). */
export async function pripraviPrioriteteTv(kode: OddelekKoda[]): Promise<PrioriteteOddelkaTv[]> {
  const danes = toIso(new Date());
  const [oddelki, celice, postavitve, nal, normativi, pri, odp, mat] = await Promise.all([
    naloziZasOddelke(),
    naloziCelice(todayWorkday()),
    naloziPostavitve(),
    naloziZadnjiUvoz(),
    naloziNormative(true),
    naloziZadnjiPriUvoz(),
    naloziZadnjiOdpUvoz().catch(() => ({ odpreme: [] })),
    naloziMaterial().catch(() => ({ material: new Map<string, Material>() })),
  ]);
  if (!pri.uvoz) throw new Error("Ni uvoza naročil (VD200) - prioritet ni mogoče izračunati.");

  // isti izračun kot stran Prioritete (privzete nastavitve strani)
  const { zamikDni } = preberiNastavitvePrioritet();
  const rez = izracunajPrioritete(pri.postavke, nal.nalogi, { danes, zamikDni, vkljuciNepotrjena: false, samoIzdelki: true }, odp.odpreme, mat.material);

  const druzinaIdenta = new Map(normativi.filter((n) => n.druzina).map((n) => [n.ident, glavnaDruzina(n.druzina)]));
  const odprtiPoKrovnem = new Map<string, Nalog[]>();
  for (const n of nal.nalogi) if (odprto(n) > 0) odprtiPoKrovnem.set(krovniKljuc(n), [...(odprtiPoKrovnem.get(krovniKljuc(n)) ?? []), n]);
  const prioPoKrovnem = new Map<string, NalogPrioriteta[]>();
  for (const n of rez.nalogi) prioPoKrovnem.set(krovniKljuc(n), [...(prioPoKrovnem.get(krovniKljuc(n)) ?? []), n]);
  const imeCelice = new Map(celice.map((c) => [c.id, c.naziv]));

  return oddelki
    .filter((o) => kode.includes(o.koda))
    .map((o) => {
      // krovni v planu oddelka: najzgodnejša postavitev (celica, začetek) + nalogi, ki jih zajamejo postavitve (null = vsi)
      const vPlanu = new Map<string, { zacetek: IsoDate; mesto: string; nalogi: Set<string> | null }>();
      for (const p of postavitve) {
        if (p.prosta || p.oddelek_id !== o.id) continue;
        const x = vPlanu.get(p.krovni_dn);
        const nalogi = !p.nalogi || (x && !x.nalogi) ? null : new Set([...(x?.nalogi ?? []), ...p.nalogi]);
        if (!x || p.datum_zacetka < x.zacetek) vPlanu.set(p.krovni_dn, { zacetek: p.datum_zacetka, mesto: imeCelice.get(p.delovno_mesto_id) ?? "", nalogi });
        else x.nalogi = nalogi;
      }

      const krovni: PrioritetaKrovnegaTv[] = [];
      for (const [k, x] of vPlanu) {
        const zajet = (st: string) => !x.nalogi || x.nalogi.has(st);
        const odprti = (odprtiPoKrovnem.get(k) ?? []).filter((n) => zajet(n.st_naloga));
        const kosov = odprti.reduce((s, n) => s + odprto(n), 0);
        if (kosov <= 0) continue; // krovni je narejen (ni več odprtih kosov)

        // odpreme: dodelitve nalogov krovnega, isto naročilo na isti dan sešteto
        const odpreme = new Map<string, OdpremaTv & { druzine: Set<string> }>();
        const narocila = new Set<string>();
        let naroceno = 0;
        for (const n of (prioPoKrovnem.get(k) ?? []).filter((n) => zajet(n.st_naloga))) {
          const druzina = druzinaIdenta.get(n.ident) ?? null;
          for (const d of n.dodelitve) {
            const kljuc = `${d.stevilka}|${d.datum ?? ""}`;
            const y = odpreme.get(kljuc) ?? { datum: d.datum, kos: 0, kupec: kratkoIme(d.partner) || null, narocilo: d.stevilka, druzina: null, zamuja: false, druzine: new Set<string>() };
            y.kos += d.kolicina;
            if (druzina) y.druzine.add(druzina);
            // kot status ZAMUJA na Prioritetah: rok izdelave naloga je po odpremi (- zamik)
            if (n.rok && d.datum && addDays(d.datum, -zamikDni) < n.rok) y.zamuja = true;
            odpreme.set(kljuc, y);
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
          odpreme: [...odpreme.values()]
            .map(({ druzine, ...y }) => ({ ...y, kos: r2(y.kos), druzina: [...druzine].join("/") || null }))
            .sort((a, b) => (a.datum ?? "9999").localeCompare(b.datum ?? "9999") || a.narocilo.localeCompare(b.narocilo)),
        });
      }
      return { koda: o.koda, naziv: o.naziv, danes, krovni };
    });
}
