import type { Metadata } from "next";
import { ValidateClient } from "@/components/validate/ValidateClient";

export const metadata: Metadata = {
  title: "Walk Score – validation",
  description: "Compare the estimated foot angles with hand measurements.",
  robots: { index: false },
};

export default function ValidatePage() {
  return <ValidateClient />;
}
