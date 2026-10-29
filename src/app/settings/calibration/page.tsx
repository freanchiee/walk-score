import type { Metadata } from "next";
import { CalibrationClient } from "@/components/calibration/CalibrationClient";

export const metadata: Metadata = {
  title: "Walk Score – calibration",
  description: "Mark the heel centre and toe gap on a few frames to calibrate the foot angles the app reads.",
  robots: { index: false },
};

export default function CalibrationPage() {
  return <CalibrationClient />;
}
