"use client";

// Vrsta objav na FIN:TV: vse objave (Shrani plan, Sync v TV, uvoz Poročanega dela) gredo ena za drugo v ozadju te
// aplikacije - ne ustavijo se ob menjavi strani, samo ob zaprtju zavihka (zato opozorilo ob zapiranju). Stanje opravil
// berejo TvPovezava, TvGlava in stran Sync v TV (useTvVrsta). Stanje velja za ta zavihek (zadnja objava je v FinOS).
import { useSyncExternalStore } from "react";

export type StanjeOpravila = "caka" | "tece" | "ok" | "napaka";

export type OpraviloTv = {
  /** Enolično opravilo, npr. "plan:M", "delo", "zakljuceni". */
  id: string;
  naslov: string;
  /** Kode komponent FinOS, ki jih opravilo objavi (za stanje na TvPovezava). */
  kode: string[];
  stanje: StanjeOpravila;
  /** Napredek (npr. teden 2 od 7); vseh 0 = ni znan. */
  korak: number;
  vseh: number;
  /** Opis uspeha ali napake. */
  sporocilo: string;
  /** Zadnja sprememba stanja (ms). */
  cas: number;
};

/** Delo opravila: vrne opis uspeha; `napredek(korak, vseh)` sproti javi napredek. */
export type DeloTv = (napredek: (korak: number, vseh: number) => void) => Promise<string>;

type Cakajoce = { id: string; delo: DeloTv };

let opravila: OpraviloTv[] = [];
const vrsta: Cakajoce[] = [];
let tece = false;
const posluslalci = new Set<() => void>();

function objavi(nova: OpraviloTv[]) {
  opravila = nova;
  posodobiOpozorilo();
  posluslalci.forEach((p) => p());
}

function nastavi(id: string, sprememba: Partial<OpraviloTv>) {
  objavi(opravila.map((o) => (o.id === id ? { ...o, ...sprememba, cas: Date.now() } : o)));
}

/**
 * Doda objavo v vrsto. Isto opravilo, ki že čaka, se ne podvoji (velja novejše delo); če isto opravilo ravno teče,
 * se po koncu izvede še enkrat (podatki so se medtem spremenili). `spredaj` = pred ostalimi čakajočimi (Shrani plan).
 */
export function dodajObjavoTv(
  o: { id: string; naslov: string; kode: string[]; delo: DeloTv },
  { spredaj = false }: { spredaj?: boolean } = {},
) {
  const cakajoce = vrsta.find((v) => v.id === o.id);
  if (cakajoce) cakajoce.delo = o.delo;
  else if (spredaj) vrsta.unshift({ id: o.id, delo: o.delo });
  else vrsta.push({ id: o.id, delo: o.delo });
  const obstaja = opravila.find((x) => x.id === o.id);
  const novo: OpraviloTv = { id: o.id, naslov: o.naslov, kode: o.kode, stanje: "caka", korak: 0, vseh: 0, sporocilo: "", cas: Date.now() };
  if (!obstaja) objavi([...opravila, novo]);
  else if (obstaja.stanje !== "tece") nastavi(o.id, { naslov: o.naslov, kode: o.kode, stanje: "caka", korak: 0, vseh: 0, sporocilo: "" });
  void izvajaj();
}

async function izvajaj() {
  if (tece) return;
  tece = true;
  try {
    while (vrsta.length) {
      const { id, delo } = vrsta.shift()!;
      nastavi(id, { stanje: "tece", korak: 0, vseh: 0, sporocilo: "" });
      try {
        const opis = await delo((korak, vseh) => nastavi(id, { korak, vseh }));
        // Med izvajanjem je bilo isto opravilo znova dodano -> ostane "čaka"
        nastavi(id, { stanje: vrsta.some((v) => v.id === id) ? "caka" : "ok", sporocilo: opis });
      } catch (e) {
        nastavi(id, { stanje: "napaka", sporocilo: (e as Error).message || "Neznana napaka" });
      }
    }
  } finally {
    tece = false;
  }
}

/** Ali objava teče ali čaka (ob zapiranju zavihka / odjavi bi se prekinila). */
export const objavaTvTece = () => opravila.some((o) => o.stanje === "tece" || o.stanje === "caka");

export const OPOZORILO_ZAPIRANJA = "Objava na TV še teče - res zapreš?";

/** Odjava / zapiranje aplikacije: true = ni objave ali je uporabnik potrdil prekinitev. */
export function lahkoPrekinemTv(): boolean {
  return !objavaTvTece() || window.confirm(OPOZORILO_ZAPIRANJA);
}

// Brskalnik ob zapiranju zavihka pokaže svoje vprašanje (besedila strani ne dovoli) - samo, ko objava teče
const opozoriZapiranje = (e: BeforeUnloadEvent) => {
  e.preventDefault();
  e.returnValue = OPOZORILO_ZAPIRANJA;
  return OPOZORILO_ZAPIRANJA;
};
let opozoriloVklopljeno = false;
function posodobiOpozorilo() {
  if (typeof window === "undefined") return;
  const treba = objavaTvTece();
  if (treba === opozoriloVklopljeno) return;
  opozoriloVklopljeno = treba;
  if (treba) window.addEventListener("beforeunload", opozoriZapiranje);
  else window.removeEventListener("beforeunload", opozoriZapiranje);
}

const PRAZNO: OpraviloTv[] = [];

/** Vsa opravila te seje (vrstni red dodajanja). */
export function useTvVrsta(): OpraviloTv[] {
  return useSyncExternalStore(
    (p) => {
      posluslalci.add(p);
      return () => posluslalci.delete(p);
    },
    () => opravila,
    () => PRAZNO,
  );
}
