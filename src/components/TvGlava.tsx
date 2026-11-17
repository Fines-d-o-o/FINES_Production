"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RefreshCw, Tv } from "lucide-react";
import { SKUPINE_TV, najhujse, napredekOpravila, ocenaSkupine, zadnjaObjavaSkupine } from "@/lib/tvStanje";
import { objaviVsePlaneVOzadju } from "@/lib/tvOpravila";
import { casSync } from "./SyncGlava";
import { useStanjeTv } from "./TvProvider";
import { Button } from "./ui/Button";
import { StanjeIkona } from "./ui/StanjeIkona";

/**
 * Okrogel gumb FIN:TV v glavi (levo od Sync): ikona stanja objav v kotu (StanjeIkona), klik odpre seznam skupin
 * komponent (delovni plan po oddelkih, samodejne ob syncu) z gumboma Podrobnosti (stran Sync v TV) in Sync vse.
 * Na telefonu (pod sm) je skrit, da glava ostane v 360 px - stanje je na strani Sync v TV.
 */
export function TvGlava() {
  const tv = useStanjeTv();
  const [odprt, setOdprt] = useState(false);
  const okvir = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!odprt) return;
    const klik = (e: MouseEvent) => {
      if (okvir.current && !okvir.current.contains(e.target as Node)) setOdprt(false);
    };
    const tipka = (e: KeyboardEvent) => e.key === "Escape" && setOdprt(false);
    document.addEventListener("mousedown", klik);
    document.addEventListener("keydown", tipka);
    return () => {
      document.removeEventListener("mousedown", klik);
      document.removeEventListener("keydown", tipka);
    };
  }, [odprt]);

  const skupine = SKUPINE_TV.map((s) => ({ s, ocena: ocenaSkupine(s, tv.komponente, tv.opravila) }));
  const skupno = najhujse(skupine.map(({ s, ocena }) => ({ naslov: s.naslov, ocena })));
  const nalagam = !tv.komponente && !tv.napaka && skupno.stanje === "neznano";
  const hint = `Objave na FIN:TV - ${nalagam ? "preverjam stanje ..." : tv.napaka ? "stanja ni mogoče prebrati" : skupno.opis}`;
  const tece = tv.opravila.some((o) => o.stanje === "tece" || o.stanje === "caka");

  return (
    <div ref={okvir} className="relative hidden sm:block">
      <button
        type="button"
        title={hint}
        aria-label="Objave na FIN:TV"
        aria-expanded={odprt}
        onClick={() => setOdprt((o) => !o)}
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-ink-200 bg-white text-sync-500 transition-colors hover:bg-sync-50"
      >
        <Tv className="h-5 w-5" aria-hidden />
        {!nalagam && <StanjeIkona stanje={tv.napaka ? "neznano" : skupno.stanje} className="absolute -right-1 -top-1" />}
      </button>
      {odprt && (
        <div className="fp-card fixed inset-x-2 top-[68px] z-50 flex flex-col gap-3 p-3 shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-[26rem]">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="font-bold text-ink-900">Objave na FIN:TV</h3>
            <span className="truncate text-xs text-ink-500" title="Kdaj je bilo stanje komponent nazadnje prebrano iz FinOS">
              {tv.preverjeno ? `preverjeno ${casSync(tv.preverjeno)}` : tv.napaka ? "FinOS ni dosegljiv" : "preverjam ..."}
            </span>
          </div>
          <ul className="flex flex-col divide-y divide-ink-100 text-sm">
            {skupine.map(({ s, ocena }) => {
              const o = tv.opravila.find((x) => x.id === s.id && x.stanje === "tece");
              const zadnja = zadnjaObjavaSkupine(s, tv.komponente);
              return (
                <li key={s.id} className="flex items-center gap-2 py-1.5" title={ocena.opis}>
                  <StanjeIkona stanje={ocena.stanje} />
                  <span className="min-w-0 flex-1 truncate font-semibold text-ink-800">{s.naslov}</span>
                  <span className="shrink-0 text-right text-xs tabular-nums text-ink-500">
                    {o ? `objavljam${napredekOpravila(o)}` : s.samodejno.length ? `ob syncu · ${casSync(zadnja)}` : casSync(zadnja)}
                  </span>
                </li>
              );
            })}
          </ul>
          {tece && <p className="text-xs font-medium text-warn-700">Objava teče - zavihka ne zapiraj, dokler se ne konča.</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Link
              href="/podatki/tv"
              onClick={() => setOdprt(false)}
              title="Odpri stran s stanjem objav na TV"
              className="inline-flex h-10 items-center rounded-lg border border-ink-200 bg-white px-4 text-sm font-bold text-ink-700 hover:bg-ink-100"
            >
              Podrobnosti
            </Link>
            <Button hint="Objavi delovni plan vseh oddelkov na TV" variant="sync" icon={RefreshCw} onClick={objaviVsePlaneVOzadju}>
              Sync vse
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
