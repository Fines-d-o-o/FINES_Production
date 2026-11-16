import { Check, Clock, Minus, RefreshCw, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/** Stanje opravila v ozadju (npr. objava na FIN:TV): od najhujšega navzdol. */
export type StanjeIkone = "napaka" | "v_teku" | "caka" | "opozorilo" | "ok" | "neznano";

const IKONE: Record<StanjeIkone, { cls: string; icon: LucideIcon | null; vrti?: boolean }> = {
  ok: { cls: "bg-ok-500", icon: Check },
  v_teku: { cls: "bg-sync-500", icon: RefreshCw, vrti: true },
  caka: { cls: "bg-sync-500", icon: Clock },
  opozorilo: { cls: "bg-warn-500", icon: null },
  napaka: { cls: "bg-nok-500", icon: X },
  neznano: { cls: "bg-ink-300", icon: Minus },
};

/**
 * Ikona stanja 18 px (krogec z belim robom in belo ikono): zelena kljukica = uspešno, modra vrteča puščica = v teku,
 * modra ura = čaka v vrsti, rumen klicaj = opozorilo, rdeč križec = napaka, siva črtica = izklopljeno / ni znano.
 * Pojasnilo stanja je v hover tekstu (`hint`). Na gumbu / kartici je v desnem zgornjem kotu (`absolute -right-1 -top-1`).
 */
export function StanjeIkona({ stanje, hint, className = "" }: { stanje: StanjeIkone; hint?: string; className?: string }) {
  const { cls, icon: Icon, vrti } = IKONE[stanje];
  return (
    <span
      title={hint}
      role={hint ? "img" : undefined}
      aria-label={hint}
      aria-hidden={hint ? undefined : true}
      className={`inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 border-white text-white shadow-sm ${cls} ${className}`}
    >
      {Icon ? (
        <Icon className={`h-2.5 w-2.5 ${vrti ? "animate-spin" : ""}`} strokeWidth={3.5} aria-hidden />
      ) : (
        <span className="text-[11px] font-black leading-none" aria-hidden>
          !
        </span>
      )}
    </span>
  );
}
