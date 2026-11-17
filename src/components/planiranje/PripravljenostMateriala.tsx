"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, ClipboardList, Columns3 } from "lucide-react";
import { formatShort, todayWorkday, type IsoDate } from "@/lib/dates";
import { KRATKA_VRSTA_ROKA, OPIS_VRSTE_ROKA, type Dobava, type VrstaRoka } from "@/lib/dobave";
import { privzeteIzlocene, skupinaSKlasifikatom } from "@/lib/doizdaja";
import { ujemaIskanje } from "@/lib/iskanje";
import {
  OPIS_STANJA_MAT,
  STANJA,
  materialKrovnega,
  naslednjaDobava,
  skupineMateriala,
  resnost,
  slabse,
  type KrovniPripravljenost,
  type MaterialPripravljenost,
  type StanjeMateriala,
  type VrsticaPotrebe,
} from "@/lib/pripravljenost";
import {
  glavaKrovnega,
  prenesiTxt,
  prenesiXlsx,
  vrsticeKrovnih,
  vrsticeMateriala,
  vrsticeMaterialaKrovnega,
  vseVrstice,
} from "@/lib/pripravljenostIzvoz";
import { izracunaj, naloziPodatkePripravljenosti, stanjePodatkov, type KrovniNaListu, type PodatkiPripravljenosti } from "@/lib/pripravljenostPodatki";
import { NAZIV_ODDELKA } from "@/lib/tvStanje";
import { tvIzpisiPripravljenosti } from "@/lib/tvIzpisi";
import { formatNum } from "@/lib/stevila";
import { supabaseConfigured } from "@/lib/supabase";
import { Button } from "@/components/ui/Button";
import { FilterKartica, type KarticaBarva } from "@/components/ui/FilterKartica";
import { FilterIskanje, FilterPolje, FilterPreklopnik, FilterVrstica } from "@/components/ui/Filtri";
import { Izvoz, type IzvozFormat } from "@/components/ui/Izvoz";
import { MultiSelect } from "@/components/ui/MultiSelect";
import { ConfigMissing, Loading, WarningText } from "@/components/ui/Notice";
import { SortTh, TabelaOkvir, useRazvrscanje } from "@/components/ui/Tabela";
import { useToast } from "@/components/ui/Toast";
import { Zavihki } from "@/components/ui/Zavihki";
import { PodatkiVir } from "@/components/PodatkiVir";
import { usePoSyncu } from "@/components/SyncProvider";
import { TvPovezava } from "@/components/TvPovezava";

type Pogled = "nalogi" | "material";
type Obseg = "plan" | "vsi";

const NASTAVITVE_KLJUC = "pripravljenost-materiala";

type Shranjeno = {
  pogled: Pogled;
  obseg: Obseg;
  stanja: StanjeMateriala[];
  /** Skupine materiala, ki se ne štejejo (npr. pločevina se izda prej za razrez); null = privzete kot pri doizdaji. */
  izlocene: string[] | null;
};
const PRIVZETA_STANJA: StanjeMateriala[] = ["ni_naroceno", "prepozno", "zapadel", "pride"];
const PRIVZETO: Shranjeno = { pogled: "nalogi", obseg: "plan", stanja: PRIVZETA_STANJA, izlocene: null };

function preberiShranjeno(): Shranjeno {
  try {
    const s = JSON.parse(localStorage.getItem(NASTAVITVE_KLJUC) ?? "null") as Partial<Shranjeno> | null;
    const n = { ...PRIVZETO, ...(s ?? {}) };
    return { ...n, stanja: Array.isArray(n.stanja) ? n.stanja.filter((x) => STANJA.includes(x)) : PRIVZETA_STANJA };
  } catch {
    return PRIVZETO;
  }
}

const BARVA: Record<StanjeMateriala, KarticaBarva & { znacka: string; besedilo: string }> = {
  ni_naroceno: {
    trak: "bg-nok-500",
    aktivna: "border-nok-500 bg-nok-50",
    ikona: "text-nok-500",
    znacka: "bg-nok-500 text-white",
    besedilo: "text-nok-600",
  },
  prepozno: {
    trak: "bg-fines-500",
    aktivna: "border-fines-500 bg-fines-50",
    ikona: "text-fines-500",
    znacka: "bg-fines-500 text-white",
    besedilo: "text-fines-600",
  },
  zapadel: {
    trak: "bg-warn-500",
    aktivna: "border-warn-500 bg-warn-50",
    ikona: "text-warn-500",
    znacka: "bg-warn-400 text-ink-900",
    besedilo: "text-warn-700",
  },
  pride: {
    trak: "bg-sync-500",
    aktivna: "border-sync-500 bg-sync-50",
    ikona: "text-sync-500",
    znacka: "bg-sync-500 text-white",
    besedilo: "text-sync-600",
  },
  zaloga: {
    trak: "bg-ok-500",
    aktivna: "border-ok-500 bg-ok-50",
    ikona: "text-ok-500",
    znacka: "bg-ok-500 text-white",
    besedilo: "text-ok-600",
  },
};

const HINT_STANJA: Record<StanjeMateriala, string> = {
  ni_naroceno: "Del materiala ni na zalogi in ni naročen",
  prepozno: "Dobava pride po začetku v planu",
  zapadel: "Rok dobave je mimo, material še ni prevzet",
  pride: "Material pride pred začetkom v planu",
  zaloga: "Ves material je na zalogi",
};


const datumTxt = (d: IsoDate | null) => (d ? formatShort(d) : "–");
const kol = (n: number) => formatNum(Math.round(n * 1000) / 1000);

type Podatki = PodatkiPripravljenosti;
const pridobiPodatke = naloziPodatkePripravljenosti;

/** PDF se naloži šele ob kliku (pdf-lib). */
async function prenesiPdf(krovni: KrovniNaListu[], naslov: string, stanje: string, ime: string, zbirna: boolean) {
  const { prenesiPripravljenostPdf } = await import("@/lib/pripravljenostPdf");
  await prenesiPripravljenostPdf({ krovni, naslov, stanje, zbirna }, ime);
}

export function PripravljenostMateriala() {
  if (!supabaseConfigured) return <ConfigMissing />;
  return <PripravljenostInner />;
}

function PripravljenostInner() {
  const notify = useToast();
  const [podatki, setPodatki] = useState<Podatki | null>(null);
  // Stran pokaže Loading, dokler podatki niso naloženi - branje localStorage ob inicializaciji je varno
  const [nast, setNast] = useState<Shranjeno>(() => preberiShranjeno());
  const [iskanje, setIskanje] = useState("");

  const nalozi = useCallback(async () => setPodatki(await pridobiPodatke()), []);
  useEffect(() => {
    let preklic = false;
    pridobiPodatke()
      .then((p) => {
        if (!preklic) setPodatki(p);
      })
      .catch((e) => notify("error", `Napaka pri nalaganju podatkov: ${(e as Error).message}`, 10000));
    return () => {
      preklic = true;
    };
  }, [notify]);
  usePoSyncu(() => {
    nalozi().catch((e) => notify("error", `Napaka pri nalaganju podatkov: ${(e as Error).message}`, 10000));
  });

  function spremeni(n: Partial<Shranjeno>) {
    const nove = { ...nast, ...n };
    setNast(nove);
    try {
      localStorage.setItem(NASTAVITVE_KLJUC, JSON.stringify(nove));
    } catch {
      // brez shrambe velja do osvežitve
    }
  }

  const danes = todayWorkday();

  // Skupine in klasifikati za privzeto izločene (isti kot pri doizdaji)
  const izdaje = podatki?.izd.vrstice;
  const { skupine, klasifikati } = useMemo(() => skupineMateriala(izdaje ?? []), [izdaje]);
  const izlocene = useMemo(() => nast.izlocene ?? privzeteIzlocene(skupine, klasifikati), [nast.izlocene, skupine, klasifikati]);

  const rezultat = useMemo(
    () =>
      podatki
        ? izracunaj(podatki, izlocene, danes)
        : { danes, krovni: [], material: [], skupine: [], klasifikati: {}, razlikeNarocil: 0 },
    [podatki, izlocene, danes],
  );

  if (!podatki) return <Loading />;

  const imeOddelka = new Map(podatki.oddelki.map((o) => [o.id, o.naziv]));
  const imeCelice = new Map(podatki.celice.map((c) => [c.id, c.naziv]));
  const vObsegu = (zacetek: IsoDate | null) => nast.obseg === "vsi" || zacetek !== null;

  // ---- Po nalogih: obseg + iskanje, nato kartice stanj
  const iskaniKrovni = rezultat.krovni.filter(
    (k) =>
      vObsegu(k.zacetek) &&
      ujemaIskanje(iskanje, [
        k.krovni,
        ...k.druzine,
        ...k.nalogi.flatMap((n) => [n.st_naloga, n.naziv, n.koda_artikla]),
        ...k.vrstice.filter((v) => v.stanje !== "zaloga").flatMap((v) => [v.ident, v.naziv, ...v.dobave.map((d) => d.dobavitelj)]),
      ]),
  );
  const prikazaniKrovni = iskaniKrovni.filter((k) => nast.stanja.includes(k.stanje));

  // ---- Po materialu: samo vrstice v obsegu
  const iskaniMaterial = rezultat.material
    .map((m) => {
      const vrstice = m.vrstice.filter((v) => vObsegu(v.zacetek));
      return {
        ...m,
        vrstice,
        krovni: [...new Set(vrstice.map((v) => v.krovni))],
        stanje: vrstice.reduce<StanjeMateriala>((a, v) => slabse(a, v.stanje), "zaloga"),
      };
    })
    .filter(
      (m) =>
        m.vrstice.length > 0 &&
        ujemaIskanje(iskanje, [
          m.ident,
          m.naziv,
          m.skupina,
          ...m.krovni,
          ...m.vrstice.map((v) => v.st_naloga),
          ...m.dobave.flatMap((d) => [d.naziv_dobavitelja, d.stevilka]),
        ]),
    );
  const prikazaniMaterial = iskaniMaterial.filter((m) => nast.stanja.includes(m.stanje));

  const vPlanu = rezultat.krovni.filter((k) => k.zacetek !== null).length;
  const manjkaUvoz = [
    !podatki.izd.uvoz && "Izdaje v proizvodnjo",
    podatki.mat.uvoz === null && "Material (zaloge)",
    !podatki.dob.niTabel && !podatki.dob.uvoz && "Naročila dobavitelju",
    !podatki.nal.uvoz && "Delovni nalogi",
  ].filter(Boolean) as string[];

  const mesto = (k: { oddelek_id: number | null; delovno_mesto_id: number | null }) =>
    [k.oddelek_id && imeOddelka.get(k.oddelek_id), k.delovno_mesto_id && imeCelice.get(k.delovno_mesto_id)].filter(Boolean).join(" · ");
  const stanje = stanjePodatkov(podatki);
  const brezStanja = stanje.replace(/^Stanje: /, "");
  const naListu = (k: KrovniPripravljenost): KrovniNaListu => ({
    k,
    zacetek: k.zacetek,
    mesto: k.delovno_mesto_id ? (imeCelice.get(k.delovno_mesto_id) ?? "") : "",
  });

  const formatiNalogov: IzvozFormat[] = [
    {
      koda: "xlsx-skupni",
      label: "Excel - skupni pregled",
      hint: "Prikazani krovni nalogi, en krovni v vrstici",
      akcija: () => prenesiXlsx([{ ime: "Krovni nalogi", vrstice: vrsticeKrovnih(prikazaniKrovni, mesto) }], `Pripravljenost_materiala_krovni_${danes}`),
    },
    {
      koda: "xlsx-vrstice",
      label: "Excel - vse vrstice",
      hint: "Prikazani krovni s pregledom in vsemi vrsticami materiala (nalog × ident, tudi na zalogi)",
      akcija: () =>
        prenesiXlsx(
          [
            { ime: "Krovni nalogi", vrstice: vrsticeKrovnih(prikazaniKrovni, mesto) },
            { ime: "Vse vrstice", vrstice: vseVrstice(prikazaniKrovni) },
          ],
          `Pripravljenost_materiala_vrstice_${danes}`,
        ),
    },
    {
      koda: "txt-skupni",
      label: "Besedilo - skupni pregled",
      hint: "Prikazani krovni nalogi kot poravnana tabela (.txt)",
      akcija: () =>
        prenesiTxt(
          `Pripravljenost materiala · ${formatShort(danes)}`,
          [{ glava: [["Stanje podatkov", brezStanja]] }, { vrstice: vrsticeKrovnih(prikazaniKrovni, mesto) }],
          `Pripravljenost_materiala_krovni_${danes}`,
        ),
    },
    {
      koda: "txt-vrstice",
      label: "Besedilo - vse vrstice",
      hint: "Za vsak prikazan krovni glava in material, ki ni na zalogi (.txt)",
      akcija: () =>
        prenesiTxt(
          `Pripravljenost materiala · ${formatShort(danes)}`,
          [
            { glava: [["Stanje podatkov", brezStanja]] },
            ...prikazaniKrovni.map((k) => ({
              naslov: `Krovni ${k.krovni}${k.druzine.length ? ` · ${k.druzine.join(", ")}` : ""}`,
              glava: glavaKrovnega(k, mesto(k)),
              vrstice: materialKrovnega(k).length ? vrsticeMaterialaKrovnega(k) : undefined,
            })),
          ],
          `Pripravljenost_materiala_vrstice_${danes}`,
        ),
    },
    {
      koda: "pdf",
      label: "PDF - krovni (16:9)",
      hint: "Prikazani krovni nalogi, en list na krovni (kot na FIN:TV); krovni z vsem materialom v hiši na zbirnem listu",
      akcija: () => prenesiPdf(prikazaniKrovni.map(naListu), "Pripravljenost materiala", stanje, `Pripravljenost_materiala_${danes}`, true),
    },
  ];
  const formatiMateriala: IzvozFormat[] = [
    {
      koda: "xlsx",
      label: "Excel (.xlsx)",
      hint: "Prikazan manjkajoč material",
      akcija: () => prenesiXlsx([{ ime: "Material", vrstice: vrsticeMateriala(prikazaniMaterial, danes) }], `Pripravljenost_materiala_material_${danes}`),
    },
    {
      koda: "txt",
      label: "Besedilo (.txt)",
      hint: "Prikazan manjkajoč material kot poravnana tabela",
      akcija: () =>
        prenesiTxt(
          `Pripravljenost materiala - po materialu · ${formatShort(danes)}`,
          [{ vrstice: vrsticeMateriala(prikazaniMaterial, danes) }],
          `Pripravljenost_materiala_material_${danes}`,
        ),
    },
  ];
  /** Izvoz posameznega krovnega (razprta vrstica). */
  const izvozKrovnega = (k: KrovniPripravljenost): IzvozFormat[] => {
    const ime = `Pripravljenost_materiala_${k.krovni}_${danes}`;
    return [
      {
        koda: "pdf",
        label: "PDF (16:9)",
        hint: `List krovnega ${k.krovni} kot na FIN:TV`,
        akcija: () => prenesiPdf([naListu(k)], `Pripravljenost materiala · ${k.krovni}`, stanje, ime, false),
      },
      {
        koda: "xlsx",
        label: "Excel (.xlsx)",
        hint: `Material krovnega ${k.krovni} po identu in vse vrstice po nalogih`,
        akcija: () =>
          prenesiXlsx(
            [
              { ime: "Krovni", vrstice: glavaKrovnega(k, mesto(k)).map(([a, b]) => ({ Podatek: a, Vrednost: b })) },
              { ime: "Material", vrstice: vrsticeMaterialaKrovnega(k) },
              { ime: "Vse vrstice", vrstice: vseVrstice([k]) },
            ],
            ime,
          ),
      },
      {
        koda: "txt",
        label: "Besedilo (.txt)",
        hint: `Krovni ${k.krovni} in material, ki ni na zalogi`,
        akcija: () =>
          prenesiTxt(
            `Pripravljenost materiala · krovni ${k.krovni} · ${formatShort(danes)}`,
            [
              { glava: [...glavaKrovnega(k, mesto(k)), ["Stanje podatkov", brezStanja]] },
              { naslov: "Material, ki ni na zalogi", vrstice: materialKrovnega(k).length ? vrsticeMaterialaKrovnega(k) : undefined },
            ],
            ime,
          ),
      },
    ];
  };

  const stevilo = (s: StanjeMateriala) =>
    nast.pogled === "nalogi" ? iskaniKrovni.filter((k) => k.stanje === s).length : iskaniMaterial.filter((m) => m.stanje === s).length;

  return (
    <div className="flex flex-col gap-4">
      {/* ============ GLAVA ============ */}
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto min-w-[min(100%,18rem)] flex-1">
          <h2 className="text-xl font-bold text-ink-900">Pripravljenost materiala</h2>
          <p className="text-sm text-ink-500">
            Ali je ves material za krovne naloge na zalogi in kdaj pride manjkajoči - zaloga in dobave se razdelijo po vrstnem redu
            delovnega plana
          </p>
        </div>
        <div className="flex w-full items-stretch gap-3 sm:w-auto">
          <PodatkiVir kljuci={["izdaje", "material", "dobave", "nalogi"]} />
          <TvPovezava izpisi={tvIzpisiPripravljenosti((o) => NAZIV_ODDELKA[o])} />
        </div>
      </div>

      {/* ============ OPOZORILA ============ */}
      {podatki.dob.niTabel && (
        <WarningText>
          V bazi še ni tabel za dobave materiala. V Supabase SQL editorju zaženi{" "}
          <code className="rounded bg-white px-1">supabase/migrations/038_dobave_materiala.sql</code> in osveži stran.
        </WarningText>
      )}
      {manjkaUvoz.length > 0 && (
        <WarningText>
          Ni uvoza: {manjkaUvoz.join(", ")}. Uvozi z gumbom Sync v glavi ali na strani Podatki - brez tega izračun ni popoln.
        </WarningText>
      )}
      {rezultat.razlikeNarocil > 0 && podatki.dob.uvoz && (
        <WarningText>
          Pri {rezultat.razlikeNarocil} materialih se naročena količina po ERP (izvoz materiala) razlikuje od seštevka odprtih postavk
          naročil - izvoz naročil morda ni popoln ali izvoza nista iz istega časa. Razlika je označena v zavihku Po materialu.
        </WarningText>
      )}

      {/* ============ KARTICE STANJ ============ */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {STANJA.map((s) => {
          const aktivna = nast.stanja.includes(s);
          return (
            <FilterKartica
              key={s}
              aktivna={aktivna}
              onClick={() => spremeni({ stanja: aktivna ? nast.stanja.filter((x) => x !== s) : [...nast.stanja, s] })}
              hint={`${aktivna ? "Skrij" : "Prikaži"}: ${HINT_STANJA[s].toLowerCase()}`}
              barva={BARVA[s]}
              naslov={OPIS_STANJA_MAT[s]}
              podnaslov={`${stevilo(s)} ${nast.pogled === "nalogi" ? "krovnih" : "materialov"}`}
            />
          );
        })}
      </div>

      {/* ============ ZAVIHKI + FILTRI ============ */}
      <div>
        <Zavihki
          label="Pogled pripravljenosti"
          value={nast.pogled}
          onChange={(pogled) => spremeni({ pogled })}
          zavihki={[
            { koda: "nalogi", label: "Po nalogih", icon: ClipboardList, hint: "Krovni nalogi in njihov manjkajoč material" },
            { koda: "material", label: "Po materialu", icon: Columns3, hint: "Manjkajoč material in nalogi, ki ga čakajo" },
          ]}
        />
        <div className="fp-card flex flex-col gap-3 rounded-tl-none p-3 sm:p-4">
          <FilterVrstica>
            <FilterIskanje
              value={iskanje}
              onChange={setIskanje}
              placeholder="Krovni, nalog, ident, material, dobavitelj ..."
              hint="Išči po nalogu, materialu ali dobavitelju"
            />
            <FilterPreklopnik
              label="Nalogi"
              value={nast.obseg}
              onChange={(obseg) => spremeni({ obseg })}
              options={[
                { value: "plan", label: "V delovnem planu", hint: "Samo nalogi, postavljeni v delovni plan", stevilo: vPlanu },
                { value: "vsi", label: "Vsi aktivni", hint: "Vsi aktivni nalogi iz izvoza izdaj", stevilo: rezultat.krovni.length },
              ]}
            />
            <div className="w-full sm:w-64">
              <MultiSelect
                label="Ne štej materiala"
                options={skupine}
                oznaka={(s) => skupinaSKlasifikatom(s, klasifikati)}
                value={izlocene}
                onChange={(v) => spremeni({ izlocene: v })}
                hint="Skupine materiala, ki se ne preverjajo"
                info={
                  <>
                    <b>Izbrane skupine</b> se ne preverjajo: njihov material ne vpliva na stanje krovnega in ne zasede zaloge ali dobav.
                    Privzeto iste kot pri doizdaji (pločevina se izda prej za razrez, polizdelke izdela proizvodnja).
                    <br />
                    <b>Neizbrane</b> se preverjajo kot ves ostali material.
                  </>
                }
              />
            </div>
            <FilterPolje label="Prikaz">
              <Button
                hint="Ponastavi filtre in nastavitve na privzete"
                variant="neutral"
                onClick={() => {
                  setIskanje("");
                  spremeni({ obseg: "plan", stanja: PRIVZETA_STANJA, izlocene: null });
                }}
              >
                Ponastavi filtre
              </Button>
            </FilterPolje>
            <Izvoz
              key={nast.pogled}
              className="ml-auto"
              spomin={`pripravljenost-${nast.pogled}`}
              formati={nast.pogled === "nalogi" ? formatiNalogov : formatiMateriala}
            />
          </FilterVrstica>
          <p className="text-xs text-ink-500">
            Zaloga matičnega skladišča in odprta naročila se razdelijo po vrstnem redu: najprej nalogi v planu po začetku, nato ostali
            po roku izdelave. Zaloga ostalih skladišč se ne šteje. Rok dobave: potrjen → želeni → predviden.
          </p>
        </div>
      </div>

      {/* ============ VSEBINA ============ */}
      {nast.pogled === "nalogi" ? (
        <PoNalogih krovni={prikazaniKrovni} mesto={mesto} danes={danes} izvoz={izvozKrovnega} />
      ) : (
        <PoMaterialu material={prikazaniMaterial} danes={danes} />
      )}
    </div>
  );
}

// =====================================================================
// ZNAČKE
// =====================================================================

function Znacka({ stanje }: { stanje: StanjeMateriala }) {
  return (
    <span title={HINT_STANJA[stanje]} className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold ${BARVA[stanje].znacka}`}>
      {OPIS_STANJA_MAT[stanje]}
    </span>
  );
}

function Rezerva({ dni }: { dni: number | null }) {
  if (dni === null) return <span className="text-ink-400">–</span>;
  const barva = dni < 0 ? "text-nok-600" : dni <= 2 ? "text-warn-700" : "text-ok-600";
  return (
    <span
      className={`font-semibold tabular-nums ${barva}`}
      title={dni < 0 ? `Material pride ${-dni} dni po začetku v planu` : `Material je v hiši ${dni} dni pred začetkom`}
    >
      {dni > 0 ? `+${dni}` : dni} dni
    </span>
  );
}

function VrstaRokaZnak({ vrsta }: { vrsta: VrstaRoka | null }) {
  if (!vrsta) return <span className="text-xs text-nok-600">brez roka</span>;
  return (
    <span
      title={OPIS_VRSTE_ROKA[vrsta]}
      className={`rounded px-1 text-[11px] font-semibold ${vrsta === "potrjen" ? "bg-ok-50 text-ok-600" : "bg-ink-100 text-ink-600"}`}
    >
      {KRATKA_VRSTA_ROKA[vrsta]}
    </span>
  );
}

function RazpriGumb({ vsi, n, onClick }: { vsi: boolean; n: number; onClick: () => void }) {
  return (
    <Button
      hint={vsi ? "Zloži vse prikazane vrstice" : "Razpri vse prikazane vrstice"}
      variant="neutral"
      icon={vsi ? ChevronDown : ChevronRight}
      disabled={n === 0}
      onClick={onClick}
    >
      {vsi ? "Zloži vse" : "Razpri vse"}
    </Button>
  );
}

function useRazprti() {
  const [razprti, setRazprti] = useState<Set<string>>(new Set());
  const preklopi = (k: string) =>
    setRazprti((r) => {
      const n = new Set(r);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  return { razprti, setRazprti, preklopi };
}

// =====================================================================
// PO NALOGIH
// =====================================================================

type KljucKrovnega = "krovni" | "druzina" | "zacetek" | "rok" | "nalogov" | "manjka" | "kompleten" | "rezerva" | "stanje";

function PoNalogih({
  krovni,
  mesto: mestoKrovnega,
  danes,
  izvoz,
}: {
  krovni: KrovniPripravljenost[];
  mesto: (k: KrovniPripravljenost) => string;
  danes: IsoDate;
  izvoz: (k: KrovniPripravljenost) => IzvozFormat[];
}) {
  const { razprti, setRazprti, preklopi } = useRazprti();
  const sort = useRazvrscanje<KrovniPripravljenost, KljucKrovnega>({
    krovni: (k) => k.krovni,
    druzina: (k) => k.druzine.join(", "),
    zacetek: (k) => k.zacetek,
    rok: (k) => k.rok,
    nalogov: (k) => k.nalogi.length,
    manjka: (k) => k.manjkajocih,
    kompleten: (k) => k.kompleten,
    rezerva: (k) => k.rezerva,
    stanje: (k) => -resnost(k.stanje),
  });
  const vsi = krovni.length > 0 && krovni.every((k) => razprti.has(k.krovni));

  return (
    <div className="fp-card flex flex-col gap-3 p-3 sm:p-4">
      <div className="flex flex-wrap items-start gap-3">
        <p className="min-w-[min(100%,18rem)] flex-1 text-sm text-ink-600">
          <b>Material kompleten</b> je dan, ko pride zadnja potrebna dobava. <b>Rezerva</b> so dnevi od tega dne do začetka v planu
          (negativna = zamuda). Klik na krovni nalog pokaže material, ki ni na zalogi.
        </p>
        <RazpriGumb vsi={vsi} n={krovni.length} onClick={() => setRazprti(vsi ? new Set() : new Set(krovni.map((k) => k.krovni)))} />
      </div>
      <TabelaOkvir>
        <table className="w-full min-w-[980px] text-sm">
          <thead className="fp-thead">
            <tr className="text-left text-xs font-bold">
              <th className="w-8 px-1 py-2" aria-label="Razpri" />
              <SortTh sort={sort} kljuc="krovni">
                Krovni
              </SortTh>
              <SortTh sort={sort} kljuc="druzina" hint="Razvrsti po družini izdelkov (iz normativov)">
                Družina
              </SortTh>
              <SortTh sort={sort} kljuc="zacetek">
                Začetek v planu
              </SortTh>
              <SortTh sort={sort} kljuc="rok">
                Rok
              </SortTh>
              <SortTh sort={sort} kljuc="nalogov" desno>
                Nalogov
              </SortTh>
              <SortTh sort={sort} kljuc="manjka" desno hint="Razvrsti po številu vrstic, ki niso na zalogi">
                Ni na zalogi
              </SortTh>
              <SortTh sort={sort} kljuc="kompleten">
                Material kompleten
              </SortTh>
              <SortTh sort={sort} kljuc="rezerva" desno>
                Rezerva
              </SortTh>
              <SortTh sort={sort} kljuc="stanje">
                Stanje
              </SortTh>
            </tr>
          </thead>
          <tbody>
            {sort.razvrsti(krovni).map((k) => {
              const razprt = razprti.has(k.krovni);
              const mesto = mestoKrovnega(k);
              return (
                <Fragment key={k.krovni}>
                  <tr
                    className={`cursor-pointer border-b border-ink-100 hover:bg-ink-50 ${razprt ? "bg-ink-50" : ""}`}
                    onClick={() => preklopi(k.krovni)}
                    title={razprt ? "Skrij material krovnega naloga" : "Pokaži material krovnega naloga"}
                    aria-expanded={razprt}
                  >
                    <td className="px-1 py-1.5 text-ink-500">
                      {razprt ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
                    </td>
                    <td className="px-2 py-1.5 font-mono font-semibold">{k.krovni}</td>
                    <td className="px-2 py-1.5 font-semibold" title="Glavne družine izdelkov na nalogih krovnega (normativi)">
                      {k.druzine.length ? k.druzine.join(", ") : <span className="font-normal text-ink-400">–</span>}
                    </td>
                    <td className="px-2 py-1.5">
                      {k.zacetek ? (
                        <>
                          <span className={`tabular-nums ${k.zacetek < danes ? "text-ink-500" : ""}`}>{formatShort(k.zacetek)}</span>
                          {mesto && <span className="block text-xs text-ink-500">{mesto}</span>}
                        </>
                      ) : (
                        <span className="text-xs text-ink-400">ni v planu</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 tabular-nums">{datumTxt(k.rok)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{k.nalogi.length}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {k.manjkajocih > 0 ? <b>{k.manjkajocih}</b> : <span className="text-ink-400">0</span>}
                      <span className="text-xs text-ink-400"> / {k.vrstice.length}</span>
                    </td>
                    <td className="px-2 py-1.5 tabular-nums">
                      {k.stanje === "zaloga" ? (
                        <span className="text-ok-600">v hiši</span>
                      ) : k.kompleten ? (
                        formatShort(k.kompleten)
                      ) : (
                        <span className="text-nok-600" title="Del materiala ni naročen ali dobava nima roka">
                          ni znano
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <Rezerva dni={k.rezerva} />
                    </td>
                    <td className="px-2 py-1.5">
                      <Znacka stanje={k.stanje} />
                    </td>
                  </tr>
                  {razprt && (
                    <tr className="border-b border-ink-200 bg-ink-100">
                      <td colSpan={10} className="px-3 py-3 sm:pl-10">
                        <MaterialKrovnega k={k} izvoz={izvoz(k)} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {krovni.length === 0 && (
              <tr>
                <td colSpan={10} className="px-2 py-6 text-center text-ink-500">
                  Ni krovnih nalogov za izbrane filtre.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TabelaOkvir>
    </div>
  );
}

type KljucVrstice = "ident" | "naziv" | "nalog" | "potrebno" | "zaloge" | "dobave" | "manjka" | "narocila" | "pride" | "stanje";

function MaterialKrovnega({ k, izvoz }: { k: KrovniPripravljenost; izvoz: IzvozFormat[] }) {
  const vrstice = k.vrstice.filter((v) => v.stanje !== "zaloga");
  const sort = useRazvrscanje<VrsticaPotrebe, KljucVrstice>({
    ident: (v) => v.ident,
    naziv: (v) => v.naziv,
    nalog: (v) => v.st_naloga,
    potrebno: (v) => v.potrebno,
    zaloge: (v) => v.izZaloge,
    dobave: (v) => v.dobave.reduce((s, d) => s + d.kolicina, 0),
    manjka: (v) => v.manjka,
    narocila: (v) => v.dobave[0]?.stevilka,
    pride: (v) => v.kompleten,
    stanje: (v) => -resnost(v.stanje),
  });
  const naZalogi = k.vrstice.length - vrstice.length;
  const privzeto = [...vrstice].sort((a, b) => resnost(b.stanje) - resnost(a.stanje) || a.ident.localeCompare(b.ident));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[min(100%,18rem)] flex-1 text-xs text-ink-600">
          <p>
            {k.vrstice.length} neizdanih vrstic materiala na {k.nalogi.length} nalogih:{" "}
            <b className="text-ok-600">{naZalogi} na zalogi</b>
            {vrstice.length > 0 && (
              <>
                {" "}
                · <b className="text-nok-600">{vrstice.length} ni na zalogi</b>
              </>
            )}
            {k.vrstice.length === 0 && " - ves material je izdan."}
          </p>
          <p className="mt-1">
            <span className="font-semibold">Nalogi: </span>
            {k.nalogi.map((n, i) => (
              <span key={n.st_naloga} title={n.naziv ?? ""}>
                {i > 0 && ", "}
                <span className="font-mono">{n.st_naloga}</span>
                {n.koda_artikla && <span className="text-ink-500"> {n.koda_artikla}</span>}
                {n.druzina && <span className="text-ink-500"> ({n.druzina})</span>}
              </span>
            ))}
          </p>
        </div>
        <Izvoz formati={izvoz} spomin="pripravljenost-krovni" label={`Izvoz krovnega ${k.krovni}`} />
      </div>
      {vrstice.length > 0 && (
        <div className="overflow-x-auto rounded-xl bg-white">
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="fp-thead" style={{ position: "static" }}>
              <tr className="text-left text-xs font-bold">
                <SortTh sort={sort} kljuc="ident">
                  Ident
                </SortTh>
                <SortTh sort={sort} kljuc="naziv">
                  Material
                </SortTh>
                <SortTh sort={sort} kljuc="nalog">
                  Nalog
                </SortTh>
                <SortTh sort={sort} kljuc="potrebno" desno hint="Razvrsti po neizdani količini">
                  Potrebno
                </SortTh>
                <SortTh sort={sort} kljuc="zaloge" desno>
                  Z zaloge
                </SortTh>
                <SortTh sort={sort} kljuc="dobave" desno>
                  Z dobave
                </SortTh>
                <SortTh sort={sort} kljuc="manjka" desno>
                  Ni naročeno
                </SortTh>
                <SortTh sort={sort} kljuc="narocila">
                  Naročilo · dobavitelj · rok
                </SortTh>
                <SortTh sort={sort} kljuc="pride">
                  Pride
                </SortTh>
                <SortTh sort={sort} kljuc="stanje">
                  Stanje
                </SortTh>
              </tr>
            </thead>
            <tbody>
              {(sort.kljuc ? sort.razvrsti(vrstice) : privzeto).map((v) => (
                <tr key={`${v.st_naloga}|${v.ident}`} className="border-b border-ink-100 last:border-0 hover:bg-ink-50">
                  <td className="px-2 py-1.5 font-mono">{v.ident}</td>
                  <td className="max-w-64 truncate px-2 py-1.5" title={v.naziv ?? ""}>
                    {v.naziv}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-ink-600">{v.st_naloga}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {kol(v.potrebno)} <span className="text-xs text-ink-400">{v.em}</span>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{v.izZaloge > 0 ? kol(v.izZaloge) : <span className="text-ink-300">0</span>}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {v.dobave.length ? kol(v.dobave.reduce((s, d) => s + d.kolicina, 0)) : <span className="text-ink-300">0</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {v.manjka > 0 ? <b className="text-nok-600">{kol(v.manjka)}</b> : <span className="text-ink-300">0</span>}
                  </td>
                  <td className="px-2 py-1.5 text-xs">
                    {v.dobave.map((d) => (
                      <span key={d.stevilka} className="block whitespace-nowrap">
                        <span className="font-mono">{d.stevilka}</span> · <span className="text-ink-600">{d.dobavitelj}</span> ·{" "}
                        <span className="tabular-nums">{datumTxt(d.rok)}</span> <VrstaRokaZnak vrsta={d.vrsta_roka} />
                      </span>
                    ))}
                  </td>
                  <td className="px-2 py-1.5 tabular-nums">{datumTxt(v.kompleten)}</td>
                  <td className="px-2 py-1.5">
                    <Znacka stanje={v.stanje} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// =====================================================================
// PO MATERIALU
// =====================================================================

type KljucMateriala = "ident" | "naziv" | "skupina" | "potrebno" | "zaloga" | "ostalo" | "naroceno" | "manjka" | "dobava" | "krovni" | "stanje";

function PoMaterialu({ material, danes }: { material: MaterialPripravljenost[]; danes: IsoDate }) {
  const { razprti, setRazprti, preklopi } = useRazprti();
  const sort = useRazvrscanje<MaterialPripravljenost, KljucMateriala>({
    ident: (m) => m.ident,
    naziv: (m) => m.naziv,
    skupina: (m) => m.skupina,
    potrebno: (m) => m.potrebno,
    zaloga: (m) => m.zaloga,
    ostalo: (m) => m.zalogaOstalo,
    naroceno: (m) => m.narocenoPostavke,
    manjka: (m) => m.manjka,
    dobava: (m) => naslednjaDobava(m.dobave, danes)?.rok,
    krovni: (m) => m.krovni.length,
    stanje: (m) => -resnost(m.stanje),
  });
  const vsi = material.length > 0 && material.every((m) => razprti.has(m.ident));

  return (
    <div className="fp-card flex flex-col gap-3 p-3 sm:p-4">
      <div className="flex flex-wrap items-start gap-3">
        <p className="min-w-[min(100%,18rem)] flex-1 text-sm text-ink-600">
          Material, ki ni na zalogi za vsaj en nalog. <b>Potrebno</b> je neizdana količina vseh aktivnih nalogov, <b>Ni naročeno</b>{" "}
          tisto, česar ne pokrijeta ne zaloga ne odprta naročila. Zaloga ostalih skladišč je samo informativna. Klik na vrstico pokaže
          naročila in naloge.
        </p>
        <RazpriGumb vsi={vsi} n={material.length} onClick={() => setRazprti(vsi ? new Set() : new Set(material.map((m) => m.ident)))} />
      </div>
      <TabelaOkvir>
        <table className="w-full min-w-[1080px] text-sm">
          <thead className="fp-thead">
            <tr className="text-left text-xs font-bold">
              <th className="w-8 px-1 py-2" aria-label="Razpri" />
              <SortTh sort={sort} kljuc="ident">
                Ident
              </SortTh>
              <SortTh sort={sort} kljuc="naziv">
                Material
              </SortTh>
              <SortTh sort={sort} kljuc="skupina">
                Skupina
              </SortTh>
              <SortTh sort={sort} kljuc="potrebno" desno>
                Potrebno
              </SortTh>
              <SortTh sort={sort} kljuc="zaloga" desno hint="Razvrsti po zalogi matičnega skladišča">
                Zaloga
              </SortTh>
              <SortTh sort={sort} kljuc="ostalo" desno hint="Razvrsti po zalogi ostalih skladišč (ne šteje)">
                Zaloga ostalo
              </SortTh>
              <SortTh sort={sort} kljuc="naroceno" desno hint="Razvrsti po odprtih naročilih">
                Naročeno
              </SortTh>
              <SortTh sort={sort} kljuc="manjka" desno>
                Ni naročeno
              </SortTh>
              <SortTh sort={sort} kljuc="dobava">
                Naslednja dobava
              </SortTh>
              <SortTh sort={sort} kljuc="krovni" hint="Razvrsti po številu čakajočih krovnih nalogov">
                Čaka krovnih
              </SortTh>
              <SortTh sort={sort} kljuc="stanje">
                Stanje
              </SortTh>
            </tr>
          </thead>
          <tbody>
            {sort.razvrsti(material).map((m) => {
              const razprt = razprti.has(m.ident);
              const nasl = naslednjaDobava(m.dobave, danes);
              const razlika = m.narocenoErp !== null && Math.abs(m.narocenoErp - m.narocenoPostavke) > 0.01;
              return (
                <Fragment key={m.ident}>
                  <tr
                    className={`cursor-pointer border-b border-ink-100 hover:bg-ink-50 ${razprt ? "bg-ink-50" : ""}`}
                    onClick={() => preklopi(m.ident)}
                    title={razprt ? "Skrij naročila in naloge" : "Pokaži naročila in naloge"}
                    aria-expanded={razprt}
                  >
                    <td className="px-1 py-1.5 text-ink-500">
                      {razprt ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
                    </td>
                    <td className="px-2 py-1.5 font-mono font-semibold">{m.ident}</td>
                    <td className="max-w-64 truncate px-2 py-1.5" title={m.naziv ?? ""}>
                      {m.naziv}
                    </td>
                    <td className="max-w-40 truncate px-2 py-1.5 text-xs text-ink-600" title={m.skupina ?? ""}>
                      {m.skupina}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {kol(m.potrebno)} <span className="text-xs text-ink-400">{m.em}</span>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{kol(m.zaloga)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink-400">{m.zalogaOstalo ? kol(m.zalogaOstalo) : ""}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {razlika && (
                        <span title={`ERP: naročeno ${kol(m.narocenoErp ?? 0)}, odprte postavke: ${kol(m.narocenoPostavke)}`}>
                          <AlertTriangle className="mr-1 inline h-3.5 w-3.5 text-warn-500" aria-label="Razlika z ERP" />
                        </span>
                      )}
                      {kol(m.narocenoPostavke)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {m.manjka > 0 ? <b className="text-nok-600">{kol(m.manjka)}</b> : <span className="text-ink-300">0</span>}
                    </td>
                    <td className="px-2 py-1.5 tabular-nums">
                      {nasl ? (
                        <>
                          {datumTxt(nasl.rok)} <VrstaRokaZnak vrsta={nasl.vrsta_roka} />
                        </>
                      ) : m.dobave.length ? (
                        <span className="text-warn-700" title="Vsa odprta naročila imajo rok v preteklosti ali ga nimajo">
                          zapadlo
                        </span>
                      ) : (
                        <span className="text-ink-400">–</span>
                      )}
                    </td>
                    <td className="max-w-48 truncate px-2 py-1.5 font-mono text-xs" title={m.krovni.join(", ")}>
                      {m.krovni.join(", ")}
                    </td>
                    <td className="px-2 py-1.5">
                      <Znacka stanje={m.stanje} />
                    </td>
                  </tr>
                  {razprt && (
                    <tr className="border-b border-ink-200 bg-ink-100">
                      <td colSpan={12} className="px-3 py-3 sm:pl-10">
                        <PodrobnostiMateriala m={m} danes={danes} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {material.length === 0 && (
              <tr>
                <td colSpan={12} className="px-2 py-6 text-center text-ink-500">
                  Ni materiala za izbrane filtre.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TabelaOkvir>
    </div>
  );
}

type KljucDobave = "stevilka" | "datum" | "dobavitelj" | "odprto" | "rok";
type KljucNaloga = "krovni" | "nalog" | "zacetek" | "potrebno" | "zaloge" | "dobave" | "manjka" | "pride" | "stanje";

function PodrobnostiMateriala({ m, danes }: { m: MaterialPripravljenost; danes: IsoDate }) {
  const sortD = useRazvrscanje<Dobava, KljucDobave>({
    stevilka: (d) => d.stevilka,
    datum: (d) => d.datum,
    dobavitelj: (d) => d.naziv_dobavitelja,
    odprto: (d) => d.odprto,
    rok: (d) => d.rok,
  });
  const sortN = useRazvrscanje<VrsticaPotrebe, KljucNaloga>({
    krovni: (v) => v.krovni,
    nalog: (v) => v.st_naloga,
    zacetek: (v) => v.zacetek,
    potrebno: (v) => v.potrebno,
    zaloge: (v) => v.izZaloge,
    dobave: (v) => v.dobave.reduce((s, d) => s + d.kolicina, 0),
    manjka: (v) => v.manjka,
    pride: (v) => v.kompleten,
    stanje: (v) => -resnost(v.stanje),
  });

  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold text-ink-700">
          Odprta naročila ({m.dobave.length})
          {m.narocenoErp !== null && (
            <span className="font-normal text-ink-500">
              {" "}
              · ERP naročeno {kol(m.narocenoErp)}, postavke {kol(m.narocenoPostavke)}
            </span>
          )}
        </p>
        {m.dobave.length === 0 ? (
          <p className="rounded-xl bg-white px-3 py-2 text-sm text-ink-500">Ni odprtih naročil.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl bg-white">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="fp-thead" style={{ position: "static" }}>
                <tr className="text-left text-xs font-bold">
                  <SortTh sort={sortD} kljuc="stevilka">
                    Naročilo
                  </SortTh>
                  <SortTh sort={sortD} kljuc="datum">
                    Datum
                  </SortTh>
                  <SortTh sort={sortD} kljuc="dobavitelj">
                    Dobavitelj
                  </SortTh>
                  <SortTh sort={sortD} kljuc="odprto" desno>
                    Odprto
                  </SortTh>
                  <SortTh sort={sortD} kljuc="rok">
                    Rok dobave
                  </SortTh>
                </tr>
              </thead>
              <tbody>
                {sortD.razvrsti(m.dobave).map((d, i) => (
                  <tr key={`${d.stevilka}-${i}`} className="border-b border-ink-100 last:border-0">
                    <td className="px-2 py-1.5 font-mono">{d.stevilka}</td>
                    <td className="px-2 py-1.5 tabular-nums">{datumTxt(d.datum)}</td>
                    <td className="max-w-48 truncate px-2 py-1.5" title={d.naziv_dobavitelja ?? ""}>
                      {d.naziv_dobavitelja}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {kol(d.odprto)}
                      {d.prevzeto > 0 && <span className="text-xs text-ink-400"> / {kol(d.kolicina)}</span>}
                    </td>
                    <td className={`px-2 py-1.5 tabular-nums ${d.rok && d.rok < danes ? "font-semibold text-warn-700" : ""}`}>
                      {datumTxt(d.rok)} <VrstaRokaZnak vrsta={d.vrsta_roka} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold text-ink-700">Nalogi, ki čakajo material ({m.vrstice.length})</p>
        <div className="overflow-x-auto rounded-xl bg-white">
          <table className="w-full min-w-[620px] text-sm">
            <thead className="fp-thead" style={{ position: "static" }}>
              <tr className="text-left text-xs font-bold">
                <SortTh sort={sortN} kljuc="krovni">
                  Krovni
                </SortTh>
                <SortTh sort={sortN} kljuc="nalog">
                  Nalog
                </SortTh>
                <SortTh sort={sortN} kljuc="zacetek">
                  Začetek
                </SortTh>
                <SortTh sort={sortN} kljuc="potrebno" desno>
                  Potrebno
                </SortTh>
                <SortTh sort={sortN} kljuc="zaloge" desno>
                  Z zaloge
                </SortTh>
                <SortTh sort={sortN} kljuc="dobave" desno>
                  Z dobave
                </SortTh>
                <SortTh sort={sortN} kljuc="manjka" desno>
                  Ni naročeno
                </SortTh>
                <SortTh sort={sortN} kljuc="pride">
                  Pride
                </SortTh>
                <SortTh sort={sortN} kljuc="stanje">
                  Stanje
                </SortTh>
              </tr>
            </thead>
            <tbody>
              {sortN.razvrsti(m.vrstice).map((v) => (
                <tr key={`${v.st_naloga}`} className="border-b border-ink-100 last:border-0">
                  <td className="px-2 py-1.5 font-mono font-semibold">{v.krovni}</td>
                  <td className="px-2 py-1.5 font-mono text-ink-600">{v.st_naloga}</td>
                  <td className="px-2 py-1.5 tabular-nums">{v.zacetek ? formatShort(v.zacetek) : <span className="text-xs text-ink-400">ni v planu</span>}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{kol(v.potrebno)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{kol(v.izZaloge)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{kol(v.dobave.reduce((s, d) => s + d.kolicina, 0))}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {v.manjka > 0 ? <b className="text-nok-600">{kol(v.manjka)}</b> : <span className="text-ink-300">0</span>}
                  </td>
                  <td className="px-2 py-1.5 tabular-nums">{datumTxt(v.kompleten)}</td>
                  <td className="px-2 py-1.5">
                    <Znacka stanje={v.stanje} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
