// Izvoz Pripravljenosti materiala v Excel in besedilo (.txt): skupni pregled krovnih, vse vrstice in posamezni krovni.
import * as XLSX from "xlsx";
import { formatShort, type IsoDate } from "./dates";
import { KRATKA_VRSTA_ROKA } from "./dobave";
import { asciiIme, prenesiDatoteko } from "./prenos";
import { OPIS_STANJA_MAT, kompletenTxt, materialKrovnega, prihodTxt, naslednjaDobava, type KrovniPripravljenost, type MaterialPripravljenost } from "./pripravljenost";

type Celica = string | number | null;
type Vrstice = Record<string, Celica>[];
export type List = { ime: string; vrstice: Vrstice };

const dat = (d: IsoDate | null) => (d ? formatShort(d) : "");
const kol = (n: number) => Math.round(n * 1000) / 1000;

/** Začetek in mesto krovnega (oddelek · celica) - pripravi stran. */
export type MestoKrovnega = (k: KrovniPripravljenost) => string;

export const druzineTxt = (k: KrovniPripravljenost) => k.druzine.join(", ");

// ---------------------------------------------------------------------
// Vsebina
// ---------------------------------------------------------------------

/** En krovni = ena vrstica. */
export const vrsticeKrovnih = (krovni: KrovniPripravljenost[], mesto: MestoKrovnega): Vrstice =>
  krovni.map((k) => ({
    Krovni: k.krovni,
    Družina: druzineTxt(k),
    "Začetek v planu": dat(k.zacetek),
    "Oddelek · celica": mesto(k),
    Rok: dat(k.rok),
    Nalogov: k.nalogi.length,
    "Ni na zalogi": k.manjkajocih,
    "Vrstic materiala": k.vrstice.length,
    "Material kompleten": kompletenTxt(k, dat),
    "Rezerva (dni)": k.rezerva,
    Stanje: OPIS_STANJA_MAT[k.stanje],
  }));

/** Vse vrstice materiala (nalog × ident) prikazanih krovnih, tudi tiste na zalogi. */
export const vseVrstice = (krovni: KrovniPripravljenost[], danes: IsoDate): Vrstice =>
  krovni.flatMap((k) =>
    k.vrstice.map((v) => ({
      Krovni: k.krovni,
      Družina: druzineTxt(k),
      Nalog: v.st_naloga,
      Ident: v.ident,
      Material: v.naziv,
      EM: v.em,
      Potrebno: kol(v.potrebno),
      "Z zaloge": kol(v.izZaloge),
      "Z dobave": kol(v.dobave.reduce((s, d) => s + d.kolicina, 0)),
      "Ni naročeno": kol(v.manjka),
      Naročila: v.dobave.map((d) => `${d.stevilka} ${d.dobavitelj ?? ""} ${d.rok ? formatShort(d.rok) : "brez roka"}`).join("; "),
      Pride: prihodTxt({ ...v, imaDobave: v.dobave.length > 0 }, danes, formatShort),
      Stanje: OPIS_STANJA_MAT[v.stanje],
    })),
  );

/** Material krovnega po identu (kot na PDF / TV). */
export const vrsticeMaterialaKrovnega = (k: KrovniPripravljenost, danes: IsoDate): Vrstice =>
  materialKrovnega(k).map((m) => ({
    Ident: m.ident,
    Material: m.naziv,
    EM: m.em,
    Potrebno: kol(m.potrebno),
    "Z zaloge": kol(m.izZaloge),
    "Z dobave": kol(m.naDobavi),
    "Ni naročeno": kol(m.manjka),
    Naročila: m.narocila
      .map((d) => `${d.stevilka} ${d.dobavitelj ?? ""} ${kol(d.kolicina)} ${d.rok ? formatShort(d.rok) : "brez roka"}${d.vrsta_roka ? ` (${KRATKA_VRSTA_ROKA[d.vrsta_roka]})` : ""}`)
      .join("; "),
    Prihod: prihodTxt({ ...m, imaDobave: m.narocila.length > 0 }, danes, formatShort),
    Stanje: OPIS_STANJA_MAT[m.stanje],
  }));

export const vrsticeMateriala = (material: MaterialPripravljenost[], danes: IsoDate): Vrstice =>
  material.map((m) => {
    const nasl = naslednjaDobava(m.dobave, danes);
    return {
      Ident: m.ident,
      Material: m.naziv,
      Skupina: m.skupina,
      EM: m.em,
      Potrebno: kol(m.potrebno),
      "Zaloga (matično)": kol(m.zaloga),
      "Zaloga ostalo (ne šteje)": kol(m.zalogaOstalo),
      "Naročeno (ERP)": m.narocenoErp,
      "Naročeno (postavke)": kol(m.narocenoPostavke),
      Manjka: kol(m.manjka),
      "Naslednja dobava": nasl?.rok ? formatShort(nasl.rok) : "",
      "Krovni nalogi": m.krovni.join(", "),
      Stanje: OPIS_STANJA_MAT[m.stanje],
    };
  });

/** Glava posameznega krovnega (prve vrstice besedila / lista). */
export const glavaKrovnega = (k: KrovniPripravljenost, mesto: string): [string, string][] => [
  ["Krovni nalog", k.krovni],
  ["Družina", druzineTxt(k) || "-"],
  ["Nalogi", k.nalogi.map((n) => `${n.st_naloga}${n.koda_artikla ? ` (${n.koda_artikla})` : ""}`).join(", ")],
  ["Začetek v planu", k.zacetek ? `${formatShort(k.zacetek)}${mesto ? ` · ${mesto}` : ""}` : "ni v planu"],
  ["Material kompleten", kompletenTxt(k, formatShort, "ves material je v hiši")],
  ["Rezerva", k.rezerva === null ? "-" : `${k.rezerva > 0 ? "+" : ""}${k.rezerva} dni`],
  ["Stanje", OPIS_STANJA_MAT[k.stanje]],
];

// ---------------------------------------------------------------------
// Formati
// ---------------------------------------------------------------------

export function prenesiXlsx(listi: List[], ime: string) {
  const wb = XLSX.utils.book_new();
  for (const l of listi) {
    const ws = l.vrstice.length ? XLSX.utils.json_to_sheet(l.vrstice) : XLSX.utils.aoa_to_sheet([["Ni vrstic"]]);
    XLSX.utils.book_append_sheet(wb, ws, l.ime.replace(/[\\/?*[\]:]/g, " ").slice(0, 31));
  }
  XLSX.writeFile(wb, `${asciiIme(ime)}.xlsx`);
}

/** Tabela kot poravnano besedilo (stolpci ločeni z dvema presledkoma, številke desno). */
export function tabelaTxt(vrstice: Vrstice): string {
  if (!vrstice.length) return "(ni vrstic)";
  const stolpci = Object.keys(vrstice[0]);
  const txt = (c: Celica) => (c === null || c === undefined ? "" : typeof c === "number" ? String(c).replace(".", ",") : String(c));
  const sirine = stolpci.map((s) => Math.min(60, Math.max(s.length, ...vrstice.map((v) => txt(v[s]).length))));
  const stevilski = stolpci.map((s) => vrstice.every((v) => v[s] === null || typeof v[s] === "number"));
  const vrsta = (celice: string[]) =>
    celice
      .map((c, i) => {
        const t = c.length > sirine[i] ? `${c.slice(0, sirine[i] - 1)}…` : c;
        return stevilski[i] ? t.padStart(sirine[i]) : t.padEnd(sirine[i]);
      })
      .join("  ")
      .trimEnd();
  return [vrsta(stolpci), sirine.map((w) => "-".repeat(w)).join("  "), ...vrstice.map((v) => vrsta(stolpci.map((s) => txt(v[s]))))].join("\r\n");
}

/** Besedilo z naslovom in razdelki (vsak razdelek: naslov + glava ključ: vrednost in/ali tabela). */
export function prenesiTxt(
  naslov: string,
  razdelki: { naslov?: string; glava?: [string, string][]; vrstice?: Vrstice }[],
  ime: string,
) {
  const deli = [naslov, "=".repeat(naslov.length)];
  for (const r of razdelki) {
    deli.push("");
    if (r.naslov) deli.push(r.naslov, "-".repeat(r.naslov.length));
    if (r.glava) {
      const w = Math.max(...r.glava.map(([k]) => k.length));
      deli.push(...r.glava.map(([k, v]) => `${`${k}:`.padEnd(w + 2)}${v}`));
      if (r.vrstice) deli.push("");
    }
    if (r.vrstice) deli.push(tabelaTxt(r.vrstice));
  }
  // BOM: Beležnica in Excel pravilno prikažeta č, š, ž
  prenesiDatoteko(new Blob(["﻿" + deli.join("\r\n") + "\r\n"], { type: "text/plain;charset=utf-8" }), `${asciiIme(ime)}.txt`);
}
