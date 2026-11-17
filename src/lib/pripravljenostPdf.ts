// PDF "Pripravljenost materiala" (izvoz in FIN:TV): stran 16:9 na krovni nalog - velika lista materiala, ki ni na zalogi
// (šifra, material, količina, naročilo, prihod, stanje). Krovni, ki imajo ves material v hiši, so na zbirni strani
// (TV ne vrti praznih strani). Preveč vrstic za eno stran -> nadaljevanje na naslednji. Oblika: porociloPdf.ts.
import { rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { formatShort, type IsoDate } from "./dates";
import { KRATKA_VRSTA_ROKA } from "./dobave";
import { asciiIme, prenesiDatoteko } from "./prenos";
import { BELA, GLAVA_TABELE, SIVA, TEMNA, glavaStrani, noga, novDokument, zaobljen, type Pisave } from "./porociloPdf";
import { OPIS_STANJA_MAT, materialKrovnega, type MaterialKrovnega, type StanjeMateriala } from "./pripravljenost";
import type { KrovniNaListu } from "./pripravljenostPodatki";
import { formatNum } from "./stevila";

const W = 960;
const H = 540;
const ROB = 28;

const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const ROB_KARTICE = hex("#e1e4e8");
const CRTA = hex("#eceef1");
const PAS = hex("#f7f8fa");

/** Barve stanj kot v aplikaciji (kartice stanj). */
const BARVA: Record<StanjeMateriala, { polna: RGB; besedilo: RGB; ton: RGB; naPolni: RGB }> = {
  ni_naroceno: { polna: hex("#dc2626"), besedilo: hex("#b91c1c"), ton: hex("#fef2f2"), naPolni: BELA },
  prepozno: { polna: hex("#ca5010"), besedilo: hex("#b0450d"), ton: hex("#fdf3ed"), naPolni: BELA },
  zapadel: { polna: hex("#f59e0b"), besedilo: hex("#b45309"), ton: hex("#fffbeb"), naPolni: TEMNA },
  pride: { polna: hex("#2563eb"), besedilo: hex("#1d4ed8"), ton: hex("#eff6ff"), naPolni: BELA },
  zaloga: { polna: hex("#16a34a"), besedilo: hex("#15803d"), ton: hex("#ecfdf3"), naPolni: BELA },
};

const kol = (n: number) => formatNum(Math.round(n * 1000) / 1000);
const dni = (n: number) => `${n} ${n === 1 ? "dan" : n === 2 ? "dneva" : n <= 4 ? "dnevi" : "dni"}`;
const nalogov = (n: number) => `${n} ${n === 1 ? "nalog" : n === 2 ? "naloga" : n <= 4 ? "nalogi" : "nalogov"}`;

const desno = (s: PDFPage, t: string, x: number, y: number, vel: number, font: PDFFont, barva: RGB) =>
  s.drawText(t, { x: x - font.widthOfTextAtSize(t, vel), y, size: vel, font, color: barva });
const sredina = (s: PDFPage, t: string, cx: number, y: number, vel: number, font: PDFFont, barva: RGB) =>
  s.drawText(t, { x: cx - font.widthOfTextAtSize(t, vel) / 2, y, size: vel, font, color: barva });

/** Besedilo, skrajšano na širino (s tropičjem). */
function skrajsaj(t: string, font: PDFFont, vel: number, sirina: number) {
  if (font.widthOfTextAtSize(t, vel) <= sirina) return t;
  let n = t.length;
  while (n > 1 && font.widthOfTextAtSize(`${t.slice(0, n)}…`, vel) > sirina) n--;
  return `${t.slice(0, n).trimEnd()}…`;
}

/** Značka stanja (zaobljena, polna barva); x = levo, y = osnovnica besedila. */
function znacka(s: PDFPage, f: Pisave, stanje: StanjeMateriala, x: number, y: number, vel: number) {
  const t = OPIS_STANJA_MAT[stanje];
  const w = f.krepka.widthOfTextAtSize(t, vel) + vel * 1.4;
  const h = vel * 1.65;
  zaobljen(s, x, y - vel * 0.45, w, h, h / 2, BARVA[stanje].polna);
  s.drawText(t, { x: x + vel * 0.7, y, size: vel, font: f.krepka, color: BARVA[stanje].naPolni });
  return w;
}

const datumTxt = (d: IsoDate) => formatShort(d);

// ---------------------------------------------------------------------
// Krovni nalog (ena ali več strani)
// ---------------------------------------------------------------------

/** Stolpci tabele materiala (x = levi rob, w = širina). */
const STOLPCI = (() => {
  const sirine = { sifra: 122, kolicina: 96, narocilo: 150, prihod: 112, stanje: 142 };
  const material = W - 2 * ROB - Object.values(sirine).reduce((a, b) => a + b, 0);
  let x = ROB;
  const st = (w: number) => {
    const o = { x, w };
    x += w;
    return o;
  };
  return {
    sifra: st(sirine.sifra),
    material: st(material),
    kolicina: st(sirine.kolicina),
    narocilo: st(sirine.narocilo),
    prihod: st(sirine.prihod),
    stanje: st(sirine.stanje),
  };
})();

const VRSTICA = 31;
const GLAVA_TABELE_H = 22;
const PAD = 8;

/** Glava krovnega: številka, družine, začetek; desno kartica "material kompleten". Vrne y pod glavo. */
function glavaKrovnega(s: PDFPage, f: Pisave, l: KrovniNaListu, yVrh: number, nadaljevanje: string) {
  const { k } = l;
  const b = BARVA[k.stanje];
  const kartW = 300;
  const kartH = 74;
  const kx = W - ROB - kartW;

  // levo: krovni + družine
  s.drawText("KROVNI NALOG", { x: ROB, y: yVrh - 10, size: 8.5, font: f.polkrepka, color: SIVA });
  s.drawText(k.krovni, { x: ROB, y: yVrh - 46, size: 38, font: f.krepka, color: TEMNA });
  const wk = f.krepka.widthOfTextAtSize(k.krovni, 38);
  if (k.druzine.length) {
    const t = skrajsaj(k.druzine.join(", "), f.krepka, 26, kx - ROB - wk - 40);
    s.drawText(t, { x: ROB + wk + 20, y: yVrh - 44, size: 26, font: f.krepka, color: hex("#ca5010") });
  }
  const zacetek = l.zacetek ? `Začetek v planu: ${datumTxt(l.zacetek)}${l.mesto ? ` · ${l.mesto}` : ""}` : "Ni v delovnem planu";
  const pod = `${zacetek} · ${nalogov(k.nalogi.length)}${nadaljevanje}`;
  s.drawText(skrajsaj(pod, f.navadna, 12, kx - ROB - 16), { x: ROB, y: yVrh - 66, size: 12, font: f.navadna, color: SIVA });

  // desno: kartica stanja
  zaobljen(s, kx, yVrh - kartH, kartW, kartH, 8, b.ton, ROB_KARTICE);
  s.drawRectangle({ x: kx, y: yVrh - kartH, width: 5, height: kartH, color: b.polna });
  s.drawText("MATERIAL KOMPLETEN", { x: kx + 18, y: yVrh - 18, size: 8.5, font: f.polkrepka, color: SIVA });
  const kompleten = k.stanje === "zaloga" ? "v hiši" : k.kompleten ? datumTxt(k.kompleten) : "ni znano";
  s.drawText(kompleten, { x: kx + 18, y: yVrh - 50, size: 28, font: f.krepka, color: b.besedilo });
  if (k.rezerva !== null && k.stanje !== "zaloga") {
    const r = k.rezerva < 0 ? `zamuda ${dni(-k.rezerva)}` : `rezerva ${dni(k.rezerva)}`;
    s.drawText(r, { x: kx + 18, y: yVrh - 66, size: 10, font: f.polkrepka, color: k.rezerva < 0 ? BARVA.ni_naroceno.besedilo : SIVA });
  }
  const zw = f.krepka.widthOfTextAtSize(OPIS_STANJA_MAT[k.stanje], 11) + 15.4;
  znacka(s, f, k.stanje, kx + kartW - 14 - zw, yVrh - 20, 11);
  return yVrh - kartH - 14;
}

function glavaTabele(s: PDFPage, f: Pisave, y: number) {
  zaobljen(s, ROB, y - GLAVA_TABELE_H, W - 2 * ROB, GLAVA_TABELE_H, [6, 6, 0, 0], GLAVA_TABELE);
  const t = y - GLAVA_TABELE_H + 7;
  const c = STOLPCI;
  s.drawText("ŠIFRA", { x: c.sifra.x + PAD, y: t, size: 9, font: f.polkrepka, color: BELA });
  s.drawText("MATERIAL", { x: c.material.x + PAD, y: t, size: 9, font: f.polkrepka, color: BELA });
  desno(s, "KOLIČINA", c.kolicina.x + c.kolicina.w - PAD, t, 9, f.polkrepka, BELA);
  s.drawText("NAROČILO", { x: c.narocilo.x + PAD, y: t, size: 9, font: f.polkrepka, color: BELA });
  s.drawText("PRIHOD", { x: c.prihod.x + PAD, y: t, size: 9, font: f.polkrepka, color: BELA });
  s.drawText("STANJE", { x: c.stanje.x + PAD, y: t, size: 9, font: f.polkrepka, color: BELA });
  return y - GLAVA_TABELE_H;
}

function vrsticaMateriala(s: PDFPage, f: Pisave, m: MaterialKrovnega, y: number, liha: boolean) {
  const c = STOLPCI;
  if (liha) s.drawRectangle({ x: ROB, y: y - VRSTICA, width: W - 2 * ROB, height: VRSTICA, color: PAS });
  s.drawRectangle({ x: ROB, y: y - VRSTICA, width: W - 2 * ROB, height: 0.6, color: CRTA });
  const t = y - VRSTICA / 2 - 5;
  s.drawText(m.ident, { x: c.sifra.x + PAD, y: t, size: 14, font: f.polkrepka, color: TEMNA });
  s.drawText(skrajsaj(m.naziv ?? "", f.navadna, 14, c.material.w - 2 * PAD), { x: c.material.x + PAD, y: t, size: 14, font: f.navadna, color: TEMNA });

  // količina, ki ni z zaloge (z dobave + ni naročeno)
  const k = kol(m.naDobavi + m.manjka);
  const em = m.em ? ` ${m.em}` : "";
  const xK = c.kolicina.x + c.kolicina.w - PAD;
  const wEm = em ? f.navadna.widthOfTextAtSize(em, 10) : 0;
  if (em) s.drawText(em, { x: xK - wEm, y: t, size: 10, font: f.navadna, color: SIVA });
  desno(s, k, xK - wEm, t, 14, f.krepka, TEMNA);

  // naročilo: številka (+ "+n" ob več naročilih), dobavitelj pod njo
  const n = m.narocila;
  if (n.length) {
    const st = `${n[0].stevilka}${n.length > 1 ? ` +${n.length - 1}` : ""}`;
    s.drawText(st, { x: c.narocilo.x + PAD, y: y - 13.5, size: 11, font: f.polkrepka, color: TEMNA });
    s.drawText(skrajsaj(n[0].dobavitelj ?? "", f.navadna, 8, c.narocilo.w - 2 * PAD), { x: c.narocilo.x + PAD, y: y - 25, size: 8, font: f.navadna, color: SIVA });
  } else {
    s.drawText(m.manjka > 0 ? "ni naročila" : "–", { x: c.narocilo.x + PAD, y: t, size: 12, font: f.lezeca, color: BARVA.ni_naroceno.besedilo });
  }

  // prihod: datum + vrsta roka (zadnje naročilo)
  if (m.prihod) {
    const b = m.stanje === "prepozno" || m.stanje === "zapadel" ? BARVA[m.stanje].besedilo : TEMNA;
    s.drawText(datumTxt(m.prihod), { x: c.prihod.x + PAD, y: y - 15, size: 14, font: f.krepka, color: b });
    const zadnji = [...n].reverse().find((d) => d.rok);
    if (zadnji?.vrsta_roka) s.drawText(KRATKA_VRSTA_ROKA[zadnji.vrsta_roka], { x: c.prihod.x + PAD, y: y - 26, size: 8, font: f.navadna, color: SIVA });
  } else {
    s.drawText("ni znano", { x: c.prihod.x + PAD, y: t, size: 12, font: f.lezeca, color: BARVA.ni_naroceno.besedilo });
  }
  znacka(s, f, m.stanje, c.stanje.x + PAD, t + 1, 10.5);
}

/** Strani krovnega: material, ki ni na zalogi; prazen = velika zelena kljukica. */
function straniKrovnega(pdf: Awaited<ReturnType<typeof novDokument>>["pdf"], f: Pisave, logo: Parameters<typeof glavaStrani>[2], l: KrovniNaListu, naslov: string, stanje: string) {
  const material = materialKrovnega(l.k);
  const yVrh0 = H - 20;
  const yDno = ROB + 34;
  // koliko vrstic gre na stran
  const prostor = yVrh0 - 28 - 14 - 74 - 14 - GLAVA_TABELE_H - yDno;
  const naStran = Math.max(1, Math.floor(prostor / VRSTICA));
  const listov = Math.max(1, Math.ceil(material.length / naStran));
  for (let i = 0; i < listov; i++) {
    const s = pdf.addPage([W, H]);
    const y0 = glavaStrani(s, f, logo, naslov, yVrh0, ROB, W - ROB);
    let y = glavaKrovnega(s, f, l, y0, listov > 1 ? ` · stran ${i + 1}/${listov}` : "");
    if (!material.length) {
      const cy = (y + yDno) / 2;
      s.drawCircle({ x: W / 2, y: cy + 30, size: 34, color: BARVA.zaloga.polna });
      s.drawSvgPath("M-14 0 L-4 10 L16 -12", { x: W / 2, y: cy + 30, borderColor: BELA, borderWidth: 7 });
      sredina(s, "Ves material je v hiši", W / 2, cy - 30, 26, f.krepka, BARVA.zaloga.besedilo);
      const vrstic = l.k.vrstice.length;
      sredina(s, vrstic ? `${vrstic} neizdanih vrstic materiala - vse na zalogi` : "Ves material je že izdan", W / 2, cy - 52, 12, f.navadna, SIVA);
    } else {
      y = glavaTabele(s, f, y);
      material.slice(i * naStran, (i + 1) * naStran).forEach((m, j) => {
        vrsticaMateriala(s, f, m, y, j % 2 === 1);
        y -= VRSTICA;
      });
      const naZalogi = new Set(l.k.vrstice.filter((v) => v.stanje === "zaloga").map((v) => v.ident)).size;
      if (i === listov - 1 && naZalogi)
        s.drawText(`+ ${naZalogi} materialov na zalogi (ni na seznamu)`, { x: ROB + PAD, y: y - 14, size: 9, font: f.lezeca, color: SIVA });
    }
    s.drawText(stanje, { x: ROB, y: ROB + 2, size: 7.5, font: f.navadna, color: SIVA });
  }
}

/** Zbirna stran krovnih z vsem materialom v hiši (kartice). */
function zbirnaStran(pdf: Awaited<ReturnType<typeof novDokument>>["pdf"], f: Pisave, logo: Parameters<typeof glavaStrani>[2], krovni: KrovniNaListu[], naslov: string, stanje: string) {
  const NA_VRSTO = 4;
  const RAZ = 12;
  const kw = (W - 2 * ROB - (NA_VRSTO - 1) * RAZ) / NA_VRSTO;
  const kh = 78;
  const naStran = NA_VRSTO * 4;
  for (let i = 0; i < krovni.length; i += naStran) {
    const s = pdf.addPage([W, H]);
    let y = glavaStrani(s, f, logo, naslov, H - 20, ROB, W - ROB);
    s.drawCircle({ x: ROB + 14, y: y - 16, size: 14, color: BARVA.zaloga.polna });
    s.drawSvgPath("M-6 0 L-2 4 L7 -5", { x: ROB + 14, y: y - 16, borderColor: BELA, borderWidth: 3 });
    s.drawText("Ves material v hiši", { x: ROB + 38, y: y - 24, size: 24, font: f.krepka, color: BARVA.zaloga.besedilo });
    s.drawText(`${krovni.length} krovnih nalogov iz delovnega plana ima ves material na zalogi ali izdan`, {
      x: ROB + 38,
      y: y - 40,
      size: 11,
      font: f.navadna,
      color: SIVA,
    });
    y -= 58;
    krovni.slice(i, i + naStran).forEach((l, j) => {
      const x = ROB + (j % NA_VRSTO) * (kw + RAZ);
      const yk = y - Math.floor(j / NA_VRSTO) * (kh + RAZ);
      zaobljen(s, x, yk - kh, kw, kh, 8, BARVA.zaloga.ton, ROB_KARTICE);
      s.drawRectangle({ x, y: yk - kh, width: 5, height: kh, color: BARVA.zaloga.polna });
      s.drawText(l.k.krovni, { x: x + 16, y: yk - 30, size: 24, font: f.krepka, color: TEMNA });
      const wk = f.krepka.widthOfTextAtSize(l.k.krovni, 24);
      if (l.k.druzine.length)
        s.drawText(skrajsaj(l.k.druzine.join(", "), f.krepka, 15, kw - wk - 36), { x: x + 26 + wk, y: yk - 29, size: 15, font: f.krepka, color: hex("#ca5010") });
      const z = l.zacetek ? `začetek ${datumTxt(l.zacetek)}${l.mesto ? ` · ${l.mesto}` : ""}` : "ni v planu";
      s.drawText(skrajsaj(z, f.navadna, 10.5, kw - 30), { x: x + 16, y: yk - 50, size: 10.5, font: f.navadna, color: SIVA });
      s.drawText(nalogov(l.k.nalogi.length), { x: x + 16, y: yk - 66, size: 9, font: f.navadna, color: SIVA });
    });
    s.drawText(stanje, { x: ROB, y: ROB + 2, size: 7.5, font: f.navadna, color: SIVA });
  }
}

/**
 * PDF: za vsak krovni z manjkajočim materialom svoja stran (ali več), krovni z vsem materialom v hiši na zbirni strani
 * (`zbirna`; brez nje vsak svojo stran - izvoz posameznega krovnega). `naslov` = naslov dokumenta v glavi strani.
 */
export async function ustvariPripravljenostPdf({
  krovni,
  naslov,
  stanje,
  zbirna = true,
}: {
  krovni: KrovniNaListu[];
  naslov: string;
  stanje: string;
  zbirna?: boolean;
}): Promise<Blob> {
  const doc = await novDokument(naslov);
  const { pdf, logo } = doc;
  const f: Pisave = doc;
  const vHisi = zbirna ? krovni.filter((l) => materialKrovnega(l.k).length === 0) : [];
  for (const l of krovni) if (!vHisi.includes(l)) straniKrovnega(pdf, f, logo, l, naslov, stanje);
  if (vHisi.length) zbirnaStran(pdf, f, logo, vHisi, naslov, stanje);
  if (!krovni.length) {
    const s = pdf.addPage([W, H]);
    glavaStrani(s, f, logo, naslov, H - 20, ROB, W - ROB);
    sredina(s, "V delovnem planu ni aktivnih krovnih nalogov.", W / 2, H / 2, 16, f.lezeca, SIVA);
    s.drawText(stanje, { x: ROB, y: ROB + 2, size: 7.5, font: f.navadna, color: SIVA });
  }
  noga(pdf, f.navadna, `FINES d.o.o. | Production | ${naslov}`, ROB);
  const bajti = await pdf.save();
  return new Blob([bajti as BlobPart], { type: "application/pdf" });
}

export async function prenesiPripravljenostPdf(p: Parameters<typeof ustvariPripravljenostPdf>[0], ime: string) {
  prenesiDatoteko(await ustvariPripravljenostPdf(p), `${asciiIme(ime)}.pdf`);
}
