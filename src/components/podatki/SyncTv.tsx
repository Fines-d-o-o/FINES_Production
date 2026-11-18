"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { formatDatumUra } from "@/lib/dates";
import { supabaseConfigured } from "@/lib/supabase";
import {
  SKUPINE_TV,
  napredekOpravila,
  ocenaKomponente,
  ocenaSkupine,
  type SkupinaTv,
  type StanjeTv,
} from "@/lib/tvStanje";
import { objaviDeloVOzadju, objaviPlanVOzadju, objaviPripravljenostVOzadju, objaviVseNaTvVOzadju, objaviZakljuceneVOzadju } from "@/lib/tvOpravila";
import { SYNC_DATOTEKE } from "@/lib/syncDatoteke";
import { useSync } from "@/components/SyncProvider";
import { casSync } from "@/components/SyncGlava";
import { useStanjeTv } from "@/components/TvProvider";
import { Button } from "@/components/ui/Button";
import { FilterPolje, FilterVrstica } from "@/components/ui/Filtri";
import { ConfigMissing, ErrorText, SuccessText, WarningText } from "@/components/ui/Notice";
import { StanjeIkona } from "@/components/ui/StanjeIkona";

const RAMKA: Record<StanjeTv, string> = {
  ok: "border-ok-500",
  v_teku: "border-sync-500",
  caka: "border-sync-500",
  opozorilo: "border-warn-500",
  napaka: "border-nok-500",
  neznano: "border-ink-200",
};

export function SyncTv() {
  if (!supabaseConfigured) return <ConfigMissing />;
  return <SyncTvInner />;
}

function SyncTvInner() {
  const tv = useStanjeTv();
  const tece = tv.opravila.some((o) => o.stanje === "tece" || o.stanje === "caka");

  return (
    <div className="flex flex-col gap-4">
      {/* ============ GLAVA ============ */}
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto min-w-[min(100%,18rem)] flex-1">
          <h2 className="text-xl font-bold text-ink-900">Sync v TV</h2>
          <p className="text-sm text-ink-500">
            Objava komponent na televizorje FIN:TV. Delovni plan se objavi ob Shrani plan ali z gumbom Sync; Delo - prejšnji
            dan in Zaključeni krovni se objavita sama ob uvozu Poročanega dela, Pripravljenost materiala ob uvozu izdaj, materiala,
            naročil ali nalogov. Objava teče v ozadju tega zavihka - lahko delaš naprej, zavihka pa ne zapiraj.
          </p>
        </div>
      </div>

      {/* ============ OPOZORILA ============ */}
      {tv.napaka && <ErrorText>Stanja komponent ni mogoče prebrati iz FinOS: {tv.napaka}</ErrorText>}
      {tece && (
        <WarningText>
          Objava na TV teče v ozadju. Lahko greš na druge strani, zavihka (ali brskalnika) pa ne zapiraj, dokler se ne konča - sicer
          se objava prekine.
        </WarningText>
      )}

      {/* ============ UKAZI ============ */}
      <div className="fp-card p-3 sm:p-4">
        <FilterVrstica>
          <FilterPolje label="Preverjeno">
            <div className="flex h-10 items-center text-sm tabular-nums text-ink-700" title="Kdaj je bilo stanje komponent prebrano iz FinOS">
              {tv.preverjeno ? casSync(tv.preverjeno) : "še ne"}
            </div>
          </FilterPolje>
          <FilterPolje label="Sync">
            <Button hint="Objavi na TV vse komponente: delovni plan vseh oddelkov, pripravljenost materiala, delo prejšnjega dne in zaključene krovne" variant="sync" icon={RefreshCw} onClick={objaviVseNaTvVOzadju}>
              Sync vse
            </Button>
          </FilterPolje>
          <FilterPolje label="Prikaz">
            <Button hint="Znova preberi stanje komponent iz FinOS" variant="neutral" onClick={tv.osvezi}>
              Osveži stanje
            </Button>
          </FilterPolje>
        </FilterVrstica>
      </div>

      {/* ============ SKUPINE KOMPONENT ============ */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {SKUPINE_TV.map((s) => (
          <KvadratekSkupine key={s.id} s={s} />
        ))}
      </div>
    </div>
  );
}

function KvadratekSkupine({ s }: { s: SkupinaTv }) {
  const tv = useStanjeTv();
  const sync = useSync();
  const ocena = ocenaSkupine(s, tv.komponente, tv.opravila);
  const o = tv.opravila.find((x) => x.id === s.id);
  const dela = o?.stanje === "tece" || o?.stanje === "caka";
  // Zadnji uvoz datotek, ob katerih se skupina objavi sama
  const uvozi = s.samodejno.map((k) => ({ naslov: SYNC_DATOTEKE[k].naslov, cas: sync.datoteke.find((d) => d.kljuc === k)?.uvozeno ?? null }));
  const objavi = () =>
    s.oddelek
      ? objaviPlanVOzadju(s.oddelek)
      : s.id === "pripravljenost"
        ? objaviPripravljenostVOzadju("Sync v TV")
        : s.id === "delo"
          ? objaviDeloVOzadju("Sync v TV")
          : s.id === "zakljuceni"
            ? objaviZakljuceneVOzadju("Sync v TV")
            : undefined;

  return (
    <section className={`fp-card flex flex-col gap-3 border-l-4 p-3 ${RAMKA[ocena.stanje]}`} aria-label={s.naslov}>
      <div className="flex items-start gap-2">
        <StanjeIkona stanje={ocena.stanje} hint={ocena.opis} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-ink-900">{s.naslov}</h3>
          {s.samodejno.length ? (
            <p className="text-xs text-ink-500">
              <span
                className="mr-1.5 inline-block rounded-full bg-sync-500 px-2 py-0.5 text-xs font-bold text-white"
                title={`Objavi se sama ob vsakem uvozu: ${uvozi.map((u) => u.naslov).join(", ")}`}
              >
                Samodejno ob syncu
              </span>
              {uvozi.map((u, i) => (
                <span key={u.naslov}>
                  {i > 0 && " · "}
                  {u.naslov}: <span className="tabular-nums">{casSync(u.cas)}</span>
                </span>
              ))}
            </p>
          ) : (
            <p className="text-xs text-ink-500">Workflow in pregled za vsak teden do konca plana. Objava ob Shrani plan ali s Sync.</p>
          )}
        </div>
        {s.rocno && (
          <Button
            hint={s.oddelek ? `Objavi delovni plan (${s.naslov.split(" · ")[1]}) na TV` : `Objavi ${s.naslov} na TV`}
            variant="sync"
            icon={o?.stanje === "tece" ? Loader2 : RefreshCw}
            disabled={dela}
            onClick={objavi}
            className={o?.stanje === "tece" ? "[&>svg]:animate-spin" : ""}
          >
            Sync
          </Button>
        )}
      </div>

      {/* napredek objave */}
      {dela && o && (
        <div className="flex flex-col gap-1" title={o.stanje === "caka" ? "Čaka, da se konča objava pred njo" : "Objava teče v ozadju"}>
          <div className="h-2 overflow-hidden rounded-full bg-sync-50">
            <div
              className={`h-full rounded-full bg-sync-500 transition-[width] duration-500 ${o.stanje === "caka" || !o.vseh ? "animate-pulse" : ""}`}
              style={{ width: o.vseh ? `${Math.max(4, (o.korak / o.vseh) * 100)}%` : o.stanje === "caka" ? "0%" : "15%" }}
            />
          </div>
          <span className="text-xs font-semibold text-sync-600">
            {o.stanje === "caka" ? "Čaka v vrsti ..." : `Objavljam${napredekOpravila(o)} ...`}
          </span>
        </div>
      )}

      {/* komponente */}
      <ul className="flex flex-col divide-y divide-ink-100 text-sm">
        {s.komponente.map((k) => {
          const st = tv.komponente?.get(k.koda);
          const oc = ocenaKomponente(k.koda, st, tv.opravila);
          return (
            <li key={k.koda} className="flex items-start gap-2 py-1.5" title={`${oc.opis} · komponenta ${k.koda}`}>
              <StanjeIkona stanje={oc.stanje} className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-ink-800">{k.naslov}</span>
                  <span className="shrink-0 text-xs tabular-nums text-ink-500" title="Koliko strani TV kaže danes">
                    {st?.zadnja ? `danes ${st.zadnja.danes} / ${st.zadnja.strani} str.` : ""}
                  </span>
                </div>
                <p className="text-xs text-ink-500">
                  {oc.opis}
                  {st?.zadnja?.izvor && oc.stanje !== "v_teku" && oc.stanje !== "caka" ? ` · ${st.zadnja.izvor}` : ""}
                </p>
              </div>
            </li>
          );
        })}
      </ul>

      {/* rezultat zadnje objave v tej seji */}
      {o?.stanje === "ok" && o.sporocilo && (
        <SuccessText>
          {formatDatumUra(o.cas)}: {o.sporocilo}
        </SuccessText>
      )}
      {o?.stanje === "napaka" && <ErrorText>Objava ni uspela: {o.sporocilo}</ErrorText>}
    </section>
  );
}
