import type { ReactNode } from "react";

/**
 * Oštevilčen podrazdelek daljšega obrazca / poročila (standard: oranžen krogec s številko,
 * naslov text-sm font-bold, tanka siva črta do desnega roba). `desno` = npr. značka stanja.
 * `poudarjen` = podrazdelek, ki ga je treba izpolniti zdaj (svetlo oranžno ozadje).
 */
export function Podrazdelek({
  st,
  naslov,
  desno,
  poudarjen,
  children,
  className = "",
}: {
  st: number;
  naslov: string;
  desno?: ReactNode;
  poudarjen?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex min-w-0 flex-col gap-3 ${poudarjen ? "rounded-xl bg-fines-50 p-3" : ""} ${className}`}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-fines-500 text-xs font-bold text-white">{st}</span>
        <h3 className="shrink-0 text-sm font-bold text-ink-800">{naslov}</h3>
        <span className="h-px min-w-4 flex-1 bg-ink-200" />
        {desno}
      </div>
      {children}
    </section>
  );
}
