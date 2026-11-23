// PDF izvoz strani Prioritete (A4 pokončno, skupna oblika porociloPdf.ts): za vsak zavihek isto, kot je na zaslonu
// (isti filtri in razvrščanje kot Excel), samo stolpci, ki so berljivi na papirju. Naloži se šele ob kliku.
import { formatDayMonth, formatShort, isoWeek, type IsoDate } from "./dates";
import { ODDELKI_NORMATIVA } from "./normativi";
import { Pisec, asciiIme, prenesiDatoteko, type Stolpec, type Vrstica } from "./porociloPdf";
import {
  STATUS,
  krovniPostavke,
  opisDelov,
  steviloNalogov,
  type ArtikelPregled,
  type KrovniSkupina,
  type NalogPrioriteta,
  type PostavkaIzracun,
  type PostavkaUre,
} from "./prioritete";
import { formatNum, formatUre } from "./stevila";

const kol = (k: number) => formatNum(Math.round(k * 100) / 100);
/** Kratek datum v tabelah ("25. 11.") - ne prelomi se. */
const dat = (d: IsoDate | null) => (d ? formatDayMonth(d) : "–");
const narocila = (n: NalogPrioriteta) => n.dodelitve.map((d) => `${kol(d.kolicina)}× ${d.partner ?? d.stevilka} (${dat(d.datum)})`).join("; ");

async function zapisi(naslov: string, podnaslov: string, telo: (p: Pisec) => void, ime: string) {
  const p = await Pisec.ustvari(naslov);
  p.glava("Prioritete");
  p.naslov(naslov, podnaslov);
  telo(p);
  prenesiDatoteko(await p.koncaj(`FINES d.o.o. | Prioritete | ${naslov}`), `${asciiIme(ime)}.pdf`);
}

/** Zavihek "Odpreme po tednih" - razdelek na teden. */
export async function prenesiOdpremePdf(postavke: PostavkaIzracun[], danes: IsoDate, ime: string) {
  const stolpci: Stolpec[] = [
    { naslov: "Odprema", sirina: 36 },
    { naslov: "Naročilo", sirina: 52 },
    { naslov: "Partner", sirina: 80 },
    { naslov: "IDENT / naziv", sirina: 130 },
    { naslov: "Kol.", sirina: 28, desno: true },
    { naslov: "Status", sirina: 50 },
    { naslov: "Pokritje", sirina: 140 },
  ];
  const tedni = new Map<string, PostavkaIzracun[]>();
  for (const p of postavke) {
    const k = p.teden ?? "";
    tedni.set(k, [...(tedni.get(k) ?? []), p]);
  }
  const kosov = postavke.reduce((s, p) => s + p.kolicina, 0);
  await zapisi(
    "Odpreme po tednih",
    `Stanje ${formatShort(danes)} · ${postavke.length} postavk · ${kol(kosov)} kos`,
    (pdf) => {
      for (const [teden, vrste] of tedni) {
        const vrstice: Vrstica[] = vrste.map((p) => ({
          celice: [
            dat(p.datum_odpreme),
            p.stevilka,
            [p.partner, p.lokacija].filter(Boolean).join(" · "),
            `${p.ident}\n${p.opis ?? ""}`,
            kol(p.kolicina),
            STATUS[p.status].label,
            [opisDelov(p.deli), krovniPostavke(p).length ? `Krovni ${krovniPostavke(p).join(", ")}` : ""].filter(Boolean).join("\n"),
          ],
        }));
        const naslov = teden ? `Teden ${isoWeek(teden)} · od ${formatShort(teden)}` : "Brez datuma odpreme";
        pdf.razdelek(naslov, "podatki", Math.min(pdf.visinaTabele(stolpci, vrstice.slice(0, 3)), 120), `${vrste.length} postavk`);
        pdf.tabela(stolpci, vrstice);
      }
    },
    ime,
  );
}

const STOLPCI_NALOGOV: Stolpec[] = [
  { naslov: "Nalog", sirina: 54 },
  { naslov: "Krovni", sirina: 38 },
  { naslov: "IDENT / naziv", sirina: 118 },
  { naslov: "Rok", sirina: 38 },
  { naslov: "Prva odprema", sirina: 48 },
  { naslov: "Odprto", sirina: 38, desno: true },
  { naslov: "Prodano", sirina: 42, desno: true },
  { naslov: "Predlog / naročila", sirina: 156 },
];
const vrsticaNaloga = (n: NalogPrioriteta): Vrstica => ({
  celice: [
    n.st_naloga,
    n.krovni_dn ?? "–",
    `${n.ident}\n${n.opis ?? ""}`,
    dat(n.rok),
    dat(n.prvaPotreba),
    kol(n.preostala),
    kol(n.prodano),
    [n.predlog, narocila(n)].filter(Boolean).join("\n"),
  ],
});

/** Zavihek "Prioritete nalogov" - razdelka Zamuja in Po prvi odpremi. */
export async function prenesiNalogePdf(nalogi: NalogPrioriteta[], danes: IsoDate, ime: string) {
  const zamuja = nalogi.filter((n) => n.zamuja);
  const ostali = nalogi.filter((n) => !n.zamuja);
  await zapisi(
    "Prioritete nalogov",
    `Stanje ${formatShort(danes)} · ${steviloNalogov(nalogi.length)}${zamuja.length ? ` · ${zamuja.length} zamuja` : ""}`,
    (pdf) => {
      for (const [naslov, del] of [
        ["Zamuja", zamuja],
        ["Po prvi odpremi", ostali],
      ] as const) {
        if (!del.length) continue;
        const vrstice = del.map(vrsticaNaloga);
        pdf.razdelek(naslov, "akcije", Math.min(pdf.visinaTabele(STOLPCI_NALOGOV, vrstice.slice(0, 3)), 120), steviloNalogov(del.length));
        pdf.tabela(STOLPCI_NALOGOV, vrstice);
      }
    },
    ime,
  );
}

/** Zavihek "Prioritete nalogov" po krovnih - skupina na krovni nalog. */
export async function prenesiKrovnePdf(skupine: KrovniSkupina[], danes: IsoDate, ime: string) {
  const stolpci: Stolpec[] = [
    { naslov: "Nalog", sirina: 54 },
    { naslov: "IDENT / naziv", sirina: 130 },
    { naslov: "Prva odprema", sirina: 48 },
    { naslov: "Odprto", sirina: 38, desno: true },
    { naslov: "Prodano", sirina: 42, desno: true },
    { naslov: "Naročila", sirina: 132 },
    { naslov: "Zamuja", sirina: 62 },
  ];
  const vsi = skupine.flatMap((k) => k.nalogi);
  const vrstice: Vrstica[] = skupine.flatMap((k) => [
    {
      skupina: `${k.krovni ? `Krovni ${k.krovni}` : `Brez krovnega · ${k.nalogi[0].st_naloga}`} · prva odprema ${dat(k.prvaOdprema)} · ${steviloNalogov(k.nalogi.length)}, ${kol(k.odprto)} kos${k.zamuja ? ` · ${k.zamuja} zamuja` : ""}`,
    },
    ...k.nalogi.map((n) => ({
      celice: [
        n.st_naloga,
        `${n.ident}\n${n.opis ?? ""}`,
        dat(n.prvaPotreba),
        kol(n.preostala),
        kol(n.prodano),
        narocila(n),
        n.zamuja ? `Zamuja (rok ${dat(n.rok)})` : "",
      ],
      ...(n.zamuja ? { poudari: [6] } : {}),
    })),
  ]);
  await zapisi(
    "Prioritete po krovnih nalogih",
    `Stanje ${formatShort(danes)} · ${skupine.filter((k) => k.krovni).length} krovnih · ${steviloNalogov(vsi.length)} · ${kol(vsi.reduce((s, n) => s + n.preostala, 0))} kos odprto`,
    (pdf) => {
      pdf.razdelek("Krovni nalogi", "akcije", 80, `${skupine.length}`);
      pdf.tabela(stolpci, vrstice);
    },
    ime,
  );
}

/** Zavihek "Po artiklih". */
export async function prenesiArtiklePdf(artikli: ArtikelPregled[], danes: IsoDate, ime: string) {
  const stolpci: Stolpec[] = [
    { naslov: "IDENT / naziv", sirina: 130 },
    { naslov: "Status", sirina: 50 },
    { naslov: "Zaloga", sirina: 38, desno: true },
    { naslov: "Prosta", sirina: 38, desno: true },
    { naslov: "Naročeno", sirina: 50, desno: true },
    { naslov: "Iz zaloge", sirina: 40, desno: true },
    { naslov: "Iz proizv.", sirina: 42, desno: true },
    { naslov: "Manjka", sirina: 40, desno: true },
    { naslov: "Zaloga do", sirina: 40 },
    { naslov: "Nalogi", sirina: 94 },
  ];
  const vrstice: Vrstica[] = artikli.map((a) => ({
    celice: [
      `${a.ident}\n${a.opis ?? ""}`,
      STATUS[a.status].label,
      kol(a.zaloga),
      kol(a.prosta_zaloga),
      kol(a.naroceno),
      kol(a.izZaloge),
      kol(a.izProizvodnje),
      a.manjka ? kol(a.manjka) : "",
      dat(a.zalogaDo),
      a.nalogi.map((n) => `${n.st_naloga} (${kol(n.preostala)} kos, rok ${dat(n.rok)})`).join("\n"),
    ],
    ...(a.manjka ? { poudari: [7] } : {}),
  }));
  await zapisi(
    "Prioritete po artiklih",
    `Stanje ${formatShort(danes)} · ${artikli.length} artiklov`,
    (pdf) => {
      pdf.razdelek("Artikli", "paket", 80, `${artikli.length}`);
      pdf.tabela(stolpci, vrstice);
    },
    ime,
  );
}

/** Zavihek "Zasedenost naročil" - ure po normativu za izbran teden. */
export async function prenesiUreNarocilPdf(vrste: PostavkaUre[], izbor: string, ime: string) {
  const stolpci: Stolpec[] = [
    { naslov: "Potrebno do", sirina: 40 },
    { naslov: "Naročilo / kupec", sirina: 90 },
    { naslov: "IDENT / naziv", sirina: 130 },
    { naslov: "Narediti", sirina: 40, desno: true },
    ...ODDELKI_NORMATIVA.map((o) => ({ naslov: `${o.koda} h`, sirina: 30, desno: true })),
    { naslov: "Skupaj h", sirina: 36, desno: true },
  ];
  const vrstice: Vrstica[] = vrste.map(({ p, narediti, potrebnoDo, normativ, ure, ureSkupaj }) => ({
    celice: [
      dat(potrebnoDo),
      `${p.stevilka}\n${p.partner ?? ""}`,
      `${p.ident}\n${p.opis ?? ""}`,
      kol(narediti),
      ...ODDELKI_NORMATIVA.map((o) => (normativ ? formatUre(ure[o.koda]) : "")),
      normativ ? formatUre(ureSkupaj) : "ni normativa",
    ],
    poudari: [3 + ODDELKI_NORMATIVA.length + 1],
  }));
  const sk = (f: (u: PostavkaUre) => number) => formatUre(vrste.reduce((s, u) => s + (u.normativ ? f(u) : 0), 0));
  vrstice.push({ skupina: `Skupaj · ${ODDELKI_NORMATIVA.map((o) => `${o.label} ${sk((u) => u.ure[o.koda])} h`).join(" · ")} · vse ${sk((u) => u.ureSkupaj)} h` });
  await zapisi(
    "Zasedenost naročil",
    `${izbor} · ${vrste.length} postavk · ${sk((u) => u.ureSkupaj)} h po normativu`,
    (pdf) => {
      pdf.razdelek("Postavke z urami", "matrika", 80, `${vrste.length}`);
      pdf.tabela(stolpci, vrstice);
    },
    ime,
  );
}
