"use client";

// Objava delovnega plana oddelka na FIN:TV iz SHRANJENEGA plana v bazi (enak izračun kot stran Delovni plan:
// razpored postavitev, workflow po tednih, odpreme po nalogih, družine za pregled). Kliče jo vrsta objav (tvVrsta) -
// po Shrani plan in s strani Sync v TV. Modul je težek (izračun + PDF), naloži se šele ob objavi.
import { addDays, toIso, type IsoDate } from "./dates";
import { naloziDruzine, naloziNormative, type OddelekKoda } from "./normativi";
import {
  jeDelovniDan,
  kosiKrovnega,
  naloziCelice,
  naloziPostavitve,
  naloziZaposlene,
  pretvoriStarePostavitve,
  pripraviWorkflow,
  razporedi,
  urePostavitve,
  zdruziKrovne,
  type Postavitev,
} from "./plan";
import { naloziMaterial, type Material } from "./material";
import { naloziZadnjiOdpUvoz, naloziZadnjiPriUvoz, odpremePoNalogih } from "./prioritete";
import { izracunajNaloge, naloziZadnjiUvoz, naloziZasOddelke } from "./zasedenost";
import { objaviPlanNaTv, type IzidObjave } from "./tvObjava";

/**
 * Izračuna shranjen plan oddelka in ga objavi na FIN:TV (workflow + pregled, vsak teden od tekočega do konca plana).
 * Vrne objavljene dokumente (prazno = komponenti izklopljeni / plan ne sega v tekoči teden).
 */
export async function objaviPlanOddelka(koda: OddelekKoda, napredek?: (korak: number, vseh: number) => void): Promise<IzidObjave> {
  const danes = toIso(new Date());
  const [oddelki, uvoz, normativi, vseCelice, vsePostavitve, zaposleni] = await Promise.all([
    naloziZasOddelke(),
    naloziZadnjiUvoz(),
    naloziNormative(true),
    naloziCelice(danes),
    naloziPostavitve(),
    naloziZaposlene(addDays(danes, -180), addDays(danes, 400)),
  ]);
  const oddelek = oddelki.find((o) => o.koda === koda);
  if (!oddelek) throw new Error(`Oddelek ${koda} ni najden.`);
  const celice = vseCelice.filter((c) => c.oddelek_id === oddelek.id);
  const krovni = zdruziKrovne(izracunajNaloge(uvoz.nalogi, normativi), koda);
  const krovniPoKljucu = new Map(krovni.map((k) => [k.kljuc, k]));

  // kapaciteta: zaposleni po dnevih (privzeto celice) × ure na dan
  const zap = new Map(zaposleni.map((z) => [`${z.delovno_mesto_id}|${z.datum}`, z.st_zaposlenih]));
  const celicaPoId = new Map(celice.map((c) => [c.id, c]));
  const steviloZaposlenih = (id: number, d: IsoDate) => zap.get(`${id}|${d}`) ?? celicaPoId.get(id)?.privzeto_zaposlenih ?? 0;
  const kapaciteta = (id: number, d: IsoDate) => (jeDelovniDan(d) ? steviloZaposlenih(id, d) * oddelek.ure_na_dan : 0);

  // postavitve kot na strani (stare postavitve pretvorjene, ure iz planiranih kosov)
  const postavitve = pretvoriStarePostavitve(
    vsePostavitve.filter((p) => p.oddelek_id === oddelek.id),
    krovniPoKljucu,
    koda,
    kapaciteta,
  ).postavitve;
  const kosiPostavitev = new Map<number, Map<string, number>>();
  const vPlanu = new Set(postavitve.map((p) => p.krovni_dn));
  for (const k of krovni) if (vPlanu.has(k.kljuc)) for (const [id, kosi] of kosiKrovnega(k, postavitve)) kosiPostavitev.set(id, kosi);
  const krovniZa = (p: Postavitev) => (p.prosta ? undefined : krovniPoKljucu.get(p.krovni_dn));
  const efektivne = postavitve.map((p) => ({ ...p, ure: urePostavitve(p, krovniZa(p), koda, kosiPostavitev.get(p.id)) }));
  const { razpored } = razporedi(efektivne, kapaciteta);
  const zadnjiDan = efektivne.reduce<IsoDate | null>((m, p) => {
    const d = razpored.get(p.id)?.do;
    return d && (!m || d > m) ? d : m;
  }, null);

  // odpreme po nalogih (naročila FIFO) in družine normativov za pregled - ob napaki brez njih
  const [pri, odp, mat, sifrant] = await Promise.all([
    naloziZadnjiPriUvoz().catch(() => null),
    naloziZadnjiOdpUvoz().catch(() => ({ odpreme: [] })),
    naloziMaterial().catch(() => ({ material: new Map<string, Material>() })),
    naloziDruzine().catch(() => []),
  ]);
  const odpreme = pri ? odpremePoNalogih(pri.postavke, uvoz.nalogi, odp.odpreme, mat.material) : new Map<string, IsoDate[]>();
  const druzine = {
    poIdentu: new Map<string, string>(normativi.filter((n) => n.druzina).map((n) => [n.ident, n.druzina])),
    vse: sifrant.length ? sifrant.map((d) => d.koda) : ([...new Set(normativi.map((n) => n.druzina).filter(Boolean))] as string[]),
  };

  const izid = await objaviPlanNaTv({
    oddelek: koda,
    nazivOddelka: oddelek.naziv,
    planTedna: (dnevi) =>
      pripraviWorkflow({
        oddelek: oddelek.naziv,
        celice,
        postavitve: efektivne,
        razpored,
        krovniPoKljucu,
        kosiPostavitev,
        dnevi,
        ureNaDan: oddelek.ure_na_dan,
        zaposleni: steviloZaposlenih,
        odpreme,
      }),
    druzine,
    zadnjiDan,
    napredek,
  });
  return izid ?? [];
}
