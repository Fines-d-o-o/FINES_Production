"use client";

import { useEffect, useMemo, useState } from "react";
import { naloziNormative, type Normativ } from "@/lib/normativi";
import { naloziOperacijeNormativov, vsotaOperacij, type OperacijeNormativov } from "@/lib/normativiOperacije";
import { formatNum } from "@/lib/stevila";
import { MultiSelect } from "@/components/ui/MultiSelect";
import { ErrorText, Loading, WarningText } from "@/components/ui/Notice";
import { FilterIskanje, FilterPreklopnik, FilterVrstica } from "@/components/ui/Filtri";
import { SortTh, TabelaOkvir, useRazvrscanje } from "@/components/ui/Tabela";

type Stanje = "RAZDELJEN" | "NI" | "NEUSKLAJEN";
type FStanje = "VSI" | Stanje;

type Vrstica = Normativ & { ure: Map<number, number> | undefined; vsota: number; stanje: Stanje };

const STANJE: Record<Stanje, { label: string; cls: string; hint: string }> = {
  RAZDELJEN: { label: "Razdeljen", cls: "bg-ok-50 text-ok-600", hint: "Vsota operacij je enaka normativu proizvodnje" },
  NI: { label: "Ni razdeljen", cls: "bg-ink-100 text-ink-600", hint: "Normativ proizvodnje še nima operacij" },
  NEUSKLAJEN: { label: "Vsota ≠ P", cls: "bg-warn-50 text-warn-700", hint: "Vsota operacij ni enaka normativu proizvodnje" },
};

/** Zavihek "Operacije proizvodnje": razdelitev normativa proizvodnje na operacije (stroje). Samo pregled. */
export function NormativiOperacije() {
  const [normativi, setNormativi] = useState<Normativ[] | null>(null);
  const [ops, setOps] = useState<OperacijeNormativov | null>(null);
  const [napaka, setNapaka] = useState<string | null>(null);
  const [iskanje, setIskanje] = useState("");
  const [druzine, setDruzine] = useState<string[]>([]);
  const [fStanje, setFStanje] = useState<FStanje>("VSI");

  useEffect(() => {
    Promise.all([naloziNormative(true), naloziOperacijeNormativov()])
      .then(([n, o]) => {
        setNormativi(n);
        setOps(o);
      })
      .catch((e: Error) => setNapaka(e.message));
  }, []);

  const vrstice = useMemo<Vrstica[]>(() => {
    if (!normativi || !ops) return [];
    return normativi
      .filter((n) => n.normativ_proizvodnja > 0)
      .map((n) => {
        const ure = ops.ure.get(n.id);
        const vsota = vsotaOperacij(ure);
        const stanje: Stanje = !ure || ure.size === 0 ? "NI" : Math.abs(vsota - n.normativ_proizvodnja) > 0.0005 ? "NEUSKLAJEN" : "RAZDELJEN";
        return { ...n, ure, vsota, stanje };
      });
  }, [normativi, ops]);

  const vseDruzine = useMemo(() => [...new Set(vrstice.map((v) => v.druzina).filter(Boolean))].sort(), [vrstice]);

  const filtrirane = useMemo(() => {
    const q = iskanje.trim().toLowerCase();
    return vrstice.filter(
      (v) =>
        (!q || v.ident.toLowerCase().includes(q) || v.naziv.toLowerCase().includes(q)) &&
        (!druzine.length || druzine.includes(v.druzina || "(brez)")) &&
        (fStanje === "VSI" || v.stanje === fStanje),
    );
  }, [vrstice, iskanje, druzine, fStanje]);

  const operacije = useMemo(() => ops?.operacije ?? [], [ops]);
  const vrednosti = useMemo(() => {
    const v: Record<string, (r: Vrstica) => string | number | null> = {
      ident: (r) => r.ident,
      naziv: (r) => r.naziv,
      druzina: (r) => r.druzina,
      p: (r) => r.normativ_proizvodnja,
      vsota: (r) => r.vsota,
      stanje: (r) => STANJE[r.stanje].label,
    };
    for (const o of operacije) v[`op${o.id}`] = (r) => r.ure?.get(o.id) ?? null;
    return v;
  }, [operacije]);
  const sort = useRazvrscanje<Vrstica, string>(vrednosti);

  if (napaka) return <ErrorText>Napaka pri nalaganju: {napaka}</ErrorText>;
  if (!normativi || !ops) return <Loading />;

  const stevilo = (s: Stanje) => vrstice.filter((v) => v.stanje === s).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex min-w-[min(100%,18rem)] flex-1 flex-col">
        <h2 className="text-xl font-bold text-ink-900">
          Operacije proizvodnje <span className="text-base font-normal text-ink-500">({vrstice.length})</span>
        </h2>
        <p className="text-sm text-ink-500">
          Šifre z normativom proizvodnje &gt; 0 in razdelitev tega normativa na operacije (stroje). Vsota operacij mora biti enaka
          normativu proizvodnje.
        </p>
      </div>

      {!ops.tabelaObstaja && (
        <WarningText>
          Tabela normativov operacij še ni v bazi - v Supabase zaženi migracijo <strong>040_normativi_operacije.sql</strong>.
        </WarningText>
      )}
      {ops.tabelaObstaja && ops.ure.size === 0 && (
        <WarningText>
          Normativi operacij še niso uvoženi. Predlog je v analizi normativov (zavihek »8 Operacije proizvodnje«) in se uvozi po
          pregledu in potrditvi.
        </WarningText>
      )}

      <FilterVrstica className="fp-card p-3">
        <FilterIskanje value={iskanje} onChange={setIskanje} placeholder="Ident, naziv ..." hint="Išči po identu in nazivu" />
        <div className="w-full sm:w-44">
          <MultiSelect label="Družina" options={["(brez)", ...vseDruzine]} value={druzine} onChange={setDruzine} hint="Filtriraj po eni ali več družinah" />
        </div>
        <FilterPreklopnik
          label="Stanje"
          value={fStanje}
          onChange={setFStanje}
          options={[
            { value: "VSI", label: "Vsi", hint: "Prikaži vse šifre z normativom proizvodnje" },
            { value: "NI", label: "Ni razdeljen", hint: STANJE.NI.hint, stevilo: stevilo("NI") },
            { value: "NEUSKLAJEN", label: "Vsota ≠ P", hint: STANJE.NEUSKLAJEN.hint, stevilo: stevilo("NEUSKLAJEN") },
            { value: "RAZDELJEN", label: "Razdeljen", hint: STANJE.RAZDELJEN.hint, stevilo: stevilo("RAZDELJEN") },
          ]}
        />
      </FilterVrstica>

      <TabelaOkvir className="rounded-xl bg-white shadow-sm">
        <table className="w-full border-collapse text-sm">
          <thead className="fp-thead">
            <tr>
              <SortTh sort={sort} kljuc="ident">Ident</SortTh>
              <SortTh sort={sort} kljuc="naziv">Naziv</SortTh>
              <SortTh sort={sort} kljuc="druzina">Družina</SortTh>
              <SortTh sort={sort} kljuc="p" desno hint="Normativ proizvodnje (h/kos) - razvrsti">
                Proizvodnja
              </SortTh>
              {operacije.map((o) => (
                <SortTh
                  key={o.id}
                  sort={sort}
                  kljuc={`op${o.id}`}
                  desno
                  hint={`${o.naziv} - delovno mesto: ${o.delovnoMesto ?? "izbere se ob planu"}. Razvrsti po stolpcu`}
                >
                  {o.naziv}
                </SortTh>
              ))}
              <SortTh sort={sort} kljuc="vsota" desno hint="Vsota ur operacij (h/kos) - razvrsti">
                Vsota operacij
              </SortTh>
              <SortTh sort={sort} kljuc="stanje">Stanje</SortTh>
            </tr>
          </thead>
          <tbody>
            {sort.razvrsti(filtrirane).map((v) => (
              <tr key={v.id} className="border-b border-ink-100 hover:bg-ink-50">
                <td className="px-2 py-1.5 font-mono text-xs text-ink-700">{v.ident}</td>
                <td className="px-2 py-1.5 text-ink-900">{v.naziv}</td>
                <td className="px-2 py-1.5 text-ink-600">{v.druzina}</td>
                <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-ink-900">{formatNum(v.normativ_proizvodnja)}</td>
                {operacije.map((o) => {
                  const u = v.ure?.get(o.id);
                  return (
                    <td key={o.id} className="px-2 py-1.5 text-right tabular-nums text-ink-700">
                      {u ? formatNum(u) : <span className="text-ink-300">-</span>}
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 text-right tabular-nums text-ink-700">{v.vsota ? formatNum(v.vsota) : ""}</td>
                <td className="px-2 py-1.5">
                  <span title={STANJE[v.stanje].hint} className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${STANJE[v.stanje].cls}`}>
                    {STANJE[v.stanje].label}
                  </span>
                </td>
              </tr>
            ))}
            {filtrirane.length === 0 && (
              <tr>
                <td colSpan={operacije.length + 6} className="px-3 py-6 text-center text-ink-500">
                  Ni šifer za izbrane filtre.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TabelaOkvir>
    </div>
  );
}
