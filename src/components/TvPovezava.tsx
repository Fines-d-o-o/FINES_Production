"use client";

import { useState } from "react";
import Link from "next/link";
import { Tv } from "lucide-react";
import { formatDatumUra } from "@/lib/dates";
import { najhujse, ocenaKomponente, type StanjeTvKomponente } from "@/lib/tvStanje";
import { Modal } from "@/components/ui/Modal";
import { StanjeIkona } from "@/components/ui/StanjeIkona";
import { useStanjeTv } from "@/components/TvProvider";

/** En izpis strani, ki se objavlja na FIN:TV (opis za okno TvPovezava). */
export type TvIzpis = {
  /** Ime izpisa, npr. "Delo - prejšnji dan". */
  naslov: string;
  /** Koda komponente v FinOS za izbran oddelek (fos_tv_viri.koda). */
  koda: string;
  /** Kaj je na strani TV. */
  vsebina: string;
  /** Oblika (PDF, velikost strani, koliko strani). */
  format: string;
  /** Kdaj se objavi (sync, Shrani …). */
  kdaj: string;
  /** Koliko časa ga TV kaže. */
  velja: string;
  /** Kje na strani se prenese isti PDF. */
  prenos: string;
};

/**
 * Povezava strani s FIN:TV (desno zgoraj, ob `PodatkiVir`): bel kvadratek z utripajočo ikono TV in ikono stanja
 * objave v desnem zgornjem kotu (StanjeIkona, pojasnilo v hover tekstu). Klik odpre okno, ki pove, kateri izpisi
 * strani gredo na TV, v kakšni obliki, kdaj se objavijo, koliko časa veljajo, kje se prenese isti PDF ter stanje
 * komponente (vklopljena, objava teče, zadnja objava). `oddelek` = ime izbranega oddelka.
 */
export function TvPovezava({ izpisi, oddelek }: { izpisi: TvIzpis[]; oddelek?: string }) {
  const [odprto, setOdprto] = useState(false);
  const tv = useStanjeTv();
  const ocena = najhujse(
    izpisi.map((iz) => ({ naslov: iz.naslov, ocena: ocenaKomponente(iz.koda, tv.komponente?.get(iz.koda), tv.opravila) })),
  );
  const nalagam = !tv.komponente && !tv.napaka && ocena.stanje === "neznano";
  const hint = `FIN:TV - ${nalagam ? "preverjam stanje ..." : ocena.opis}. Klikni za opis izpisov.`;
  return (
    <>
      <button
        type="button"
        title={hint}
        aria-label={hint}
        onClick={() => setOdprto(true)}
        className="fp-card relative flex min-h-16 w-20 shrink-0 flex-col items-center justify-center gap-1 self-stretch px-2 py-2 text-xs transition-colors hover:border-ink-400 hover:bg-ink-50"
      >
        <Tv className="h-6 w-6 animate-pulse text-sync-500" aria-hidden />
        <span className="font-semibold text-ink-600">FIN:TV</span>
        {!nalagam && <StanjeIkona stanje={ocena.stanje} className="absolute -right-1.5 -top-1.5" />}
      </button>
      {odprto && <OknoTv izpisi={izpisi} oddelek={oddelek} onClose={() => setOdprto(false)} />}
    </>
  );
}

function OknoTv({ izpisi, oddelek, onClose }: { izpisi: TvIzpis[]; oddelek?: string; onClose: () => void }) {
  const tv = useStanjeTv();
  const stanje = tv.komponente;

  return (
    <Modal open title={`FIN:TV${oddelek ? ` · ${oddelek}` : ""}`} onClose={onClose} sirina="max-w-2xl">
      <div className="flex flex-col gap-4 text-sm text-ink-700">
        <p>
          Izpisi te strani, ki se samodejno objavljajo na televizorjih FIN:TV. Vsak oddelek ima svojo komponento; vklopiš jo v{" "}
          <strong>FinOS → Administracija → FIN:TV → Komponente</strong> in jo tam dodaš v okno televizorja. Izklopljena komponenta se ne
          objavi. Objava = strani PDF kot slike 4K (3840 px), TV pokaže samo strani, ki veljajo danes. Stanje vseh objav je na strani{" "}
          <Link href="/podatki/tv" className="font-semibold text-sync-600 underline" title="Odpri stran Sync v TV">
            Sync v TV
          </Link>
          .
        </p>
        {izpisi.map((iz) => {
          const s = stanje?.get(iz.koda);
          const ocena = ocenaKomponente(iz.koda, s, tv.opravila);
          return (
            <section key={iz.koda} className="flex flex-col gap-2 rounded-xl border border-ink-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <StanjeIkona stanje={ocena.stanje} hint={ocena.opis} />
                <h3 className="mr-auto text-base font-bold text-ink-900">{iz.naslov}</h3>
                <Znacka s={s} nalagam={!stanje && !tv.napaka} />
              </div>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
                <Vrsta oznaka="Stanje">{ocena.opis}</Vrsta>
                <Vrsta oznaka="Vsebina">{iz.vsebina}</Vrsta>
                <Vrsta oznaka="Oblika">{iz.format}</Vrsta>
                <Vrsta oznaka="Objava">{iz.kdaj}</Vrsta>
                <Vrsta oznaka="Na TV">{iz.velja}</Vrsta>
                <Vrsta oznaka="Prenos PDF">{iz.prenos}</Vrsta>
                <Vrsta oznaka="Zadnja objava">
                  {s?.zadnja ? `${formatDatumUra(s.zadnja.cas)} · ${s.zadnja.strani} ${s.zadnja.strani === 1 ? "stran" : "strani"} · ${s.zadnja.izvor}` : stanje ? "še ni objave" : "…"}
                </Vrsta>
                <Vrsta oznaka="Komponenta">
                  <span className="font-mono text-xs">{iz.koda}</span>
                </Vrsta>
              </dl>
            </section>
          );
        })}
        {tv.napaka && <p className="text-xs text-ink-500">Stanja komponent ni mogoče prebrati (ni dostopa do FinOS).</p>}
      </div>
    </Modal>
  );
}

function Vrsta({ oznaka, children }: { oznaka: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="font-semibold text-ink-500">{oznaka}</dt>
      <dd className="text-ink-800">{children}</dd>
    </>
  );
}

function Znacka({ s, nalagam }: { s: StanjeTvKomponente | undefined; nalagam: boolean }) {
  if (nalagam) return <span className="rounded-full bg-ink-100 px-2 py-0.5 text-xs font-bold text-ink-500">…</span>;
  if (!s || s.vklopljena === null)
    return (
      <span className="rounded-full bg-nok-500 px-2 py-0.5 text-xs font-bold text-white" title="Komponente ni v FinOS (manjka migracija) ali ni dostopa">
        ni v FinOS
      </span>
    );
  return s.vklopljena ? (
    <span className="rounded-full bg-ok-500 px-2 py-0.5 text-xs font-bold text-white" title="Komponenta je vklopljena - objavlja se">
      vklopljena
    </span>
  ) : (
    <span className="rounded-full bg-ink-400 px-2 py-0.5 text-xs font-bold text-white" title="Komponenta je izklopljena v FinOS - nič se ne objavi">
      izklopljena
    </span>
  );
}
