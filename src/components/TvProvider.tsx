"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { VSE_KODE_TV, type StanjeTvKomponente } from "@/lib/tvStanje";
import { useTvVrsta, type OpraviloTv } from "@/lib/tvVrsta";
import { useToast } from "./ui/Toast";

/** Stanje komponent FIN:TV se ponovno prebere vsakih 5 min (veljavnost strani se menja z dnevom). */
const PREVERI_MS = 5 * 60 * 1000;

type TvApi = {
  /** Stanje komponent v FinOS po kodi; null = še ni prebrano. */
  komponente: Map<string, StanjeTvKomponente> | null;
  /** FinOS ni dosegljiv (ni dostopa / ni tabel). */
  napaka: string | null;
  /** Kdaj je bilo stanje nazadnje prebrano (ms). */
  preverjeno: number | null;
  /** Opravila vrste objav te seje. */
  opravila: OpraviloTv[];
  osvezi: () => void;
};

const Kontekst = createContext<TvApi | null>(null);

/**
 * Stanje FIN:TV za glavo (TvGlava), stran Sync v TV in kvadratke TvPovezava. Bere se šele, ko ga kdo potrebuje
 * (useStanjeTv), ob koncu vsake objave pa obvestilo (uspeh / napaka) in ponovno branje.
 */
export function TvProvider({ children }: { children: ReactNode }) {
  const notify = useToast();
  const opravila = useTvVrsta();
  const [potrebno, setPotrebno] = useState(0);
  const [komponente, setKomponente] = useState<Map<string, StanjeTvKomponente> | null>(null);
  const [napaka, setNapaka] = useState<string | null>(null);
  const [preverjeno, setPreverjeno] = useState<number | null>(null);
  const branje = useRef(0);

  const osvezi = useCallback(() => {
    const st = ++branje.current;
    import("@/lib/tvStanje")
      .then(({ stanjeTvKomponent }) => stanjeTvKomponent(VSE_KODE_TV))
      .then((s) => {
        if (st !== branje.current) return;
        setKomponente(new Map(s.map((x) => [x.koda, x])));
        setNapaka(null);
        setPreverjeno(Date.now());
      })
      .catch((e) => st === branje.current && setNapaka((e as Error).message));
  }, []);

  const aktivno = potrebno > 0;
  useEffect(() => {
    if (!aktivno) return;
    osvezi();
    const t = setInterval(() => document.visibilityState === "visible" && osvezi(), PREVERI_MS);
    return () => clearInterval(t);
  }, [aktivno, osvezi]);

  // Konec objave: obvestilo in ponovno branje stanja (zadnja objava, strani danes)
  const prej = useRef(new Map<string, OpraviloTv["stanje"]>());
  useEffect(() => {
    let konec = false;
    for (const o of opravila) {
      // React lahko združi hitre spremembe (čaka -> teče -> ok), zato šteje vsak prehod iz čaka / teče
      const bilo = prej.current.get(o.id);
      const delalo = bilo === "tece" || bilo === "caka";
      if (delalo && o.stanje === "ok") {
        notify("success", `FIN:TV · ${o.naslov}: ${o.sporocilo}`);
        konec = true;
      } else if (delalo && o.stanje === "napaka") {
        notify("error", `FIN:TV · ${o.naslov}: objava ni uspela - ${o.sporocilo}`, 10000);
        konec = true;
      } else if (bilo === "tece" && o.stanje === "caka") konec = true;
      prej.current.set(o.id, o.stanje);
    }
    if (konec && aktivno) osvezi();
  }, [opravila, notify, osvezi, aktivno]);

  const registriraj = useCallback(() => {
    setPotrebno((n) => n + 1);
    return () => setPotrebno((n) => n - 1);
  }, []);

  return (
    <Kontekst.Provider value={{ komponente, napaka, preverjeno, opravila, osvezi }}>
      <Registracija.Provider value={registriraj}>{children}</Registracija.Provider>
    </Kontekst.Provider>
  );
}

const Registracija = createContext<(() => () => void) | null>(null);

/** Stanje FIN:TV (komponente iz FinOS + vrsta objav); komponenta, ki ga uporabi, sproži branje. */
export function useStanjeTv(): TvApi {
  const api = useContext(Kontekst);
  const registriraj = useContext(Registracija);
  if (!api || !registriraj) throw new Error("useStanjeTv mora biti znotraj TvProvider");
  useEffect(registriraj, [registriraj]);
  return api;
}
