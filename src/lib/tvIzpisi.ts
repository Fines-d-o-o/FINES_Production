// Izpisi strani na FIN:TV: kode komponent v FinOS (fos_tv_viri) in opisi za okno TvPovezava.
// Lahka datoteka (brez pdf-lib) - stran jo uvozi takoj; objava je v tvObjava.ts.
import type { TvIzpis } from "@/components/TvPovezava";
import type { OddelekKoda } from "./normativi";

/** Oddelki s komponentami FIN:TV (vsak oddelek svoja komponenta za vsak izpis). */
export const ODDELKI_TV: OddelekKoda[] = ["P", "M", "E", "T"];

/** Koda komponente pregleda plana za oddelek (FinOS 025). */
export const kodaPregleda = (oddelek: OddelekKoda) => `fp_plan_pregled_${oddelek.toLowerCase()}`;
/** Koda komponente workflowa plana za oddelek (FinOS 026). */
export const kodaWorkflowa = (oddelek: OddelekKoda) => `fp_plan_workflow_${oddelek.toLowerCase()}`;
/** Koda komponente "Delo - prejšnji dan" za oddelek (FinOS 027). */
export const kodaDela = (oddelek: OddelekKoda) => `fp_delo_vceraj_${oddelek.toLowerCase()}`;
/** Koda komponente "Zaključeni krovni" za oddelek (FinOS 028). */
export const kodaZakljucenih = (oddelek: OddelekKoda) => `fp_zakljuceni_krovni_${oddelek.toLowerCase()}`;
/** Koda komponente "Pripravljenost materiala" za oddelek (FinOS 029). */
export const kodaPripravljenosti = (oddelek: OddelekKoda) => `fp_pripravljenost_mat_${oddelek.toLowerCase()}`;

/** Koda komponente "Prioritete krovnih" za oddelek (FinOS 031). */
export const kodaPrioritet = (oddelek: OddelekKoda) => `fp_prioritete_krovnih_${oddelek.toLowerCase()}`;
/** Uvozi, po katerih se Prioritete krovnih samodejno objavijo na TV. */
export const SYNC_PRIORITETE = ["narocila", "odpreme", "nalogi", "material"] as const;
/** Koliko dni velja objava Prioritet krovnih (nova objava jo zamenja). */
export const VELJA_PRIORITETE_DNI = 3;

/** Uvozi, po katerih se Pripravljenost materiala samodejno objavi na TV. */
export const SYNC_PRIPRAVLJENOST = ["izdaje", "material", "dobave", "nalogi"] as const;
/** Koliko dni veljajo strani Pripravljenosti (sync je vsak delovni dan - po tem TV ne kaže zastarelih podatkov). */
export const VELJA_PRIPRAVLJENOST_DNI = 3;

const SYNC_POROCANO =
  "Samodejno ob vsakem uvozu Poročanega dela (Sync na strani Podatki - zjutraj in popoldan), v ozadju po uvozu. Sync teče v brskalniku, ki ima povezano mapo izvozov iz ERP; brez synca se TV ne osveži. Stanje: Podatki → Sync v TV.";

/** Zasedenost → Produktivnost. */
export const tvIzpisiProduktivnosti = (oddelek: OddelekKoda): TvIzpis[] => [
  {
    naslov: "Delo - prejšnji dan",
    koda: kodaDela(oddelek),
    vsebina:
      "Za vsako celico krog štempljanih ur prejšnjega delovnega dne proti planiranim uram iz delovnega plana (zelena do plana, rumena do +10 %, rdeča nad +10 % - krožnica čez plan je zunaj zelene), pod krogom ure po krovnih nalogih, izven plana in režija; zgoraj desno oddelek skupaj.",
    format: "PDF, ena stran 16:9 na oddelek (TV čez cel zaslon).",
    kdaj: SYNC_POROCANO,
    velja: "Samo na dan objave - naslednji dan je prazno do novega uvoza.",
    prenos: "Zavihek Plan in ure → Izvoz → PDF - delo prejšnji dan.",
  },
  {
    naslov: "Zaključeni krovni",
    koda: kodaZakljucenih(oddelek),
    vsebina: "Produktivnost krovnih nalogov iz delovnega plana, zaključenih v zadnjih 30 dneh (normativne ure ÷ štempljane ure), po celicah.",
    format: "PDF, ena stran 16:9 na celico.",
    kdaj: SYNC_POROCANO,
    velja: "7 dni od objave (vsak nov uvoz jih zamenja).",
    prenos: "Zavihek Zaključeni krovni → Izvoz → PDF - zaključeni krovni.",
  },
];

/** Proizvodnja → Planiranje → Pripravljenost materiala (vsak oddelek svoja komponenta). */
export const tvIzpisiPripravljenosti = (naziv: (o: OddelekKoda) => string): TvIzpis[] =>
  ODDELKI_TV.map((o) => ({
    naslov: `Pripravljenost materiala · ${naziv(o)}`,
    koda: kodaPripravljenosti(o),
    vsebina:
      "Za vsak krovni nalog iz delovnega plana oddelka velika lista materiala, ki ni na zalogi: šifra, material, količina, naročilo, datum prihoda in stanje; zgoraj družina, začetek v planu in kdaj je material kompleten. Krovni z vsem materialom v hiši so na eni zbirni strani.",
    format: "PDF, stran 16:9 na krovni nalog (TV jih vrti).",
    kdaj: "Samodejno po vsakem uvozu Izdaj, Materiala, Naročil dobavitelju ali Delovnih nalogov (Sync na strani Podatki), po Shrani plan in z gumbom Sync na strani Podatki → Sync v TV. Sync teče v brskalniku s povezano mapo izvozov iz ERP.",
    velja: `${VELJA_PRIPRAVLJENOST_DNI} dni od objave (vsaka nova objava jih zamenja) - brez synca TV ne kaže zastarelih podatkov.`,
    prenos: "Izvoz → PDF - krovni v planu (ali PDF posameznega krovnega v razprti vrstici). Na strani so privzete izločene skupine materiala, kot na TV.",
  }));

/** Proizvodnja → Prioritete (vsak oddelek svoja komponenta). */
export const tvIzpisiPrioritet = (naziv: (o: OddelekKoda) => string): TvIzpis[] =>
  ODDELKI_TV.map((o) => ({
    naslov: `Prioritete krovnih · ${naziv(o)}`,
    koda: kodaPrioritet(o),
    vsebina:
      "Za vsak krovni nalog, ki je v delovnem planu oddelka v tekočem ali naslednjem tednu, vse odpreme po delovnih nalogih: dan odpreme in dni do nje (zamuja, danes, jutri, čez N dni, nalog zamuja), ident, cel naziv, delovni nalog, količina, kupec in lokacija - delavec najde prave kose. Zgoraj koliko kosov krovnega je naročenih, v koliko naročilih in koliko gre na zalogo. Enaka razdelitev kot na tej strani (potrjena naročila, samo izdelki) - iskanje številke krovnega pokaže iste odpreme.",
    format: "Animirana scena na krovni (najnujnejši najprej), daljši seznam odprem čez več strani - nič se ne odreže.",
    kdaj: "Samodejno po vsakem uvozu Naročil (VD200), Odprem (VD300), Delovnih nalogov ali Materiala (Sync na strani Podatki), po Shrani plan in z gumbom Sync na strani Podatki → Sync v TV.",
    velja: `${VELJA_PRIORITETE_DNI} dni od objave (vsaka nova objava jo zamenja) - brez synca TV ne kaže zastarelih podatkov.`,
    prenos: "Pogled Po krovnih → Izvoz (Excel / PDF / sporočilo) - isti podatki kot na TV.",
  }));

/** Zasedenost → Delovni plan. */
export const tvIzpisiDelovnegaPlana = (oddelek: OddelekKoda): TvIzpis[] => [
  {
    naslov: "Delovni plan - workflow",
    koda: kodaWorkflowa(oddelek),
    vsebina: "Workflow po delovnih mestih: koraki (krovni nalogi) po dnevih - tekoči in naslednji teden (kot privzet pogled plana).",
    format: "PDF A4 ležeče, en list na delovno mesto, za vsak teden svoje strani.",
    kdaj: "Ob vsakem Shrani plan in z gumbom Sync na strani Podatki → Sync v TV (iz shranjenega plana) - za vsak teden od tekočega naprej, za katerega je plan narejen. Objava teče v ozadju; zavihka ne zapiraj, dokler ikona stanja ne pokaže kljukice.",
    velja: "Strani tedna veljajo pon - ned; TV v ponedeljek sam preklopi na nov teden.",
    prenos: "Zavihek Plan → Izvoz → PDF - workflow.",
  },
  {
    naslov: "Delovni plan - pregled (roki)",
    koda: kodaPregleda(oddelek),
    vsebina: "Časovnica po celicah: krovni nalogi od začetka do roka, kosi po družinah.",
    format: "PDF A4 pokončno, en list na celico, za vsak delovni dan svoje strani.",
    kdaj: "Ob vsakem Shrani plan in s Sync v TV (skupaj z workflowom).",
    velja: "Za vsak delovni dan svoje strani z oznako DANES na ta dan (petek velja do nedelje).",
    prenos: "Zavihek Plan → Izvoz → PDF - pregled (roki).",
  },
];
