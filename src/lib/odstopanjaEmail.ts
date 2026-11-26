// Odstopanje krovnega: PDF (vse podrobnosti) in e-mail za Outlook (.eml, X-Unsent - prejemnik prazen, vpiše ga
// uporabnik) s samo pomembnimi podatki in PDF v priponki. Ločen modul: naloži se šele ob kliku (pdf-lib).
import { formatShort } from "./dates";
import type { OddelekKoda } from "./normativi";
import { OPIS_OPORTUNITETNEGA, izracunajStrosek, type Postavke } from "./odstopanjaKrovnih";
import { Pisec, SIRINA, SIVA, URL_APLIKACIJE, PISAVA, esc, prenesiDatoteko, prenesiEmail } from "./porociloPdf";
import { asciiIme } from "./prenos";
import { formatEur } from "./produktivnost";
import type { KrovniZakljucen } from "./produktivnostPlana";
import { formatNum, formatUre } from "./stevila";

export type OdstopanjeIzvoz = {
  k: KrovniZakljucen;
  oddelek: OddelekKoda;
  oddelekNaziv: string;
  celica: string;
  postavke: Postavke;
  vzrok: string | null;
  razlaga: string;
};

const ZELENA = "#16a34a";
const RDECA = "#dc2626";
const fmtPct = (p: number | null) => (p === null ? "–" : `${Math.round(p * 100)} %`);
const urH = (n: number) => `${n > 0 ? "+" : ""}${formatUre(n)} h`;
const ime = (d: OdstopanjeIzvoz) => asciiIme(`Odstopanje_krovni_${d.k.krovni}_${d.oddelek}`);

// =====================================================================
// PDF - vse podrobnosti
// =====================================================================

export async function ustvariOdstopanjePdf(d: OdstopanjeIzvoz): Promise<Blob> {
  const { k, postavke: p } = d;
  const s = izracunajStrosek(k, p);
  const prihranek = s.razlika < 0;
  const w = await Pisec.ustvari(`Odstopanje krovnega ${k.krovni}`);

  w.glava("Odstopanje krovnega od normativa");
  w.naslov(
    `Krovni ${k.krovni} · ${prihranek ? "prihranek" : "odstopanje"} ${urH(s.razlika)} · ${formatEur(Math.abs(s.skupaj))}`,
    `${d.oddelekNaziv} · ${d.celica} · zaključen ${formatShort(k.zakljucen)}`,
  );

  w.razdelek("Povzetek", "podatki");
  w.pari([
    ["Normativ", `${formatUre(k.normUre)} h`],
    ["Štempljano", `${formatUre(k.ure)} h`],
    ["Razlika", `${urH(s.razlika)} (${prihranek ? "manj" : "več"} od normativa)`],
    ["Produktivnost", fmtPct(k.produktivnost)],
    [prihranek ? "Prihranek" : "Strošek", formatEur(Math.abs(s.skupaj))],
    ["Vzrok", d.vzrok ?? "–"],
  ]);
  if (k.ureBrezNormativa > 0.05) w.besedilo(`Poleg tega ${formatUre(k.ureBrezNormativa)} h na nalogih brez normativa (niso v izračunu).`, undefined, SIVA);

  w.razdelek(prihranek ? "Prihranek (manj ur od normativa)" : "Strošek ur nad normativom", "matrika", 90);
  const h = formatUre(Math.abs(s.razlika));
  w.tabela(
    [
      { naslov: "Postavka", sirina: 200 },
      { naslov: "Izračun", sirina: SIRINA - 320 },
      { naslov: "Znesek", sirina: 100, desno: true },
    ],
    [
      { celice: ["Delo", `${h} h × ${formatNum(p.cenaDela)} €/h`, formatEur(Math.abs(s.delo))] },
      { celice: ["Delovno mesto / stroj", `${h} h × ${formatNum(p.cenaDelovnegaMesta)} €/h`, formatEur(Math.abs(s.delovnoMesto))] },
      { celice: ["Oportunitetni strošek (izgubljen dobiček)", `${h} h × ${formatNum(p.oportunitetni)} €/h`, formatEur(Math.abs(s.oportunitetni))] },
      { celice: [prihranek ? "Prihranek skupaj" : "Skupaj", "", formatEur(Math.abs(s.skupaj))], poudari: [0, 2] },
    ],
  );
  w.besedilo(OPIS_OPORTUNITETNEGA, undefined, SIVA);

  w.razdelek("Razlaga", "zapisnik");
  if (d.razlaga.trim()) for (const vrstica of d.razlaga.trim().split(/\r?\n/)) w.besedilo(vrstica || " ");
  else w.besedilo("Razlaga ni vpisana.", undefined, SIVA);

  const steti = k.nalogi.filter((n) => !n.izlocen);
  const izloceni = k.nalogi.filter((n) => n.izlocen);
  w.razdelek("Nalogi krovnega", "akcije", 60, `${steti.length}`);
  w.tabela(
    [
      { naslov: "Nalog", sirina: 52 },
      { naslov: "Izdelek", sirina: SIRINA - 302 },
      { naslov: "Kos", sirina: 36, desno: true },
      { naslov: "Normativ", sirina: 62, desno: true },
      { naslov: "Štempljano", sirina: 66, desno: true },
      { naslov: "Produkt.", sirina: 56, desno: true },
    ],
    steti.map((n) => ({
      celice: [
        n.st,
        n.naziv ?? n.ident ?? "",
        formatNum(n.kos),
        n.normUre === null ? "–" : `${formatUre(n.normUre)} h`,
        `${formatUre(n.ure)} h`,
        n.normUre === null ? "ni norm." : fmtPct(n.produktivnost),
      ],
      poudari: [5],
    })),
  );
  if (izloceni.length)
    w.besedilo(
      `Ni šteto (brez štempljanja v oddelku ali brez kosov): ${izloceni.map((n) => n.st).join(", ")}.`,
      undefined,
      SIVA,
    );

  return w.koncaj(`FINES d.o.o. | Production | Odstopanje krovnega ${k.krovni}`);
}

export async function prenesiOdstopanjePdf(d: OdstopanjeIzvoz) {
  prenesiDatoteko(await ustvariOdstopanjePdf(d), `${ime(d)}.pdf`);
}

// =====================================================================
// E-MAIL - samo pomembno (krovni, ure, strošek, nalogi), podrobnosti v PDF priponki
// =====================================================================

// Sporočilo kot navaden e-mail (odstavki in alineje, brez tabel) - v Outlooku / Wordu se ureja kot besedilo.
// Na vrhu "Pozdravljeni," in prazne vrstice za uvod, na koncu "Lep pozdrav," in prostor za podpis.
export async function prenesiEmailOdstopanja(d: OdstopanjeIzvoz) {
  const { k, postavke: p } = d;
  const s = izracunajStrosek(k, p);
  const prihranek = s.razlika < 0;
  const barva = prihranek ? ZELENA : RDECA;
  const zadeva = `${prihranek ? "Prihranek" : "Odstopanje"} krovni ${k.krovni} · ${d.oddelekNaziv}: ${urH(s.razlika)}, ${formatEur(Math.abs(s.skupaj))}`;

  const h = (n: number) => `${esc(formatUre(n))} h`;
  const b = (t: string) => `<b>${t}</b>`;
  const poudari = (t: string) => `<b style="color:${barva}">${t}</b>`;
  const odstotek = k.normUre > 0 ? Math.round((Math.abs(s.razlika) / k.normUre) * 100) : null;
  const prazno = `<p style="margin:0">&nbsp;</p>`;
  const odst = (t: string) => `<p style="margin:0 0 12px">${t}</p>`;
  const alineje = (vrstice: string[]) => `<ul style="margin:0 0 12px">${vrstice.map((v) => `<li style="margin:0 0 4px">${v}</li>`).join("")}</ul>`;
  const zakljucen = formatShort(k.zakljucen);

  const uvod = prihranek
    ? `sporočam vam, da je bil krovni nalog ${b(esc(k.krovni))} (${esc(d.oddelekNaziv)}, ${esc(d.celica)}), zaključen ${esc(zakljucen)}, narejen v manj urah, kot predvideva normativ.`
    : `sporočam vam, da smo pri krovnem nalogu ${b(esc(k.krovni))} (${esc(d.oddelekNaziv)}, ${esc(d.celica)}), zaključenem ${esc(zakljucen)}, porabili več ur, kot predvideva normativ.`;
  const ure =
    `Normativ je bil ${b(h(k.normUre))}, štempljanih je bilo ${b(h(k.ure))} - to je ${poudari(`${h(Math.abs(s.razlika))}${odstotek !== null ? ` (${odstotek} %)` : ""}`)} ` +
    `${prihranek ? "manj" : "več"} od normativa. Produktivnost je bila ${b(esc(fmtPct(k.produktivnost)))}.`;
  const strosek = alineje([
    `delo: ${h(Math.abs(s.razlika))} × ${esc(formatNum(p.cenaDela))} €/h = ${b(esc(formatEur(Math.abs(s.delo))))}`,
    `delovno mesto / stroj: ${h(Math.abs(s.razlika))} × ${esc(formatNum(p.cenaDelovnegaMesta))} €/h = ${b(esc(formatEur(Math.abs(s.delovnoMesto))))}`,
    `izgubljen dobiček (oportunitetni strošek): ${h(Math.abs(s.razlika))} × ${esc(formatNum(p.oportunitetni))} €/h = ${b(esc(formatEur(Math.abs(s.oportunitetni))))}`,
  ]);
  const nalogi = alineje(
    k.nalogi
      .filter((n) => !n.izlocen)
      .map(
        (n) =>
          `${b(esc(n.st))} - ${esc(n.naziv ?? n.ident ?? "")} (${esc(formatNum(n.kos))} kos): ` +
          (n.normUre === null ? `ni normativa, štempljano ${h(n.ure)}` : `normativ ${h(n.normUre)}, štempljano ${h(n.ure)}`),
      ),
  );
  const povezava = `${URL_APLIKACIJE}/proizvodnja/zasedenost/produktivnost?oddelek=${d.oddelek}`;

  const html =
    `<html><head><meta charset="utf-8"></head><body style="font-family:Calibri,Arial,sans-serif;font-size:${PISAVA};color:#1f2328">` +
    odst("Pozdravljeni,") +
    prazno +
    prazno +
    odst(uvod) +
    odst(ure) +
    odst(`${prihranek ? "Prihranek" : "Strošek odstopanja"} ocenjujemo na ${poudari(esc(formatEur(Math.abs(s.skupaj))))}:`) +
    strosek +
    (d.vzrok ? odst(`Vzrok: ${b(esc(d.vzrok))}.`) : "") +
    (d.razlaga.trim() ? odst(`Razlaga: ${esc(d.razlaga.trim()).replace(/\r?\n/g, "<br>")}`) : "") +
    odst("Nalogi krovnega:") +
    nalogi +
    odst(`Izračun in podrobnosti so v priponki (PDF), pregled je tudi v aplikaciji: <a href="${esc(povezava)}">Zaključeni krovni</a>.`) +
    prazno +
    `<p style="margin:0">Lep pozdrav,</p>` +
    prazno +
    `</body></html>`;

  await prenesiEmail(zadeva, html, await ustvariOdstopanjePdf(d), `${ime(d)}.pdf`, `${ime(d)}.eml`);
}
