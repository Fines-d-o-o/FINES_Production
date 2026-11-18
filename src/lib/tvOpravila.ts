// Objave na FIN:TV kot opravila v vrsti (tvVrsta): plan oddelka (Shrani plan, Sync v TV) in komponente uvoza
// Poročanega dela. Lahek modul - izračun in PDF se naložita šele, ko opravilo začne.
import type { OddelekKoda } from "./normativi";
import { NAZIV_ODDELKA, SKUPINE_TV } from "./tvStanje";
import { dodajObjavoTv } from "./tvVrsta";

const tednov = (n: number) => `${n} ${n === 1 ? "teden" : n === 2 ? "tedna" : n <= 4 ? "tedni" : "tednov"}`;
const kodeSkupine = (id: string) => SKUPINE_TV.find((s) => s.id === id)?.komponente.map((k) => k.koda) ?? [];

/** Delovni plan oddelka (workflow + pregled) iz shranjenega plana. `spredaj` = pred ostalimi (po Shrani plan). */
export function objaviPlanVOzadju(oddelek: OddelekKoda, { spredaj = false }: { spredaj?: boolean } = {}) {
  dodajObjavoTv(
    {
      id: `plan:${oddelek}`,
      naslov: `Delovni plan · ${NAZIV_ODDELKA[oddelek]}`,
      kode: kodeSkupine(`plan:${oddelek}`),
      delo: async (napredek) => {
        const { objaviPlanOddelka } = await import("./tvPlan");
        const izid = await objaviPlanOddelka(oddelek, napredek);
        return izid.length
          ? `Objavljeno: ${izid.map((d) => `${d.ime} ${tednov(d.tednov)}${d.animirano ? ", animirano" : `, ${d.strani} str.`}`).join(" · ")}`
          : "Ni objave - komponenti sta izklopljeni ali plan ne sega v tekoči teden";
      },
    },
    { spredaj },
  );
  // Plan določa, kateri krovni so na listih Pripravljenosti materiala in njihov začetek
  objaviPripravljenostVOzadju("delovni plan");
}

/** "Pripravljenost materiala" - po uvozu izdaj, materiala, naročil ali nalogov, po Shrani plan in z gumbom Sync. */
export function objaviPripravljenostVOzadju(izvor = "sync") {
  dodajObjavoTv({
    id: "pripravljenost",
    naslov: "Pripravljenost materiala",
    kode: kodeSkupine("pripravljenost"),
    delo: async () => {
      const { objaviPripravljenostNaTv } = await import("./tvObjava");
      const izid = await objaviPripravljenostNaTv(izvor);
      return izid.oddelki.length ? `Objavljeno: ${izid.oddelki.join(", ")}` : "Ni objave - komponente so izklopljene";
    },
  });
}

/** Plan vseh oddelkov (gumb Sync vse na strani Sync v TV in v glavi). */
export function objaviVsePlaneVOzadju() {
  for (const s of SKUPINE_TV) if (s.oddelek) objaviPlanVOzadju(s.oddelek);
}

/** "Delo - prejšnji dan" in "Zaključeni krovni" - po uvozu Poročanega dela (sync.ts). */
export function objaviPorocanoVOzadju() {
  objaviDeloVOzadju();
  objaviZakljuceneVOzadju();
}

/** "Delo - prejšnji dan" - po uvozu Poročanega dela in z gumbom Sync (Sync v TV). */
export function objaviDeloVOzadju(izvor?: string) {
  dodajObjavoTv({
    id: "delo",
    naslov: "Delo - prejšnji dan",
    kode: kodeSkupine("delo"),
    delo: async () => {
      const { objaviDeloNaTv } = await import("./tvObjava");
      const izid = await objaviDeloNaTv(izvor);
      return izid.oddelki.length ? `Objavljeno za ${izid.datum}: ${izid.oddelki.join(", ")}` : "Ni objave - komponente so izklopljene";
    },
  });
}

/** "Zaključeni krovni" - po uvozu Poročanega dela in z gumbom Sync (Sync v TV). */
export function objaviZakljuceneVOzadju(izvor?: string) {
  dodajObjavoTv({
    id: "zakljuceni",
    naslov: "Zaključeni krovni",
    kode: kodeSkupine("zakljuceni"),
    delo: async () => {
      const { objaviZakljuceneNaTv } = await import("./tvObjava");
      const izid = await objaviZakljuceneNaTv(izvor);
      return izid.oddelki.length ? `Objavljeno: ${izid.oddelki.join(", ")}` : "Ni objave - komponente so izklopljene";
    },
  });
}
