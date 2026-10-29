import type { Metadata } from "next";
import { DebugTabs } from "@/components/debug/DebugTabs";

export const metadata: Metadata = {
  title: "Walk Score – debug",
  description: "Landmark, foot and stance overlay for checking the foot-angle analysis.",
  robots: { index: false },
};

export default function DebugPage() {
  return <DebugTabs />;
}
