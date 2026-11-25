import { fetchAll, getSupabase } from "./supabase";

// =====================================================================
// Normativi operacij proizvodnje (migracija 040)
// Proizvodnja razdeli normativ proizvodnje šifre na operacije / delovna mesta.
// =====================================================================

export type Operacija = {
  id: number;
  koda: string;
  naziv: string;
  delovnoMesto: string | null; // null = izbere se ob planu
  opomba: string | null;
};

/** Ure na kos po operaciji za en normativ (ključ = id operacije). */
export type UreOperacij = Map<number, number>;

export type OperacijeNormativov = {
  /** false = migracija 040 še ni zagnana (tabeli ne obstajata). */
  tabelaObstaja: boolean;
  operacije: Operacija[];
  /** normativ_id -> ure po operacijah */
  ure: Map<number, UreOperacij>;
};

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Vsota ur operacij (3 decimalke). */
export function vsotaOperacij(u: UreOperacij | undefined) {
  if (!u) return 0;
  let s = 0;
  for (const v of u.values()) s += v;
  return r3(s);
}

// PostgREST: tabela ne obstaja (42P01) ali je ni v predpomnilniku sheme (PGRST205)
const niTabele = (e: { code?: string } | null) => !!e && (e.code === "42P01" || e.code === "PGRST205");

export async function naloziOperacijeNormativov(): Promise<OperacijeNormativov> {
  const sb = getSupabase();
  const op = await sb
    .from("fp_operacije")
    .select("id, koda, naziv, opomba, vrstni_red, delovno_mesto:fp_delovna_mesta(naziv)")
    .eq("visible", true)
    .order("vrstni_red");
  if (niTabele(op.error)) return { tabelaObstaja: false, operacije: [], ure: new Map() };
  if (op.error) throw op.error;

  type OpRow = { id: number; koda: string; naziv: string; opomba: string | null; delovno_mesto: { naziv: string } | null };
  const operacije: Operacija[] = (op.data as unknown as OpRow[]).map((o) => ({
    id: o.id,
    koda: o.koda,
    naziv: o.naziv,
    opomba: o.opomba,
    delovnoMesto: o.delovno_mesto?.naziv ?? null,
  }));

  type UraRow = { normativ_id: number; operacija_id: number; ure: number | string };
  const rows = await fetchAll<UraRow>((from, to) =>
    sb
      .from("fp_normativi_operacije")
      .select("normativ_id, operacija_id, ure")
      .eq("visible", true)
      .order("id")
      .range(from, to),
  );
  const ure = new Map<number, UreOperacij>();
  for (const r of rows) {
    const m = ure.get(r.normativ_id) ?? new Map<number, number>();
    m.set(r.operacija_id, Number(r.ure));
    ure.set(r.normativ_id, m);
  }
  return { tabelaObstaja: true, operacije, ure };
}
