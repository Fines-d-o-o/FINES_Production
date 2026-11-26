"use client";

import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Eraser, Plus, SearchCheck, Trash2 } from "lucide-react";
import { naloziIdente, type Ident } from "@/lib/kosovnice";
import {
  analizirajVisek,
  naloziIzdajeNalogov,
  naloziNalogeVisek,
  type Analiza,
  type K1Izdelek,
  type K2Nalog,
  type K3Nalog,
  type Kontrolni,
  type Ocena,
  type PostavkaViska,
  type RezultatPostavke,
  type VisIzdaja,
  type VisNalog,
} from "@/lib/visekMateriala";
import { formatDatumUra, formatShort } from "@/lib/dates";
import { ujemaIskanje } from "@/lib/iskanje";
import { formatNum, parseNum } from "@/lib/stevila";
import { supabaseConfigured } from "@/lib/supabase";
import { useSync } from "@/components/SyncProvider";
import { PodatkiVir } from "@/components/PodatkiVir";
import { Button, IconButton } from "@/components/ui/Button";
import { FilterPolje } from "@/components/ui/Filtri";
import { ConfigMissing, ErrorText, Loading, WarningText } from "@/components/ui/Notice";
import { Podrazdelek } from "@/components/ui/Podrazdelek";
import { SortTh, TabelaOkvir, useRazvrscanje } from "@/components/ui/Tabela";

// =====================================================================
// IZBIRA Z ISKANJEM (nalog / krovni, ident)
// =====================================================================

type Moznost = { kljuc: string; naslov: string; podnaslov?: string; iskanje: (string | null | undefined)[] };

function IzbiraIskanje({
  label,
  hint,
  placeholder,
  value,
  prikaz,
  moznosti,
  onChange,
  className = "",
}: {
  label?: string;
  hint: string;
  placeholder: string;
  value: string;
  prikaz: string;
  moznosti: Moznost[];
  onChange: (kljuc: string) => void;
  className?: string;
}) {
  const [odprt, setOdprt] = useState(false);
  const [iskanje, setIskanje] = useState("");
  const [aktivni, setAktivni] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const zadetki = useMemo(() => moznosti.filter((m) => ujemaIskanje(iskanje, m.iskanje)), [moznosti, iskanje]);
  const vidni = zadetki.slice(0, 100);
  useEffect(() => {
    if (!odprt) return;
    const zapri = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOdprt(false);
    };
    document.addEventListener("mousedown", zapri);
    return () => document.removeEventListener("mousedown", zapri);
  }, [odprt]);
  function izberi(k: string) {
    onChange(k);
    setOdprt(false);
    setIskanje("");
  }
  return (
    <div ref={ref} className={`relative min-w-0 ${className}`}>
      <FilterPolje label={label}>
        <button
          type="button"
          title={hint}
          aria-haspopup="listbox"
          aria-expanded={odprt}
          onClick={() => {
            setOdprt(!odprt);
            setAktivni(0);
          }}
          className="flex h-11 w-full items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 text-left text-base focus:border-fines-500 focus:outline-none focus:ring-2 focus:ring-fines-100 sm:h-10 sm:text-sm"
        >
          <span className={`min-w-0 flex-1 truncate ${value ? "" : "text-ink-400"}`}>{value ? prikaz : placeholder}</span>
          <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
        </button>
      </FilterPolje>
      {odprt && (
        <div
          className="absolute z-30 mt-1 w-full min-w-[min(100%,20rem)] rounded-lg border border-ink-200 bg-white p-2 shadow-lg"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOdprt(false);
              e.stopPropagation();
            }
          }}
        >
          <input
            autoFocus
            role="combobox"
            aria-label={`Išči: ${label ?? placeholder}`}
            aria-expanded={true}
            aria-controls={`${id}-seznam`}
            aria-activedescendant={vidni[aktivni] ? `${id}-${aktivni}` : undefined}
            title="Vpiši številko, šifro ali del naziva"
            value={iskanje}
            onChange={(e) => {
              setIskanje(e.target.value);
              setAktivni(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const n = Math.max(0, Math.min(vidni.length - 1, aktivni + (e.key === "ArrowDown" ? 1 : -1)));
                setAktivni(n);
                document.getElementById(`${id}-${n}`)?.scrollIntoView({ block: "nearest" });
              }
              if (e.key === "Enter" && vidni[aktivni]) {
                e.preventDefault();
                izberi(vidni[aktivni].kljuc);
              }
            }}
            placeholder="Številka, šifra ali naziv ..."
            className="mb-2 h-11 w-full rounded-lg border border-ink-200 px-3 text-base focus:border-fines-500 focus:outline-none focus:ring-2 focus:ring-fines-100 sm:h-10 sm:text-sm"
          />
          <div role="listbox" id={`${id}-seznam`} aria-label={label ?? placeholder} className="max-h-72 overflow-auto">
            {vidni.map((m, n) => (
              <button
                id={`${id}-${n}`}
                key={m.kljuc}
                role="option"
                aria-selected={m.kljuc === value}
                type="button"
                title={`Izberi ${m.naslov}`}
                onClick={() => izberi(m.kljuc)}
                className={`block w-full rounded px-2 py-2 text-left text-sm hover:bg-fines-50 ${n === aktivni ? "bg-ink-100" : ""}`}
              >
                <span className="font-semibold">{m.naslov}</span>
                {m.podnaslov && <span className="block text-xs text-ink-500">{m.podnaslov}</span>}
              </button>
            ))}
            {!vidni.length && <p className="p-2 text-sm text-ink-500">Ni zadetkov.</p>}
          </div>
          <p className="pt-2 text-xs text-ink-500">
            {zadetki.length} zadetkov{zadetki.length > 100 ? " · prikazanih prvih 100, zoži iskanje" : ""}
          </p>
        </div>
      )}
    </div>
  );
}

// =====================================================================
// ZNAČKE IN POMOŽNO
// =====================================================================

const OCENA: Record<Ocena, { label: string; cls: string; hint: string }> = {
  vzrok: { label: "Verjetni vzrok", cls: "bg-nok-500 text-white", hint: "Ta kontrola verjetno pojasni višek" },
  ok: { label: "Verjetno v redu", cls: "bg-ok-500 text-white", hint: "Ta kontrola verjetno ni vzrok viška" },
  nejasno: { label: "Nejasno", cls: "bg-warn-400 text-ink-900", hint: "Zanesljive ocene ni - preveri ročno" },
  kontrola: { label: "Potrebna kontrola", cls: "bg-fines-500 text-white", hint: "Vzrok ni najden - potrebna ročna kontrola" },
  ni_podatkov: { label: "Ni podatkov", cls: "bg-ink-300 text-ink-800", hint: "Za kontrolo ni dovolj podatkov" },
};

function Znacka({ ocena }: { ocena: Ocena }) {
  const o = OCENA[ocena];
  return (
    <span title={o.hint} className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${o.cls}`}>
      {o.label}
    </span>
  );
}

const st = (n: number | null | undefined) => (n === null || n === undefined ? "—" : formatNum(n));
const TABELA = "w-full text-sm [&_td]:px-2 [&_td]:py-1.5 [&_tbody_tr]:border-b [&_tbody_tr]:border-ink-100 [&_tbody_tr:hover]:bg-ink-50";
const prazno = (n: number, opis: string) => (n === 0 ? <p className="p-4 text-center text-sm text-ink-500">{opis}</p> : null);

// =====================================================================
// KONTROLA 1: TABELI KOSOVNIC
// =====================================================================

function KontrolniTabela({ kontrolni }: { kontrolni: Kontrolni[] }) {
  const sort = useRazvrscanje<Kontrolni, "sifra" | "naziv" | "podobnost" | "kolicina" | "komponenta">({
    sifra: (k) => k.sifra,
    naziv: (k) => k.naziv,
    podobnost: (k) => k.podobnost,
    kolicina: (k) => (k.rezultat && k.rezultat.tip !== "ni" ? k.rezultat.kolicina : null),
    komponenta: (k) => (k.rezultat && k.rezultat.tip !== "ni" ? k.rezultat.sifra : null),
  });
  if (!kontrolni.length) return <p className="p-2 text-xs text-ink-500">Ni izdelkov s podobnim nazivom.</p>;
  return (
    <table className={`${TABELA} bg-white text-xs`}>
      <thead className="fp-thead">
        <tr>
          <SortTh sort={sort} kljuc="sifra">Podoben izdelek</SortTh>
          <SortTh sort={sort} kljuc="naziv">Naziv</SortTh>
          <SortTh sort={sort} kljuc="podobnost" desno hint="Razvrsti po podobnosti naziva">Podobnost</SortTh>
          <SortTh sort={sort} kljuc="kolicina" desno>Kos na izdelek</SortTh>
          <SortTh sort={sort} kljuc="komponenta">Primerjana komponenta</SortTh>
        </tr>
      </thead>
      <tbody>
        {sort.razvrsti(kontrolni).map((k) => (
          <tr key={k.sifra}>
            <td className="whitespace-nowrap font-mono">{k.sifra}</td>
            <td>{k.naziv}</td>
            <td className="text-right tabular-nums">{Math.round(k.podobnost * 100)} %</td>
            <td className="text-right font-semibold tabular-nums">{k.rezultat && k.rezultat.tip !== "ni" ? formatNum(k.rezultat.kolicina) : "—"}</td>
            <td>
              {!k.rezultat ? (
                <span className="text-ink-500">ni kosovnice</span>
              ) : k.rezultat.tip === "ni" ? (
                <span className="text-ink-500">nima tega ali podobnega materiala - ni primerljivo</span>
              ) : k.rezultat.tip === "enak" ? (
                "isti ident"
              ) : (
                <span title={`Isti klasifikat, podobnost naziva ${Math.round(k.rezultat.podobnost * 100)} %`}>
                  enakovreden: <span className="font-mono">{k.rezultat.sifra}</span> {k.rezultat.naziv}
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function K1Tabela({ izdelki, em }: { izdelki: K1Izdelek[]; em: string }) {
  const [odprti, setOdprti] = useState<Set<string>>(() => new Set(izdelki.filter((i) => i.ocena === "vzrok").map((i) => i.koda)));
  const sort = useRazvrscanje<K1Izdelek, "koda" | "naziv" | "nalogi" | "razpisano" | "naIzdelek" | "skupaj" | "vecina" | "ocena">({
    koda: (i) => i.koda,
    naziv: (i) => i.naziv,
    nalogi: (i) => i.nalogi.join(", "),
    razpisano: (i) => i.razpisano,
    naIzdelek: (i) => i.naIzdelek,
    skupaj: (i) => (i.naIzdelek === null ? null : i.naIzdelek * i.razpisano),
    vecina: (i) => i.vecina?.kolicina,
    ocena: (i) => OCENA[i.ocena].label,
  });
  // privzeto: izdelki z identom najprej
  const vrstice = sort.kljuc ? sort.razvrsti(izdelki) : [...izdelki].sort((a, b) => Number(b.pojavitve.length > 0) - Number(a.pojavitve.length > 0));
  return (
    <TabelaOkvir>
      <table className={TABELA}>
        <thead className="fp-thead">
          <tr>
            <SortTh sort={sort} kljuc="koda">Izdelek</SortTh>
            <SortTh sort={sort} kljuc="naziv">Naziv</SortTh>
            <SortTh sort={sort} kljuc="nalogi">Nalog</SortTh>
            <SortTh sort={sort} kljuc="razpisano" desno>Razpisano</SortTh>
            <SortTh sort={sort} kljuc="naIzdelek" desno hint="Razvrsti po kosih identa na izdelek">{`Kos na izdelek`}</SortTh>
            <SortTh sort={sort} kljuc="skupaj" desno hint="Razvrsti po skupni potrebi naloga">{`Skupaj (${em})`}</SortTh>
            <SortTh sort={sort} kljuc="vecina" desno hint="Razvrsti po količini pri podobnih izdelkih">Podobni izdelki</SortTh>
            <SortTh sort={sort} kljuc="ocena">Ocena</SortTh>
          </tr>
        </thead>
        <tbody>
          {vrstice.map((i) => {
            const odprt = odprti.has(i.koda);
            return (
              <Fragment key={i.koda}>
                <tr className={i.pojavitve.length ? "" : "text-ink-500"}>
                  <td className="whitespace-nowrap">
                    <button
                      type="button"
                      title={odprt ? "Skrij podobne izdelke in mesta v kosovnici" : "Pokaži podobne izdelke in mesta v kosovnici"}
                      aria-expanded={odprt}
                      onClick={() =>
                        setOdprti((s) => {
                          const x = new Set(s);
                          if (x.has(i.koda)) x.delete(i.koda);
                          else x.add(i.koda);
                          return x;
                        })
                      }
                      className="inline-flex items-center gap-1 font-mono font-semibold text-fines-600 hover:text-fines-700"
                    >
                      {odprt ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
                      {i.koda}
                    </button>
                  </td>
                  <td className="min-w-48">{i.naziv}</td>
                  <td className="font-mono text-xs">{i.nalogi.join(", ")}</td>
                  <td className="text-right tabular-nums">{formatNum(i.razpisano)}</td>
                  <td className="text-right font-semibold tabular-nums">{i.naIzdelek === null ? <span className="font-normal text-ink-500">ni kosovnice</span> : formatNum(i.naIzdelek)}</td>
                  <td className="text-right tabular-nums">{i.naIzdelek === null ? "—" : formatNum(i.naIzdelek * i.razpisano)}</td>
                  <td className="text-right tabular-nums" title={i.vecina ? `${i.vecina.stevilo} od ${i.vecina.od} primerljivih podobnih izdelkov` : "Ni primerljivih podobnih izdelkov"}>
                    {i.vecina ? `${formatNum(i.vecina.kolicina)} (${i.vecina.stevilo}/${i.vecina.od})` : "—"}
                  </td>
                  <td>{i.pojavitve.length || i.ocena === "ni_podatkov" ? <Znacka ocena={i.ocena} /> : <span className="text-xs">ni v kosovnici</span>}</td>
                </tr>
                {odprt && (
                  <tr className="bg-ink-50 hover:bg-ink-50">
                    <td colSpan={8} className="!px-3 !py-3">
                      <p className="mb-2 text-sm">{i.besedilo}</p>
                      {i.pojavitve.length > 0 && (
                        <div className="mb-3">
                          <p className="text-xs font-semibold text-ink-600">Mesta v kosovnici</p>
                          <ul className="mt-1 flex flex-col gap-0.5 text-xs">
                            {i.pojavitve.map((p, n) => (
                              <li key={n}>
                                {[i.koda, ...p.pot.map((x) => x.sifra)].join(" › ")} › <b>{formatNum(p.naSestav)} kos</b>
                                {p.naIzdelek !== p.naSestav && <span className="text-ink-500"> (= {formatNum(p.naIzdelek)} na izdelek)</span>}
                                {p.drugNalog && <span className="text-sync-600"> · sestav {p.drugNalog} ima svoj nalog</span>}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <p className="mb-1 text-xs font-semibold text-ink-600">Podobni izdelki (kontrola)</p>
                      <div className="overflow-x-auto rounded-lg">
                        <KontrolniTabela kontrolni={i.kontrolni} />
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {prazno(izdelki.length, "Izbrani nalogi nimajo izdelkov.")}
    </TabelaOkvir>
  );
}

// =====================================================================
// KONTROLA 2 IN 3: TABELI
// =====================================================================

function K2Tabela({ nalogi }: { nalogi: K2Nalog[] }) {
  const sort = useRazvrscanje<K2Nalog, "nalog" | "koda" | "naziv" | "status" | "razpisano" | "kos" | "plan" | "izdano" | "razlika">({
    nalog: (n) => n.st_naloga,
    koda: (n) => n.koda,
    naziv: (n) => n.naziv,
    status: (n) => (n.zakljucen ? "zaključen" : "aktiven"),
    razpisano: (n) => n.razpisano,
    kos: (n) => n.poKosovnici,
    plan: (n) => n.planirano,
    izdano: (n) => n.izdano,
    razlika: (n) => n.razlika,
  });
  return (
    <TabelaOkvir>
      <table className={TABELA}>
        <thead className="fp-thead">
          <tr>
            <SortTh sort={sort} kljuc="nalog">Nalog</SortTh>
            <SortTh sort={sort} kljuc="koda">Izdelek</SortTh>
            <SortTh sort={sort} kljuc="naziv">Naziv</SortTh>
            <SortTh sort={sort} kljuc="status">Status</SortTh>
            <SortTh sort={sort} kljuc="razpisano" desno>Razpisano</SortTh>
            <SortTh sort={sort} kljuc="kos" desno hint="Razvrsti po potrebi po trenutni kosovnici">Po kosovnici</SortTh>
            <SortTh sort={sort} kljuc="plan" desno hint="Razvrsti po planu materiala na DN">Plan DN</SortTh>
            <SortTh sort={sort} kljuc="izdano" desno>Izdano</SortTh>
            <SortTh sort={sort} kljuc="razlika" desno hint="Razvrsti po razliki izdano − potrebno">Razlika</SortTh>
            <th className="px-2 py-2 text-left">Opombe</th>
          </tr>
        </thead>
        <tbody>
          {sort.razvrsti(nalogi).map((n) => (
            <tr key={n.st_naloga}>
              <td className="font-mono">{n.st_naloga}</td>
              <td className="whitespace-nowrap font-mono text-xs">{n.koda ?? "—"}</td>
              <td className="min-w-40">{n.naziv ?? "—"}</td>
              <td className="text-xs">{n.zakljucen ? "zaključen" : "aktiven"}</td>
              <td className="text-right tabular-nums">{formatNum(n.razpisano)}</td>
              <td className={`text-right tabular-nums ${n.osnova === "kosovnica" ? "font-semibold" : ""}`}>{n.poKosovnici === null ? <span className="text-ink-500">ni kosovnice</span> : formatNum(n.poKosovnici)}</td>
              <td className={`text-right tabular-nums ${n.osnova === "plan" ? "font-semibold" : ""}`}>{n.planirano === null ? <span className="text-ink-500">ni plana</span> : formatNum(n.planirano)}</td>
              <td className="text-right font-semibold tabular-nums">{n.izdano === null ? <span className="font-normal text-ink-500">ni podatka</span> : formatNum(n.izdano)}</td>
              <td
                className={`text-right font-bold tabular-nums ${(n.razlika ?? 0) > 1e-6 ? "text-nok-600" : (n.razlika ?? 0) < -1e-6 ? "text-sync-600" : "text-ok-600"}`}
                title={n.osnova === "plan" ? "Izdano − plan DN" : n.osnova === "kosovnica" ? "Izdano − potreba po kosovnici" : "Ni osnove za primerjavo"}
              >
                {n.razlika === null ? "—" : `${n.razlika > 1e-6 ? "+" : ""}${formatNum(n.razlika)}`}
              </td>
              <td className="min-w-56 text-xs text-ink-600">{n.opombe.join(" ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {prazno(nalogi.length, "Ident na izbranih nalogih ni ne planiran ne izdan in ni v njihovih kosovnicah.")}
    </TabelaOkvir>
  );
}

function K3Tabela({ nalogi, em }: { nalogi: K3Nalog[]; em: string }) {
  const sort = useRazvrscanje<K3Nalog, "nalog" | "koda" | "naziv" | "status" | "razpisano" | "prevzeto" | "neizdelano" | "naKos" | "ostanek" | "zadnji">({
    nalog: (n) => n.st_naloga,
    koda: (n) => n.koda,
    naziv: (n) => n.naziv,
    status: (n) => (n.zakljucen ? "zaključen" : "aktiven"),
    razpisano: (n) => n.razpisano,
    prevzeto: (n) => n.prevzeto,
    neizdelano: (n) => n.neizdelano,
    naKos: (n) => n.naKos,
    ostanek: (n) => n.ostanek,
    zadnji: (n) => n.zadnjiPrevzem,
  });
  return (
    <TabelaOkvir>
      <table className={TABELA}>
        <thead className="fp-thead">
          <tr>
            <SortTh sort={sort} kljuc="nalog">Nalog</SortTh>
            <SortTh sort={sort} kljuc="koda">Izdelek</SortTh>
            <SortTh sort={sort} kljuc="naziv">Naziv</SortTh>
            <SortTh sort={sort} kljuc="status">Status</SortTh>
            <SortTh sort={sort} kljuc="razpisano" desno>Razpisano</SortTh>
            <SortTh sort={sort} kljuc="prevzeto" desno hint="Razvrsti po prevzetih kosih na zalogo">Prevzeto</SortTh>
            <SortTh sort={sort} kljuc="neizdelano" desno hint="Razvrsti po neizdelanih kosih">Neizdelano</SortTh>
            <SortTh sort={sort} kljuc="naKos" desno hint="Razvrsti po kosih identa na izdelek">{`Ident na izdelek (${em})`}</SortTh>
            <SortTh sort={sort} kljuc="ostanek" desno hint="Razvrsti po ostanku materiala">{`Ostanek (${em})`}</SortTh>
            <SortTh sort={sort} kljuc="zadnji">Zadnji prevzem</SortTh>
          </tr>
        </thead>
        <tbody>
          {sort.razvrsti(nalogi).map((n) => (
            <tr key={n.st_naloga}>
              <td className="font-mono">{n.st_naloga}</td>
              <td className="whitespace-nowrap font-mono text-xs">{n.koda ?? "—"}</td>
              <td className="min-w-40">{n.naziv ?? "—"}</td>
              <td className="text-xs">{n.zakljucen ? "zaključen" : "aktiven"}</td>
              <td className="text-right tabular-nums">{formatNum(n.razpisano)}</td>
              <td className="text-right font-semibold tabular-nums">{n.prevzeto === null ? <span className="font-normal text-ink-500">ni podatka</span> : formatNum(n.prevzeto)}</td>
              <td className={`text-right tabular-nums ${(n.neizdelano ?? 0) > 1e-6 ? "font-semibold text-nok-600" : ""}`}>{st(n.neizdelano)}</td>
              <td className="text-right tabular-nums">{st(n.naKos)}</td>
              <td className={`text-right font-bold tabular-nums ${(n.ostanek ?? 0) > 1e-6 ? "text-nok-600" : "text-ok-600"}`}>{st(n.ostanek)}</td>
              <td className="whitespace-nowrap">{n.zadnjiPrevzem ? formatShort(n.zadnjiPrevzem) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TabelaOkvir>
  );
}

function PotrebeTabela({ vrstice }: { vrstice: VisIzdaja[] }) {
  const sort = useRazvrscanje<VisIzdaja, "nalog" | "koda" | "naziv" | "rok" | "plan" | "izdano" | "zaIzdajo">({
    nalog: (r) => r.st_naloga,
    koda: (r) => r.koda_artikla,
    naziv: (r) => r.naziv_artikla,
    rok: (r) => r.rok_izdelave,
    plan: (r) => r.planirano,
    izdano: (r) => r.porabljeno,
    zaIzdajo: (r) => r.za_izdajo,
  });
  return (
    <TabelaOkvir>
      <table className={TABELA}>
        <thead className="fp-thead">
          <tr>
            <SortTh sort={sort} kljuc="nalog">Nalog</SortTh>
            <SortTh sort={sort} kljuc="koda">Izdelek</SortTh>
            <SortTh sort={sort} kljuc="naziv">Naziv</SortTh>
            <SortTh sort={sort} kljuc="rok">Rok izdelave</SortTh>
            <SortTh sort={sort} kljuc="plan" desno>Plan DN</SortTh>
            <SortTh sort={sort} kljuc="izdano" desno>Izdano</SortTh>
            <SortTh sort={sort} kljuc="zaIzdajo" desno>Za izdajo</SortTh>
          </tr>
        </thead>
        <tbody>
          {sort.razvrsti(vrstice).map((r) => (
            <tr key={r.st_naloga}>
              <td className="font-mono">{r.st_naloga}</td>
              <td className="whitespace-nowrap font-mono text-xs">{r.koda_artikla ?? "—"}</td>
              <td className="min-w-40">{r.naziv_artikla ?? "—"}</td>
              <td className="whitespace-nowrap">{r.rok_izdelave ? formatShort(r.rok_izdelave) : "—"}</td>
              <td className="text-right tabular-nums">{st(r.planirano)}</td>
              <td className="text-right tabular-nums">{st(r.porabljeno)}</td>
              <td className="text-right font-semibold tabular-nums">{st(r.za_izdajo)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TabelaOkvir>
  );
}

// =====================================================================
// REZULTAT POSTAVKE
// =====================================================================

function Stevilka({ naslov, vrednost, hint, poudarek }: { naslov: string; vrednost: string; hint: string; poudarek?: boolean }) {
  return (
    <div title={hint} className={`rounded-lg border px-3 py-2 ${poudarek ? "border-fines-500 bg-fines-50" : "border-ink-200 bg-white"}`}>
      <p className="text-xs font-semibold text-ink-600">{naslov}</p>
      <p className="text-xl font-bold tabular-nums">{vrednost}</p>
    </div>
  );
}

function Rezultat({ r, zalogaUvozena, prevzemObdobje }: { r: RezultatPostavke; zalogaUvozena: string | null; prevzemObdobje: Analiza["prevzemObdobje"] }) {
  const { postavka: p, k1, k2, k3, k4, predlog } = r;
  const em = k4.zaloga?.em ?? p.em ?? "kos";
  return (
    <section className="fp-card flex min-w-0 flex-col gap-4 p-3 sm:p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-[min(100%,18rem)] flex-1">
          <h3 className="text-lg font-bold">
            <span className="font-mono text-fines-600">{p.ident}</span> · {p.naziv}
          </h3>
          <p className="text-sm text-ink-500">
            Višek: <b className="text-ink-800">{formatNum(p.kolicina)} {em}</b>
          </p>
        </div>
      </div>

      <div className={`rounded-lg border-l-4 px-3 py-2 ${predlog.ocena === "vzrok" ? "border-fines-500 bg-fines-50" : "border-warn-500 bg-warn-50"}`}>
        <p className="font-bold">{predlog.naslov}</p>
        <ul className="mt-1 list-disc pl-5 text-sm">
          {predlog.koraki.map((k) => (
            <li key={k}>{k}</li>
          ))}
        </ul>
      </div>

      <Podrazdelek st={1} naslov="Kontrola kosovnic" desno={<Znacka ocena={k1.ocena} />}>
        <p className="text-sm">{k1.povzetek}</p>
        <K1Tabela izdelki={k1.izdelki} em={em} />
        <p className="text-xs text-ink-500">Klik na izdelek pokaže mesta identa v kosovnici in podobne izdelke, s katerimi je primerjan (isti ident ali enakovredna komponenta istega klasifikata s podobnim nazivom).</p>
      </Podrazdelek>

      <Podrazdelek st={2} naslov="Kontrola izdanega materiala" desno={<Znacka ocena={k2.ocena} />}>
        <p className="text-sm">{k2.povzetek}</p>
        {k2.brezPodatkov.length > 0 && k2.ocena !== "ni_podatkov" && <WarningText>Za naloge {k2.brezPodatkov.join(", ")} ni podatkov o izdaji (nalog ni v izvozu izdaj ali še ni uvožen).</WarningText>}
        <K2Tabela nalogi={k2.nalogi} />
        <p className="text-xs text-ink-500">
          Razlika = izdano − plan DN (krepko). Nalog brez plana materiala v ERP se primerja s trenutno kosovnico. Sestavi z lastnim nalogom v istem krovnem se ne štejejo
          (njihov material gre na tisti nalog).
        </p>
      </Podrazdelek>

      <Podrazdelek st={3} naslov="Kontrola prevzema iz proizvodnje" desno={<Znacka ocena={k3.ocena} />}>
        <p className="text-sm">{k3.povzetek}</p>
        {k3.nalogi.length > 0 && <K3Tabela nalogi={k3.nalogi} em={em} />}
        <p className="text-xs text-ink-500">
          Ostanek = neizdelani kosi (razpisano − prevzeto) × kos identa na izdelek. Zaključen nalog brez prevzema v izvozu nima podatka
          {prevzemObdobje ? ` (izvoz prevzemov: ${prevzemObdobje.od ? formatShort(prevzemObdobje.od) : "?"} - ${prevzemObdobje.do ? formatShort(prevzemObdobje.do) : "?"})` : ""}.
        </p>
      </Podrazdelek>

      <Podrazdelek st={4} naslov="Kontrola zaloge" desno={<Znacka ocena={k4.ocena} />} poudarjen={k4.ocena === "kontrola"}>
        <p className="text-sm">{k4.povzetek}</p>
        {k4.zaloga && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stevilka naslov={`Matična zaloga (${em})`} vrednost={formatNum(k4.zaloga.zaloga)} hint="Zaloga v matičnem skladišču po sistemu" poudarek={k4.ocena === "kontrola"} />
            <Stevilka naslov="Razpoložljiva" vrednost={formatNum(k4.zaloga.razpolozljiva)} hint="Zaloga, zmanjšana za potrebe delovnih nalogov" />
            <Stevilka naslov="Potreba DN" vrednost={formatNum(k4.zaloga.potreba_dn)} hint="Še neizdane potrebe aktivnih delovnih nalogov" />
            <Stevilka naslov="Naročeno pri dobavitelju" vrednost={formatNum(k4.zaloga.narocena_kolicina)} hint="Odprta naročila pri dobaviteljih" />
          </div>
        )}
        {zalogaUvozena && <p className="text-xs text-ink-500">Stanje zaloge: uvoz {formatDatumUra(zalogaUvozena)} (Material pregled planirane porabe).</p>}
        {k4.potrebujejo.length > 0 && (
          <>
            <p className="text-xs font-semibold text-ink-600">Aktivni nalogi, ki ta ident še potrebujejo (kam z viškom)</p>
            <PotrebeTabela vrstice={k4.potrebujejo} />
          </>
        )}
      </Podrazdelek>
    </section>
  );
}

// =====================================================================
// STRAN
// =====================================================================

type Vrstica = { id: number; ident: string; kolicina: string };
type Obrazec = { izbor: string; vrstice: Vrstica[] };
const KLJUC = "fines-visek-materiala";
const nova = (): Vrstica => ({ id: Date.now() + Math.random(), ident: "", kolicina: "" });
function preberiObrazec(): Obrazec {
  try {
    const s = JSON.parse(localStorage.getItem(KLJUC) ?? "null") as Partial<Obrazec> | null;
    const vrstice = Array.isArray(s?.vrstice) ? s.vrstice.filter((v) => v && typeof v.ident === "string").map((v) => ({ id: Number(v.id) || Date.now() + Math.random(), ident: v.ident, kolicina: String(v.kolicina ?? "") })) : [];
    return { izbor: typeof s?.izbor === "string" ? s.izbor : "", vrstice: vrstice.length ? vrstice : [nova()] };
  } catch {
    return { izbor: "", vrstice: [nova()] };
  }
}

/** "K:2309" = krovni, "N:261030" = nalog. */
const razberi = (izbor: string) => ({ krovni: izbor.startsWith("K:") ? izbor.slice(2) : null, nalog: izbor.startsWith("N:") ? izbor.slice(2) : null });

export function VisekMateriala() {
  if (!supabaseConfigured) return <ConfigMissing />;
  return <VisekOsvezevanje />;
}
function VisekOsvezevanje() {
  const { verzija } = useSync();
  return <Visek key={verzija} />;
}

function Visek() {
  const [obrazec, setObrazec] = useState<Obrazec>(() => preberiObrazec());
  function spremeni(o: Partial<Obrazec>) {
    setObrazec((s) => {
      const n = { ...s, ...o };
      try {
        localStorage.setItem(KLJUC, JSON.stringify(n));
      } catch {
        /* brez shrambe velja do osvežitve */
      }
      return n;
    });
  }
  const [nalogi, setNalogi] = useState<VisNalog[]>([]);
  const [identi, setIdenti] = useState<Ident[]>([]);
  const [opozorilo, setOpozorilo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [napaka, setNapaka] = useState("");
  const [naNalogu, setNaNalogu] = useState<Map<string, VisIzdaja>>(new Map());
  const [analiza, setAnaliza] = useState<Analiza | null>(null);
  const [preverjam, setPreverjam] = useState(false);
  const [napakaAnalize, setNapakaAnalize] = useState("");

  useEffect(() => {
    let zivo = true;
    Promise.allSettled([naloziNalogeVisek(), naloziIdente()]).then(([n, i]) => {
      if (!zivo) return;
      if (n.status === "fulfilled") {
        setNalogi(n.value.nalogi);
        setOpozorilo(n.value.opozorilo);
      } else setNapaka(`Nalogov ni mogoče prebrati: ${n.reason?.message ?? n.reason}`);
      if (i.status === "fulfilled") setIdenti(i.value);
      else setNapaka((x) => x || `Identov ni mogoče prebrati: ${i.reason?.message ?? i.reason}`);
      setLoading(false);
    });
    return () => {
      zivo = false;
    };
  }, []);

  const { krovni, nalog } = razberi(obrazec.izbor);
  const izbraniNalogi = useMemo(
    () => (krovni ? nalogi.filter((n) => n.krovni_dn === krovni || n.st_naloga === krovni) : nalog ? nalogi.filter((n) => n.st_naloga === nalog) : []),
    [nalogi, krovni, nalog],
  );

  // Material izbranih nalogov - identi z nalogov so v izbiri na vrhu
  const stevilkeKljuc = izbraniNalogi.map((n) => n.st_naloga).join(",") || nalog || "";
  useEffect(() => {
    let zivo = true;
    const st = stevilkeKljuc ? stevilkeKljuc.split(",") : [];
    (st.length ? naloziIzdajeNalogov(st) : Promise.resolve({ izdaje: [] as VisIzdaja[] }))
      .then((r) => {
        if (!zivo) return;
        const m = new Map<string, VisIzdaja>();
        for (const x of r.izdaje) if (!m.has(x.ident)) m.set(x.ident, x);
        setNaNalogu(m);
      })
      .catch(() => zivo && setNaNalogu(new Map()));
    return () => {
      zivo = false;
    };
  }, [stevilkeKljuc]);

  const moznostiNalogov = useMemo<Moznost[]>(() => {
    const poKrovnem = new Map<string, VisNalog[]>();
    for (const n of nalogi) if (n.krovni_dn) poKrovnem.set(n.krovni_dn, [...(poKrovnem.get(n.krovni_dn) ?? []), n]);
    const stevilka = (a: string, b: string) => b.localeCompare(a, "sl", { numeric: true });
    const krovni: Moznost[] = [...poKrovnem.entries()]
      .sort((a, b) => stevilka(a[0], b[0]))
      .map(([k, nn]) => ({
        kljuc: `K:${k}`,
        naslov: `Krovni ${k} · ${nn.length} ${nn.length === 1 ? "nalog" : nn.length === 2 ? "naloga" : nn.length < 5 ? "nalogi" : "nalogov"}`,
        podnaslov: `${[...new Set(nn.map((n) => n.naziv_artikla ?? n.koda_artikla))].slice(0, 3).join(", ")}${nn.every((n) => n.zakljucen) ? " · zaključen" : ""}`,
        iskanje: [`krovni ${k}`, ...nn.map((n) => n.st_naloga)],
      }));
    const posamezni: Moznost[] = [...nalogi]
      .sort((a, b) => stevilka(a.st_naloga, b.st_naloga))
      .map((n) => ({
        kljuc: `N:${n.st_naloga}`,
        naslov: `Nalog ${n.st_naloga} · ${n.naziv_artikla ?? n.koda_artikla ?? ""}`,
        podnaslov: [n.koda_artikla, n.krovni_dn ? `krovni ${n.krovni_dn}` : null, n.razpisana_kolicina !== null ? `${formatNum(n.razpisana_kolicina)} kos` : null, n.zakljucen ? "zaključen" : "aktiven"].filter(Boolean).join(" · "),
        iskanje: [n.st_naloga, n.koda_artikla, n.naziv_artikla, n.krovni_dn ? `krovni ${n.krovni_dn}` : null],
      }));
    return [...krovni, ...posamezni];
  }, [nalogi]);

  const poIdentu = useMemo(() => new Map(identi.map((i) => [i.sifra, i])), [identi]);
  const moznostiIdentov = useMemo<Moznost[]>(() => {
    const na = [...naNalogu.values()].map((x) => ({
      kljuc: x.ident,
      naslov: `${x.ident} · ${x.naziv ?? poIdentu.get(x.ident)?.naziv ?? ""}`,
      podnaslov: "na izbranem nalogu",
      iskanje: [x.ident, x.naziv, poIdentu.get(x.ident)?.naziv],
    }));
    const ostali = identi.filter((i) => !naNalogu.has(i.sifra)).map((i) => ({ kljuc: i.sifra, naslov: `${i.sifra} · ${i.naziv ?? ""}`, iskanje: [i.sifra, i.naziv, i.risp_sifra] }));
    return [...na.sort((a, b) => a.kljuc.localeCompare(b.kljuc, "sl", { numeric: true })), ...ostali];
  }, [identi, naNalogu, poIdentu]);

  const prikazIzbora = moznostiNalogov.find((m) => m.kljuc === obrazec.izbor)?.naslov ?? (nalog ? `Nalog ${nalog}` : krovni ? `Krovni ${krovni}` : "");
  const nazivIdenta = (ident: string) => poIdentu.get(ident)?.naziv ?? naNalogu.get(ident)?.naziv ?? "";
  const veljavne: PostavkaViska[] = obrazec.vrstice
    .map((v) => ({ v, kol: parseNum(v.kolicina) }))
    .filter(({ v, kol }) => v.ident && kol !== null && kol > 0)
    .map(({ v, kol }) => ({ ident: v.ident, naziv: nazivIdenta(v.ident), em: poIdentu.get(v.ident)?.em ?? naNalogu.get(v.ident)?.em ?? null, kolicina: kol! }));
  const nepopolne = obrazec.vrstice.filter((v) => (v.ident || v.kolicina) && !veljavne.some((p) => p.ident === v.ident)).length;
  const zakaj = !obrazec.izbor ? "Najprej izberi krovni ali delovni nalog" : !veljavne.length ? "Dodaj vsaj en artikel s količino viška" : "Preveri vzroke viška za vpisane artikle";

  function vrstica(id: number, o: Partial<Vrstica>) {
    spremeni({ vrstice: obrazec.vrstice.map((v) => (v.id === id ? { ...v, ...o } : v)) });
    setAnaliza(null);
  }
  async function preveri() {
    setPreverjam(true);
    setNapakaAnalize("");
    setAnaliza(null);
    try {
      // isti ident večkrat = seštej
      const sest = new Map<string, PostavkaViska>();
      for (const p of veljavne) {
        const o = sest.get(p.ident);
        sest.set(p.ident, o ? { ...o, kolicina: o.kolicina + p.kolicina } : p);
      }
      setAnaliza(await analizirajVisek({ krovni, nalog }, nalogi, [...sest.values()]));
    } catch (e) {
      setNapakaAnalize(e instanceof Error ? e.message : String(e));
    } finally {
      setPreverjam(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-[min(100%,18rem)] flex-1">
          <h2 className="text-xl font-bold">Višek materiala</h2>
          <p className="text-sm text-ink-500">Vpiši nalog in material, ki je ostal na celici, nato klikni Preveri - aplikacija poišče verjetni vzrok in predlaga, kaj narediti.</p>
        </div>
        <PodatkiVir kljuci={["nalogi", "izdaje", "prevzemi_proizvodnje", "kosovnice", "material"]} />
      </div>
      {napaka && <ErrorText>{napaka}</ErrorText>}
      {opozorilo && <WarningText>{opozorilo}</WarningText>}

      {loading ? (
        <Loading />
      ) : (
        <section className="fp-card flex min-w-0 flex-col gap-5 p-3 sm:p-4">
          <Podrazdelek st={1} naslov="Nalog" poudarjen={!obrazec.izbor}>
            <IzbiraIskanje
              label="Krovni ali delovni nalog"
              hint="Izberi krovni ali delovni nalog z viškom"
              placeholder="Izberi krovni ali delovni nalog ..."
              value={obrazec.izbor}
              prikaz={prikazIzbora}
              moznosti={moznostiNalogov}
              onChange={(k) => {
                spremeni({ izbor: k });
                setAnaliza(null);
              }}
              className="w-full lg:max-w-2xl"
            />
            {izbraniNalogi.length > 0 && (
              <p className="text-xs text-ink-500">
                {krovni ? `Krovni ${krovni}: ` : ""}
                {izbraniNalogi.map((n) => `${n.st_naloga} (${n.koda_artikla ?? "?"}${n.zakljucen ? ", zaključen" : ""})`).join(" · ")}
              </p>
            )}
          </Podrazdelek>

          <Podrazdelek st={2} naslov="Višek materiala" poudarjen={!!obrazec.izbor && !veljavne.length}>
            <div className="flex flex-col gap-2">
              {obrazec.vrstice.map((v, n) => (
                <div key={v.id} className="flex min-w-0 flex-wrap items-end gap-2 border-b border-ink-100 pb-2 sm:flex-nowrap sm:border-0 sm:pb-0">
                  <IzbiraIskanje
                    label={n === 0 ? "Ident / naziv" : undefined}
                    hint="Poišči ident po šifri ali nazivu"
                    placeholder="Poišči ident ali naziv ..."
                    value={v.ident}
                    prikaz={v.ident ? `${v.ident} · ${nazivIdenta(v.ident)}` : ""}
                    moznosti={moznostiIdentov}
                    onChange={(k) => vrstica(v.id, { ident: k })}
                    className="w-full sm:flex-1"
                  />
                  <FilterPolje label={n === 0 ? "Kosov viška" : undefined} className="w-28 shrink-0">
                    <input
                      inputMode="decimal"
                      value={v.kolicina}
                      onChange={(e) => vrstica(v.id, { kolicina: e.target.value })}
                      placeholder="Kos"
                      title="Vpiši število kosov viška"
                      aria-label="Kosov viška"
                      className="h-11 w-full rounded-lg border border-ink-200 bg-white px-3 text-right text-base tabular-nums focus:border-fines-500 focus:outline-none focus:ring-2 focus:ring-fines-100 sm:h-10 sm:text-sm"
                    />
                  </FilterPolje>
                  <span className="w-12 shrink-0 pb-2.5 text-xs text-ink-500">{v.ident ? (poIdentu.get(v.ident)?.em ?? naNalogu.get(v.ident)?.em ?? "") : ""}</span>
                  <IconButton
                    variant="danger"
                    icon={Trash2}
                    hint="Odstrani artikel s seznama viška"
                    disabled={obrazec.vrstice.length === 1 && !v.ident && !v.kolicina}
                    onClick={() => {
                      const ostale = obrazec.vrstice.filter((x) => x.id !== v.id);
                      spremeni({ vrstice: ostale.length ? ostale : [nova()] });
                      setAnaliza(null);
                    }}
                  />
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="success" icon={Plus} hint="Dodaj nov artikel na seznam viška" onClick={() => spremeni({ vrstice: [...obrazec.vrstice, nova()] })}>
                Dodaj artikel
              </Button>
              {nepopolne > 0 && <span className="text-xs text-warn-700">{nepopolne} vrstic brez identa ali količine se ne preveri.</span>}
            </div>
          </Podrazdelek>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-ink-100 pt-4">
            <Button
              variant="neutral"
              icon={Eraser}
              hint="Počisti nalog in seznam viška"
              onClick={() => {
                spremeni({ izbor: "", vrstice: [nova()] });
                setAnaliza(null);
              }}
            >
              Nov vnos
            </Button>
            <Button variant="primary" size="lg" icon={SearchCheck} hint={zakaj} disabled={!obrazec.izbor || !veljavne.length || preverjam} onClick={() => void preveri()}>
              {preverjam ? "Preverjam ..." : "Preveri"}
            </Button>
          </div>
        </section>
      )}

      {preverjam && <Loading />}
      {napakaAnalize && <ErrorText>{napakaAnalize}</ErrorText>}
      {analiza && (
        <>
          {analiza.opozorila.map((o) => (
            <WarningText key={o}>{o}</WarningText>
          ))}
          {analiza.rezultati.map((r) => (
            <Rezultat key={r.postavka.ident} r={r} zalogaUvozena={analiza.zalogaUvozena} prevzemObdobje={analiza.prevzemObdobje} />
          ))}
          <p className="text-xs text-ink-500">
            Ocene so verjetnosti iz podatkov ERP (kosovnice se izvozijo 1× na dan, izdaje in zaloge ob syncu) - končno odločitev naredi vodja skladišča.
          </p>
        </>
      )}
    </div>
  );
}
