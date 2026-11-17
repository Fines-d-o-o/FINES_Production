import type { Metadata } from "next";
import { PripravljenostMateriala } from "@/components/planiranje/PripravljenostMateriala";

export const metadata: Metadata = { title: "Pripravljenost materiala | Fines - Production" };

export default function Page() {
  return <PripravljenostMateriala />;
}
