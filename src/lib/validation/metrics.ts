/** One validation clip: hand-measured truth next to what the analysis produced. Angles: degrees, toe-out positive. */
export interface ClipOutcome {
  video: string;
  trueL: number;
  trueR: number;
  /** null when the analysis could not produce a reading */
  predL: number | null;
  predR: number | null;
  stepsL: number;
  stepsR: number;
  quality: string;
  /** set when the analysis failed */
  failure?: string;
  warnings: string[];
}

export interface Metrics {
  nClips: number;
  nAnalysed: number;
  nFailed: number;
  /** number of individual foot readings (2 per analysed clip) */
  nValues: number;
  /** mean absolute error over all readings, degrees */
  mae: number;
  maeLeft: number;
  maeRight: number;
  /** mean signed error (prediction - truth) */
  bias: number;
  biasLeft: number;
  biasRight: number;
  rmse: number;
  maxAbs: number;
  /** share of readings within 5 degrees of the hand measurement */
  within5: number;
  /** MAE of the no-skill guess "everyone's feet point at the average angle" */
  baselineMae: number;
  /** MAE after removing each foot's mean bias. In-sample, so optimistic. */
  maeAfterBias: number;
  /** Pearson correlation of prediction vs truth over all readings */
  correlation: number;
  /** least-squares slope of prediction on truth (1 = perfect scale, <1 = compressed toward the mean) */
  slope: number;
  /** mean |(predL - predR) - (trueL - trueR)|: how well the left/right difference is read */
  asymmetryMae: number;
}

const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);

function pearson(x: number[], y: number[]): number {
  if (x.length < 3) return NaN;
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
}

function slopeOf(x: number[], y: number[]): number {
  if (x.length < 3) return NaN;
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
  }
  return sxx > 0 ? sxy / sxx : NaN;
}

export function computeMetrics(outcomes: ClipOutcome[]): Metrics {
  const ok = outcomes.filter((o) => o.predL !== null && o.predR !== null);
  const eL = ok.map((o) => (o.predL as number) - o.trueL);
  const eR = ok.map((o) => (o.predR as number) - o.trueR);
  const all = [...eL, ...eR];
  const abs = (a: number[]) => a.map(Math.abs);

  const truth = ok.flatMap((o) => [o.trueL, o.trueR]);
  const pred = ok.flatMap((o) => [o.predL as number, o.predR as number]);
  const meanTruth = mean(truth);
  const biasL = mean(eL);
  const biasR = mean(eR);

  return {
    nClips: outcomes.length,
    nAnalysed: ok.length,
    nFailed: outcomes.length - ok.length,
    nValues: all.length,
    mae: mean(abs(all)),
    maeLeft: mean(abs(eL)),
    maeRight: mean(abs(eR)),
    bias: mean(all),
    biasLeft: biasL,
    biasRight: biasR,
    rmse: all.length ? Math.sqrt(mean(all.map((e) => e * e))) : NaN,
    maxAbs: all.length ? Math.max(...abs(all)) : NaN,
    within5: all.length ? all.filter((e) => Math.abs(e) <= 5).length / all.length : NaN,
    baselineMae: mean(truth.map((t) => Math.abs(t - meanTruth))),
    maeAfterBias: mean([...eL.map((e) => Math.abs(e - biasL)), ...eR.map((e) => Math.abs(e - biasR))]),
    correlation: pearson(truth, pred),
    slope: slopeOf(truth, pred),
    asymmetryMae: mean(ok.map((o) => Math.abs((o.predL as number) - (o.predR as number) - (o.trueL - o.trueR)))),
  };
}
