"use client";

// Objava na FIN:TV (FinOS -> Administracija -> FIN:TV -> Komponente). Komponenta = vrstica v fos_tv_viri (migracija FinOS
// 025); objava = strani dokumenta kot slike WebP 3840 px v košari fos-tv-viri + klic fos_tv_objavi. Vsaka stran ima lahko
// veljavnost (od - do, datum): TV kaže samo strani, ki veljajo danes.
//
// Delovni plan - workflow in pregled (vsak oddelek svoja komponenta za vsakega): ob "Shrani plan" se za VSAK TEDEN, za
// katerega je plan narejen (od tekočega tedna naprej), objavijo PODATKI plana tedna (FinOS 030 - animirane scene, TV sam
// izračuna DANES in dni do roka); brez 030 svoj PDF na teden (spodaj); strani / podatki tedna veljajo pon - ned. TV v ponedeljek
// sam preklopi na nov teden. Workflow pokaže 2 tedna (teden + naslednji, kot privzet pogled plana); pregled ima za
// vsak delovni dan svoje strani (oznaka DANES), strani dneva veljajo ta dan (petek do nedelje). Nova objava zamenja vse tedne naenkrat. Izklopljena / manjkajoča komponenta = nič se ne ustvari.
//
// Delo - prejšnji dan (vsak oddelek svoja komponenta, FinOS 027): ob vsakem uvozu Poročanega dela (Sync) se za prejšnji
// delovni dan objavijo PODATKI (deloVceraj.ts -> DeloOddelka, FinOS 030 fos_tv_objavi_podatke) - FIN:TV iz njih naredi
// animirane scene za delavce (glava Fineseka, en podatek). Velja samo na dan objave. Brez FinOS 030 stara pot: stran
// 16:9 na oddelek (deloPdf.ts). Izvozi PDF v aplikaciji ostanejo nespremenjeni.
//
// Zaključeni krovni (vsak oddelek svoja komponenta, FinOS 028): ob vsakem uvozu Poročanega dela se objavijo PODATKI
// krovnih, zaključenih v zadnjih 30 dneh (animirane scene, FinOS 030); veljajo 7 dni. Brez 030 stran 16:9 na celico
// (zakljuceniPdf.ts). Enako Pripravljenost materiala (podatki krovnih, brez 030 pripravljenostPdf.ts).
import { addDays, mondayOf, prevWorkday, toIso, type IsoDate } from "./dates";
import type { DeloOddelka } from "./deloVceraj";
import type { OddelekKoda } from "./normativi";
import type { WorkflowPlan } from "./plan";
import { ustvariPlanPdf } from "./planPdf";
import { ustvariPlanPregledPdf, type DruzineNormativov } from "./planPregledPdf";
import { getSupabase } from "./supabase";
import { ODDELKI_TV, VELJA_PRIPRAVLJENOST_DNI, kodaDela, kodaPregleda, kodaPripravljenosti, kodaWorkflowa, kodaZakljucenih } from "./tvIzpisi";

const KOSARA = "fos-tv-viri";
/** Širina slike strani (4K). */
const SIRINA = 3840;
/** Največ tednov naprej (plan za pol leta). */
const NAJVEC_TEDNOV = 26;


/** PDF -> slike strani (pdf.js, kot pdfStrani.ts v FinOS) + razmerje strani (višina / širina). */
async function pdfVSlike(pdfBlob: Blob): Promise<{ slike: Blob[]; razmerja: number[] }> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await pdfBlob.arrayBuffer()) }).promise;
  const slike: Blob[] = [];
  const razmerja: number[] = [];
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const stran = await pdf.getPage(i);
      const osnova = stran.getViewport({ scale: 1 });
      const viewport = stran.getViewport({ scale: SIRINA / osnova.width });
      razmerja.push(Math.round((osnova.height / osnova.width) * 1000) / 1000);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // intent "print": brez requestAnimationFrame - sicer se izris v zavihku v ozadju ustavi (brskalnik ga zamrzne)
      await stran.render({ canvas, canvasContext: ctx, viewport, intent: "print" }).promise;
      slike.push(await new Promise<Blob>((ok, ne) => canvas.toBlob((b) => (b ? ok(b) : ne(new Error("Strani ni mogoče shraniti."))), "image/webp", 0.9)));
      stran.cleanup();
      canvas.width = canvas.height = 0;
    }
  } finally {
    await pdf.loadingTask.destroy();
  }
  return { slike, razmerja };
}

/** Ali je komponenta v FinOS in vklopljena (sicer se nič ne ustvari). */
async function vklopljena(koda: string): Promise<boolean> {
  const { data, error } = await getSupabase().from("fos_tv_viri").select("vklopljen").eq("koda", koda).eq("visible", true).maybeSingle();
  return !error && !!data?.vklopljen;
}

/** Dokumenti plana na FIN:TV - vsak je za vsak oddelek svoja komponenta (FinOS 025 / 026). */
type DokumentPlana = {
  ime: string;
  koda: (oddelek: OddelekKoda) => string;
  /** Koliko tednov pokaže ena stran (od tedna veljavnosti naprej) - workflow 2 tedna kot privzet pogled plana. */
  tednov: number;
  /** Svoje strani za vsak delovni dan (oznaka DANES na pravem mestu), sicer ene strani za cel teden. */
  poDnevih: boolean;
  pdf: (plan: WorkflowPlan, druzine: DruzineNormativov, danes: IsoDate) => Promise<Blob>;
};
const DOKUMENTI: DokumentPlana[] = [
  { ime: "workflow", koda: kodaWorkflowa, tednov: 2, poDnevih: false, pdf: (plan) => ustvariPlanPdf(plan) },
  { ime: "pregled", koda: kodaPregleda, tednov: 1, poDnevih: true, pdf: (plan, druzine, danes) => ustvariPlanPregledPdf(plan, druzine, danes) },
];

/** Objavljeni dokumenti (samo vklopljene komponente, ki imajo strani). Prazno = nič objavljeno. */
export type IzidObjave = { ime: string; tednov: number; strani: number; animirano?: boolean }[];

type Zbirka = {
  dok: DokumentPlana;
  koda: string;
  mapa: string;
  strani: string[];
  razmerja: number[];
  /** animirana objava (FinOS 030): en element = plan enega tedna */
  podatki: unknown[];
  veljaOd: IsoDate[];
  veljaDo: IsoDate[];
  tednov: number;
};

/** Ali FinOS že ima animirane objave (030: fos_tv_objave.podatki) - sicer plan gre na TV kot strani PDF. */
async function imaAnimirane(): Promise<boolean> {
  const { error } = await getSupabase().from("fos_tv_objave").select("podatki").limit(1);
  return !error;
}

/** Plan tedna za TV (oblika PlanTv v FinOS tvScene.ts - ob spremembi uskladi oba). */
function planTv(plan: WorkflowPlan) {
  return {
    oddelek: plan.oddelek,
    od: plan.od,
    do: plan.do,
    celice: plan.celice
      .filter((c) => c.koraki.length)
      .map((c) => ({
        naziv: c.naziv,
        koraki: c.koraki.map((k) => ({
          krovni: k.krovni,
          narocnik: k.narocnik,
          od: k.od,
          do: k.do,
          ure: r1(k.ure),
          brezKapacitete: r1(k.brezKapacitete),
          prosta: k.prosta,
        })),
      })),
  };
}

/** Zadnja zagnana objava po oddelku - novejši Shrani plan prekine starejšo objavo istega oddelka. */
const zadnjaObjava = new Map<string, number>();

/**
 * Plan po tednih na FIN:TV (workflow + pregled). `planTedna(dnevi)` = WorkflowPlan za 5 delovnih dni tedna
 * (pripraviWorkflow), `zadnjiDan` = konec zadnjega koraka v planu. Plan tedna se izračuna enkrat za oba dokumenta.
 * Izklopljene / manjkajoče komponente se preskočijo. Tekoči teden se objavi takoj (TV ga pokaže v ~20 s), vsi tedni
 * pa na koncu. `napredek(tednov, vseh)` = koliko tednov je pripravljenih. Vrne null, ko jo je prekinil novejši Shrani plan.
 */
export async function objaviPlanNaTv({
  oddelek,
  nazivOddelka,
  planTedna,
  druzine,
  zadnjiDan,
  napredek,
}: {
  oddelek: OddelekKoda;
  nazivOddelka: string;
  planTedna: (dnevi: IsoDate[]) => WorkflowPlan;
  druzine: DruzineNormativov;
  zadnjiDan: IsoDate | null;
  napredek?: (teden: number, vseh: number) => void;
}): Promise<IzidObjave | null> {
  const prvi = mondayOf(toIso(new Date()));
  if (!zadnjiDan || zadnjiDan < prvi) return [];
  const zdaj = Date.now();
  zadnjaObjava.set(oddelek, zdaj);
  const prekinjena = () => zadnjaObjava.get(oddelek) !== zdaj;
  const zbirke: Zbirka[] = [];
  for (const dok of DOKUMENTI) {
    const koda = dok.koda(oddelek);
    if (await vklopljena(koda)) zbirke.push({ dok, koda, mapa: `${koda}/${zdaj}`, strani: [], razmerja: [], podatki: [], veljaOd: [], veljaDo: [], tednov: 0 });
  }
  if (!zbirke.length) return [];
  // animirano (FinOS 030): podatki plana po tednih namesto PDF - TV sam izračuna DANES in dni do roka
  const animirano = await imaAnimirane();

  const tedni: IsoDate[] = [];
  for (let pon = prvi; pon <= mondayOf(zadnjiDan) && tedni.length < NAJVEC_TEDNOV; pon = addDays(pon, 7)) tedni.push(pon);
  napredek?.(0, tedni.length);
  for (const [t, pon] of tedni.entries()) {
    if (prekinjena()) return null;
    // plan tedna po številu tednov dokumenta (izračuna se enkrat za vse dokumente z isto dolžino)
    const plani = new Map<number, WorkflowPlan>();
    const planZa = (tednov: number) => {
      if (!plani.has(tednov)) plani.set(tednov, planTedna(Array.from({ length: tednov }, (_, w) => Array.from({ length: 5 }, (_, i) => addDays(pon, w * 7 + i))).flat()));
      return plani.get(tednov)!;
    };
    if (animirano) dodajTedenPodatki(zbirke, pon, planZa);
    else await dodajTeden(zbirke, pon, planZa, druzine);
    // tekoči teden takoj na TV, ostali ob koncu (nova objava zamenja prejšnjo)
    if (t === 0 && tedni.length > 1 && !prekinjena()) await objavi(zbirke, nazivOddelka);
    napredek?.(t + 1, tedni.length);
  }
  if (prekinjena()) return null;
  return objavi(zbirke, nazivOddelka);
}

/**
 * Strani enega tedna za vse dokumente -> košara. Dokument po dnevih: za vsak delovni dan svoj PDF z oznako DANES na
 * ta dan (petek velja do nedelje); dnevi, ki so že minili, se preskočijo. Sicer en PDF za cel teden (pon - ned).
 */
async function dodajTeden(zbirke: Zbirka[], pon: IsoDate, planZa: (tednov: number) => WorkflowPlan, druzine: DruzineNormativov) {
  const danes = toIso(new Date());
  for (const z of zbirke) {
    const plan = planZa(z.dok.tednov);
    if (!plan.celice.length) continue;
    const obdobja = z.dok.poDnevih
      ? Array.from({ length: 5 }, (_, i) => ({ od: addDays(pon, i), do: addDays(pon, i === 4 ? 6 : i) })).filter((o) => o.do >= danes)
      : [{ od: pon, do: addDays(pon, 6) }];
    for (const o of obdobja) {
      const { slike, razmerja } = await pdfVSlike(await z.dok.pdf(plan, druzine, o.od > danes ? o.od : danes));
      for (let i = 0; i < slike.length; i++) {
        const pot = `${z.mapa}/${o.od}-${i + 1}.webp`;
        const { error } = await getSupabase().storage.from(KOSARA).upload(pot, slike[i], { contentType: "image/webp", cacheControl: "31536000", upsert: false });
        if (error) throw new Error(`Nalaganje strani na TV (${z.dok.ime}): ${error.message}`);
        z.strani.push(pot);
        z.razmerja.push(razmerja[i]);
        z.veljaOd.push(o.od);
        z.veljaDo.push(o.do);
      }
    }
    z.tednov++;
  }
}

/** Teden kot podatki (animirana objava): plan tedna za vsak dokument, velja pon - ned. */
function dodajTedenPodatki(zbirke: Zbirka[], pon: IsoDate, planZa: (tednov: number) => WorkflowPlan) {
  for (const z of zbirke) {
    const plan = planZa(z.dok.tednov);
    if (!plan.celice.length) continue;
    z.podatki.push(planTv(plan));
    z.veljaOd.push(pon);
    z.veljaDo.push(addDays(pon, 6));
    z.tednov++;
  }
}

/** Objava zbranih strani / podatkov (vsak dokument svoja komponenta). */
async function objavi(zbirke: Zbirka[], nazivOddelka: string): Promise<IzidObjave> {
  const izid: IzidObjave = [];
  for (const z of zbirke) {
    if (z.podatki.length) {
      await objaviPodatke(z.koda, z.podatki, `Production: Shrani plan · ${nazivOddelka}`, z.veljaOd, z.veljaDo).catch((e: Error) => {
        throw new Error(`${z.dok.ime}: ${e.message}`);
      });
      izid.push({ ime: z.dok.ime, tednov: z.tednov, strani: z.podatki.length, animirano: true });
      continue;
    }
    if (!z.strani.length) continue;
    const { error } = await getSupabase().rpc("fos_tv_objavi", {
      p_koda: z.koda,
      p_strani: z.strani,
      p_razmerja: z.razmerja,
      p_izvor: `Production: Shrani plan · ${nazivOddelka}`,
      p_velja_od: z.veljaOd,
      p_velja_do: z.veljaDo,
    });
    if (error) throw new Error(`${z.dok.ime}: ${error.message}`);
    izid.push({ ime: z.dok.ime, tednov: z.tednov, strani: z.strani.length });
  }
  return izid;
}

/**
 * "Delo - prejšnji dan" na FIN:TV za vse oddelke z vklopljeno komponento: štempljane ure prejšnjega delovnega dne proti
 * planu (deloVceraj.ts) kot PODATKI za animirane scene (FinOS 030; brez nje stran deloPdf.ts). Velja samo danes -
 * naslednji dan je komponenta prazna do novega uvoza.
 * Vrne objavljene oddelke (prazno = nobena komponenta ni vklopljena ali ni dostopa do FIN:TV).
 */
export async function objaviDeloNaTv(izvor = "uvoz poročanega dela"): Promise<{ datum: IsoDate; oddelki: string[] }> {
  const danes = toIso(new Date());
  const datum = prevWorkday(danes);
  const kode: OddelekKoda[] = [];
  for (const o of ODDELKI_TV) if (await vklopljena(kodaDela(o))) kode.push(o);
  if (!kode.length) return { datum, oddelki: [] };
  const { pripraviDelo } = await import("./deloVceraj");
  const zdaj = Date.now();
  const oddelki: string[] = [];
  for (const d of await pripraviDelo(datum, kode)) {
    const koda = kodaDela(d.koda);
    const p_izvor = `Production: ${izvor} · ${d.naziv}`;
    // animirana objava: podatki oddelka (ure na 0,1 h - manj podatkov, enako na TV)
    const objavljeno = await objaviPodatke(koda, [podatkiDela(d)], p_izvor, [danes], [danes]).catch((e: Error) => {
      throw new Error(`${d.naziv}: ${e.message}`);
    });
    if (objavljeno) {
      oddelki.push(d.naziv);
      continue;
    }
    // FinOS 030 še ni zagnan: stran PDF kot slika (prej)
    const { ustvariDeloPdf } = await import("./deloPdf");
    const { slike, razmerja } = await pdfVSlike(await ustvariDeloPdf(d));
    const strani: string[] = [];
    for (let i = 0; i < slike.length; i++) {
      const pot = `${koda}/${zdaj}/${datum}-${i + 1}.webp`;
      const nalozi = await getSupabase().storage.from(KOSARA).upload(pot, slike[i], { contentType: "image/webp", cacheControl: "31536000", upsert: false });
      if (nalozi.error) throw new Error(`Nalaganje strani na TV (${d.naziv}): ${nalozi.error.message}`);
      strani.push(pot);
    }
    const stara = await getSupabase().rpc("fos_tv_objavi", {
      p_koda: koda,
      p_strani: strani,
      p_razmerja: razmerja,
      p_izvor,
      p_velja_od: strani.map(() => danes),
      p_velja_do: strani.map(() => danes),
    });
    if (stara.error) throw new Error(`${d.naziv}: ${stara.error.message}`);
    oddelki.push(d.naziv);
  }
  return { datum, oddelki };
}

/**
 * Animirana objava (FinOS 030): podatki za scene namesto slik strani. Vrne false, če FinOS 030 še ni zagnan (takrat
 * klicatelj objavi strani PDF kot prej); ostale napake vrže.
 */
async function objaviPodatke(koda: string, podatki: unknown[], izvor: string, veljaOd: IsoDate[], veljaDo: IsoDate[]): Promise<boolean> {
  const { error } = await getSupabase().rpc("fos_tv_objavi_podatke", { p_koda: koda, p_podatki: podatki, p_izvor: izvor, p_velja_od: veljaOd, p_velja_do: veljaDo });
  if (!error) return true;
  if (niFunkcije(error)) return false;
  throw new Error(error.message);
}

/** Funkcije v bazi ni (migracija FinOS še ni zagnana) - PostgREST PGRST202. */
const niFunkcije = (e: { code?: string; message: string }) => e.code === "PGRST202" || /could not find the function/i.test(e.message);

const r1 = (x: number) => Math.round(x * 10) / 10;

/** Podatki dela za TV (oblika DeloOddelka - FinOS tvScene.ts jo bere, ob spremembi uskladi oba). */
function podatkiDela(d: DeloOddelka) {
  return {
    koda: d.koda,
    naziv: d.naziv,
    datum: d.datum,
    celice: d.celice.map((c) => ({
      naziv: c.naziv,
      dodatno: c.dodatno,
      plan: r1(c.plan),
      ure: r1(c.ure),
      izven: r1(c.izven),
      rezija: r1(c.rezija),
      osebe: c.osebe,
      krovni: c.krovni.map((k) => ({ krovni: k.krovni, narocnik: k.narocnik, plan: r1(k.plan), ure: r1(k.ure), izvenDneva: k.izvenDneva })),
    })),
  };
}

/**
 * "Pripravljenost materiala" na FIN:TV za vse oddelke z vklopljeno komponento: za vsak krovni iz delovnega plana oddelka
 * stran 16:9 z materialom, ki ni na zalogi (pripravljenostPodatki.ts -> pripravljenostPdf.ts); krovni z vsem materialom
 * v hiši na zbirni strani. Strani veljajo VELJA_PRIPRAVLJENOST_DNI dni (nova objava jih zamenja).
 */
export async function objaviPripravljenostNaTv(izvor = "sync"): Promise<{ oddelki: string[] }> {
  const danes = toIso(new Date());
  const kode: OddelekKoda[] = [];
  for (const o of ODDELKI_TV) if (await vklopljena(kodaPripravljenosti(o))) kode.push(o);
  if (!kode.length) return { oddelki: [] };
  const [{ pripraviPripravljenostTv }, { ustvariPripravljenostPdf }] = await Promise.all([
    import("./pripravljenostPodatki"),
    import("./pripravljenostPdf"),
  ]);
  const zdaj = Date.now();
  const oddelki: string[] = [];
  for (const d of await pripraviPripravljenostTv(kode)) {
    const koda = kodaPripravljenosti(d.koda);
    const veljaDo = addDays(danes, VELJA_PRIPRAVLJENOST_DNI - 1);
    // animirana objava (FinOS 030): krovni s stanjem materiala (oblika MaterialOddelkaTv v FinOS tvScene.ts)
    const podatki = {
      koda: d.koda,
      naziv: d.naziv,
      danes: d.danes,
      krovni: d.krovni.map((l) => ({
        krovni: l.k.krovni,
        mesto: l.mesto,
        zacetek: l.zacetek,
        stanje: l.k.stanje,
        kompleten: l.k.kompleten,
        rezerva: l.k.rezerva,
        manjkajocih: l.k.manjkajocih,
        druzina: l.k.druzine[0] ?? null,
      })),
    };
    if (await objaviPodatke(koda, [podatki], `Production: ${izvor} · ${d.naziv}`, [danes], [veljaDo]).catch((e: Error) => { throw new Error(`${d.naziv}: ${e.message}`); })) {
      oddelki.push(`${d.naziv} (${d.krovni.length} krovnih, animirano)`);
      continue;
    }
    const pdf = await ustvariPripravljenostPdf({ krovni: d.krovni, naslov: `Pripravljenost materiala · ${d.naziv}`, stanje: d.stanje });
    const { slike, razmerja } = await pdfVSlike(pdf);
    const strani: string[] = [];
    for (let i = 0; i < slike.length; i++) {
      const pot = `${koda}/${zdaj}/${danes}-${i + 1}.webp`;
      const { error } = await getSupabase().storage.from(KOSARA).upload(pot, slike[i], { contentType: "image/webp", cacheControl: "31536000", upsert: false });
      if (error) throw new Error(`Nalaganje strani na TV (${d.naziv}): ${error.message}`);
      strani.push(pot);
    }
    const { error } = await getSupabase().rpc("fos_tv_objavi", {
      p_koda: koda,
      p_strani: strani,
      p_razmerja: razmerja,
      p_izvor: `Production: ${izvor} · ${d.naziv}`,
      p_velja_od: strani.map(() => danes),
      p_velja_do: strani.map(() => addDays(danes, VELJA_PRIPRAVLJENOST_DNI - 1)),
    });
    if (error) throw new Error(`${d.naziv}: ${error.message}`);
    oddelki.push(`${d.naziv} (${d.krovni.length} krovnih, ${strani.length} str.)`);
  }
  return { oddelki };
}

/** Strani zaključenih krovnih veljajo teden dni (nova objava jih zamenja - ob vsakem uvozu poročanega dela). */
const VELJA_ZAKLJUCENI_DNI = 7;

/**
 * "Zaključeni krovni" na FIN:TV za vse oddelke z vklopljeno komponento: produktivnost krovnih iz delovnega plana,
 * zaključenih v zadnjih 30 dneh (zakljuceniKrovni.ts -> zakljuceniPdf.ts), stran 16:9 na celico.
 * Vrne objavljene oddelke (prazno = nobena komponenta ni vklopljena ali ni dostopa do FIN:TV).
 */
export async function objaviZakljuceneNaTv(izvor = "uvoz poročanega dela"): Promise<{ oddelki: string[] }> {
  const danes = toIso(new Date());
  const kode: OddelekKoda[] = [];
  for (const o of ODDELKI_TV) if (await vklopljena(kodaZakljucenih(o))) kode.push(o);
  if (!kode.length) return { oddelki: [] };
  const [{ pripraviZakljucene }, { ustvariZakljucenePdf }] = await Promise.all([import("./zakljuceniKrovni"), import("./zakljuceniPdf")]);
  const zdaj = Date.now();
  const oddelki: string[] = [];
  for (const d of await pripraviZakljucene(kode)) {
    const koda = kodaZakljucenih(d.koda);
    // animirana objava (FinOS 030): krovni po celicah (oblika ZakljuceniOddelkaTv v FinOS tvScene.ts)
    const podatki = {
      koda: d.koda,
      naziv: d.naziv,
      od: d.od,
      celice: d.celice.map((c) => ({
        naziv: c.naziv,
        krovni: c.krovni.map((k) => ({ krovni: k.krovni, zakljucen: k.zakljucen, normUre: r1(k.normUre), ure: r1(k.ure), produktivnost: k.produktivnost === null ? null : Math.round(k.produktivnost * 1000) / 1000 })),
      })),
    };
    const veljaDo = addDays(danes, VELJA_ZAKLJUCENI_DNI - 1);
    if (await objaviPodatke(koda, [podatki], `Production: ${izvor} · ${d.naziv}`, [danes], [veljaDo]).catch((e: Error) => { throw new Error(`${d.naziv}: ${e.message}`); })) {
      oddelki.push(d.naziv);
      continue;
    }
    const { slike, razmerja } = await pdfVSlike(await ustvariZakljucenePdf(d));
    const strani: string[] = [];
    for (let i = 0; i < slike.length; i++) {
      const pot = `${koda}/${zdaj}/${danes}-${i + 1}.webp`;
      const { error } = await getSupabase().storage.from(KOSARA).upload(pot, slike[i], { contentType: "image/webp", cacheControl: "31536000", upsert: false });
      if (error) throw new Error(`Nalaganje strani na TV (${d.naziv}): ${error.message}`);
      strani.push(pot);
    }
    const { error } = await getSupabase().rpc("fos_tv_objavi", {
      p_koda: koda,
      p_strani: strani,
      p_razmerja: razmerja,
      p_izvor: `Production: ${izvor} · ${d.naziv}`,
      p_velja_od: strani.map(() => danes),
      p_velja_do: strani.map(() => addDays(danes, VELJA_ZAKLJUCENI_DNI - 1)),
    });
    if (error) throw new Error(`${d.naziv}: ${error.message}`);
    oddelki.push(d.naziv);
  }
  return { oddelki };
}
