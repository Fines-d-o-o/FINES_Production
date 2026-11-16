import type { Metadata } from "next";
import { SyncTv } from "@/components/podatki/SyncTv";

export const metadata: Metadata = { title: "Sync v TV | Fines - Production" };

export default function Page() {
  return <SyncTv />;
}
