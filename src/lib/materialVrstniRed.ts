// Ročni vrstni red nalogov znotraj krovnega - velja IZKLJUČNO za razdelitev materiala (Pripravljenost materiala).
// Odpreme in delovni plan ostanejo nespremenjeni. Shranjen vrstni red je uradni za vse, dokler ga nekdo ne resetira.
// Tabela fp_mat_vrstni_red (migracija 039); podatkov se ne briše - stari zapisi dobijo visible = false.
import { fetchAll, getSupabase } from "./supabase";

/** Ročni vrstni red krovnega: nalogi od prvega (prvi dobi material) naprej, kdo in kdaj ga je shranil. */
export type RocniVrstniRed = { nalogi: string[]; spremenil: string | null; cas: string };

const TABELA = "fp_mat_vrstni_red";

/** Napaka, ko tabela še ni ustvarjena (migracija 039) - takrat velja privzeti vrstni red. */
export const niTabeleVrstnegaReda = (m: string) => /fp_mat_vrstni_red|does not exist|schema cache/i.test(m);

type Zapis = { krovni: string; st_naloga: string; vrstni_red: number; spremenil: string | null; created_at: string };

/** Krovni -> ročni vrstni red (samo krovni, kjer je vrstni red spremenjen). */
export async function naloziVrstniRed(): Promise<Map<string, RocniVrstniRed>> {
  const sb = getSupabase();
  const zapisi = await fetchAll<Zapis>((from, to) =>
    sb
      .from(TABELA)
      .select("krovni, st_naloga, vrstni_red, spremenil, created_at")
      .eq("visible", true)
      .order("krovni")
      .order("vrstni_red")
      .range(from, to),
  );
  const r = new Map<string, RocniVrstniRed>();
  for (const z of zapisi) {
    const o = r.get(z.krovni);
    if (o) {
      o.nalogi.push(z.st_naloga);
      if (z.created_at > o.cas) o.cas = z.created_at;
    } else r.set(z.krovni, { nalogi: [z.st_naloga], spremenil: z.spremenil, cas: z.created_at });
  }
  return r;
}

/** Skrije veljaven vrstni red krovnega (reset = privzeti vrstni red po odpremah). */
export async function resetirajVrstniRed(krovni: string) {
  const { error } = await getSupabase().from(TABELA).update({ visible: false }).eq("krovni", krovni).eq("visible", true);
  if (error) throw error;
}

/** Shrani nov vrstni red krovnega (nadomesti prejšnjega). */
export async function shraniVrstniRed(krovni: string, nalogi: string[]) {
  const sb = getSupabase();
  const { data } = await sb.auth.getSession();
  await resetirajVrstniRed(krovni);
  const { error } = await sb.from(TABELA).insert(
    nalogi.map((st, i) => ({ krovni, st_naloga: st, vrstni_red: i + 1, spremenil: data.session?.user.email ?? null })),
  );
  if (error) throw error;
}
