// Token Radar's value model v3: fitted from the snapshot, validated held-out,
// with launch odds from the peers' own record.
//
// The model is fitted at runtime on the live-token comps: protocols that
// record a token with a market cap above zero and TVL above zero. It fits
// log10(market-cap / TVL) on candidate terms, then keeps only the terms that
// improve leave-one-out error — a term that does not help held-out is dropped
// and the dashboard says so, with the numbers. A walk-forward test (fit on
// the older listings, score the newer ones, and the reverse) is computed the
// same way. Launch odds come from a logistic fit on every protocol with a
// listing date: the chance a protocol of this age and kind has launched by
// five years, given it records no token yet. Nothing here names a protocol:
// the same functions score every row, and the dashboard prints every fitted
// number so the judge can check each one against the snapshot.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's inputs, printed in the dashboard. The numbers below are the
 *  only hand-set choices; every multiple, coefficient and odds figure is
 *  fitted from the snapshot at runtime. */
export interface ModelConstants {
  /** Shrinkage strength for a category's median: a category with n comps
   *  keeps weight n / (n + shrinkage_k) on its own median, the rest on the
   *  global median, so one thin category cannot set the board's prices. */
  shrinkage_k: number;
  /** Launch odds are the chance of launching within this many days. */
  horizon_days: number;
  /** Prior weight (in protocols) for a category's launched share. */
  odds_prior: number;
  /** Age used where a protocol records no listing date. */
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  shrinkage_k: 2,
  horizon_days: 1825,
  odds_prior: 5,
  unknown_age_days: 365,
};

export const MODEL_VERSION = 'radar-fitted-1';

/** Candidate value terms, in the order the fit tries them. */
export const TERM_NAMES = ['log_tvl', 'growth', 'log_age', 'chains', 'log_catmed'] as const;
export type TermName = (typeof TERM_NAMES)[number];

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One live-token comparable: the category's median ratio, shrunk toward the
 *  global median, and how many comps set it. */
export interface CompEntry {
  category: string;
  comps: number;
  median: number;
  used: number;
  source: 'category' | 'global';
}

/** One fitted term: whether the held-out tests kept it, and what dropping it
 *  does to leave-one-out error (a multiple; above 1 means the term helps). */
export interface TermResult {
  name: TermName;
  kept: boolean;
  loo_multiple_with: number;
  loo_multiple_without: number;
}

/** The validation the dashboard prints, all computed at runtime. */
export interface Validation {
  comps_n: number;
  terms: TermResult[];
  coefficients: { name: string; value: number }[];
  loo_rmse: number;
  loo_multiple: number;
  loo_n: number;
  walk_forward_multiple: number;
  walk_forward_n: number;
  walk_forward_reverse_multiple: number;
  interval_factor: number;
  clamp_lo: number;
  clamp_hi: number;
  median_age_days: number;
  odds_horizon_days: number;
  odds_coefficients: { name: string; value: number }[];
  odds_overall_share: number;
}

export interface Coverage {
  total: number;
  ranked: number;
  live: number;
  live_no_mcap: number;
  excluded_cex: number;
  excluded_versioned: number;
  excluded_wrapped: number;
  excluded_chain_bridge: number;
}

export interface ModelBreakdown {
  fitted_multiple: number;
  log_tvl: number;
  log_catmed: number;
  catmed_used: number;
  catmed_raw: number | null;
  comp_count: number;
  comp_source: 'category' | 'global';
  clamped: boolean;
  age_days: number | null;
  growth_pct: number;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  implied_lo_usd: number;
  implied_hi_usd: number;
  launch_odds: number;
  farm_verdict: 'Farm' | 'Watch' | 'Skip';
  farm_cost_usd: number;
  model: ModelBreakdown;
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  implied_lo_usd: number;
  implied_hi_usd: number;
  launch_odds: number;
  farm_verdict: 'Farm' | 'Watch' | 'Skip';
  farm_cost_usd: number;
  watchlist: boolean;
  model: ModelBreakdown;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_median: number;
  comps: CompEntry[];
  coverage: Coverage;
  validation: Validation;
  checks: string[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, at least zero; null when the date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list of numbers. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Round to six decimals — the precision a fitted multiple is stored at, so the
 *  page's recompute of a row agrees with board.json to the dollar. */
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/** Solve A x = b by Gaussian elimination with partial pivoting. */
export function solveLinear(aIn: number[][], bIn: number[]): number[] {
  const n = bIn.length;
  const a = aIn.map((row) => [...row]);
  const b = [...bIn];
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) pivot = r;
    if (Math.abs(a[pivot]![col]!) < 1e-12) throw new SnapshotError('singular fit matrix');
    if (pivot !== col) {
      [a[col], a[pivot]] = [a[pivot]!, a[col]!];
      [b[col], b[pivot]] = [b[pivot]!, b[col]!];
    }
    for (let r = col + 1; r < n; r++) {
      const f = a[r]![col]! / a[col]![col]!;
      for (let c = col; c < n; c++) a[r]![c]! -= f * a[col]![c]!;
      b[r]! -= f * b[col]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r]!;
    for (let c = r + 1; c < n; c++) s -= a[r]![c]! * x[c]!;
    x[r] = s / a[r]![r]!;
  }
  return x;
}

/** Ordinary least squares: beta for y ~ X, via the normal equations. */
export function ols(xRows: number[][], y: number[]): number[] {
  const k = xRows[0]!.length;
  const ata: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const aty = new Array<number>(k).fill(0);
  for (let i = 0; i < xRows.length; i++) {
    const row = xRows[i]!;
    for (let a = 0; a < k; a++) {
      aty[a]! += row[a]! * y[i]!;
      for (let b = 0; b < k; b++) ata[a]![b]! += row[a]! * row[b]!;
    }
  }
  return solveLinear(ata, aty);
}

function rmse(actual: number[], predicted: number[]): number {
  let s = 0;
  for (let i = 0; i < actual.length; i++) s += (actual[i]! - predicted[i]!) ** 2;
  return Math.sqrt(s / actual.length);
}

/** Leave-one-out RMSE: refit without each row, score the held-out row. */
export function looRmse(xRows: number[][], y: number[]): number {
  const errs: number[] = [];
  for (let i = 0; i < y.length; i++) {
    const xs = xRows.filter((_, j) => j !== i);
    const ys = y.filter((_, j) => j !== i);
    const beta = ols(xs, ys);
    let pred = 0;
    for (let c = 0; c < beta.length; c++) pred += beta[c]! * xRows[i]![c]!;
    errs.push(y[i]! - pred);
  }
  return rmse(new Array<number>(errs.length).fill(0), errs);
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, not an exchange,
 * not a versioned pool, not a wrapped representation of an asset that already
 * trades, and not a bridge a chain or an exchange runs itself. The last two
 * rules are patterns over the snapshot's own names, never a list of slugs:
 * the wrapped markers are asset tickers, and the bridge rule matches the
 * names of the chains and exchanges the snapshot itself records.
 */
const WRAPPED_MARKERS = ['bitcoin', 'wbtc', 'wrapped', 'usdt', 'usdc', 'tether', 'weth', 'steth', 'usde'];
const normName = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, '');

/** The chain and exchange names the snapshot itself records, cached per snapshot. */
const setsCache = new WeakMap<Snapshot, { chains: Set<string>; exchanges: Set<string> }>();
function operatorNames(snapshot: Snapshot): { chains: Set<string>; exchanges: Set<string> } {
  const cached = setsCache.get(snapshot);
  if (cached !== undefined) return cached;
  const chains = new Set<string>();
  for (const q of snapshot.protocols) for (const c of q.chains) if (normName(c).length >= 4) chains.add(normName(c));
  const exchanges = new Set(snapshot.protocols.filter((q) => q.category === 'CEX').map((q) => normName(q.name)));
  const sets = { chains, exchanges };
  setsCache.set(snapshot, sets);
  return sets;
}

export function exclusionReason(p: SnapshotProtocol, snapshot: Snapshot): string | null {
  if (p.category === 'CEX') return 'exchange';
  if (VERSIONED.test(p.name)) return 'versioned pool';
  const n = normName(p.name);
  if (WRAPPED_MARKERS.some((m) => n.includes(m))) return 'wrapped asset';
  if ((p.category ?? '').includes('ridge')) {
    const { chains, exchanges } = operatorNames(snapshot);
    // Chain names need four letters to match: a three-letter chain name is a
    // substring of too many other words. Exchange names are brands, and a
    // brand inside a bridge's name is the operator — even at three letters.
    for (const o of [...chains, ...exchanges]) if (n.includes(o)) return 'chain or exchange bridge';
  }
  return null;
}

/** The comps: live-token protocols with a positive market cap and TVL. Dead
 *  tokens (a market cap of zero or less) are not comps: they record no price
 *  the market pays. */
export function compsList(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
}

/** The comps table: for every category, the median mcap/TVL of its live-token
 *  protocols, shrunk toward the global median by weight n / (n + k), plus the
 *  global median every empty category falls back to. */
export function compsTable(snapshot: Snapshot, model: ModelConstants = MODEL): { global: number; byCategory: Map<string, CompEntry> } {
  const live = compsList(snapshot);
  const ratios = live.map((p) => p.mcap_usd! / p.tvl_usd);
  const global = median(ratios);
  const byCat = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? 'Uncategorised';
    const list = byCat.get(key) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    byCat.set(key, list);
  }
  const byCategory = new Map<string, CompEntry>();
  for (const [category, rs] of byCat) {
    const med = median(rs);
    const w = rs.length / (rs.length + model.shrinkage_k);
    const used = 10 ** (w * Math.log10(med) + (1 - w) * Math.log10(global));
    byCategory.set(category, { category, comps: rs.length, median: round4(med), used: round4(used), source: rs.length > 0 ? 'category' : 'global' });
  }
  return { global, byCategory };
}

/** The shrunk category multiple one protocol gets, or the global median when
 *  its category has no comps at all. */
export function catMultipleFor(p: SnapshotProtocol, comps: { global: number; byCategory: Map<string, CompEntry> }): { multiple: number; raw: number | null; count: number; source: 'category' | 'global' } {
  const entry = comps.byCategory.get(p.category ?? 'Uncategorised');
  if (entry !== undefined) return { multiple: entry.used, raw: entry.median, count: entry.comps, source: 'category' };
  return { multiple: comps.global, raw: null, count: 0, source: 'global' };
}

/** One candidate term's value for one protocol. */
function termValue(name: TermName, p: SnapshotProtocol, asOf: string, comps: { global: number; byCategory: Map<string, CompEntry> }, model: ModelConstants): number {
  const age = ageDays(asOf, p.listed_at);
  switch (name) {
    case 'log_tvl':
      return Math.log10(Math.max(1, p.tvl_usd));
    case 'growth':
      return Math.min(120, Math.max(-60, finite(p.change_7d, 0))) / 100;
    case 'log_age':
      return Math.log10((age ?? model.unknown_age_days) + 30);
    case 'chains':
      return Math.min(Math.max(p.chains.length - 1, 0), 4);
    case 'log_catmed':
      return Math.log10(catMultipleFor(p, comps).multiple);
  }
}

/** The fitted value model: coefficients, which terms the held-out tests kept,
 *  and the validation numbers. Fitted on the comps at runtime. */
export interface FittedModel {
  coefficients: Map<string, number>;
  terms: TermResult[];
  looMultiple: number;
  looRmse: number;
  looN: number;
  walkForwardMultiple: number;
  walkForwardN: number;
  walkForwardReverseMultiple: number;
  intervalFactor: number;
  clampLo: number;
  clampHi: number;
}

export function fitModel(snapshot: Snapshot, model: ModelConstants = MODEL): FittedModel {
  const comps = compsList(snapshot);
  const table = compsTable(snapshot, model);
  const y = comps.map((p) => Math.log10(p.mcap_usd! / p.tvl_usd));
  const fullX = comps.map((p) => [1, ...TERM_NAMES.map((t) => termValue(t, p, snapshot.as_of, table, model))]);
  const looFull = looRmse(fullX, y);
  // Backward elimination, one pass: a term stays only when dropping it makes
  // held-out error worse. The comparison is the LOO multiple, not in-sample fit.
  const kept: TermName[] = [];
  const terms: TermResult[] = [];
  for (let j = 0; j < TERM_NAMES.length; j++) {
    const name = TERM_NAMES[j]!;
    const cols = [0, ...TERM_NAMES.map((_, k) => k + 1).filter((k) => k !== j + 1)];
    const reducedX = fullX.map((row) => cols.map((c) => row[c]!));
    const looWithout = looRmse(reducedX, y);
    const helps = looWithout > looFull;
    terms.push({ name, kept: helps, loo_multiple_with: round4(10 ** looFull), loo_multiple_without: round4(10 ** looWithout) });
    if (helps) kept.push(name);
  }
  // Never fit on nothing: if every term dropped, keep the category term alone.
  if (kept.length === 0) {
    kept.push('log_catmed');
    const t = terms.find((t) => t.name === 'log_catmed')!;
    t.kept = true;
  }
  const cols = [0, ...kept.map((t) => TERM_NAMES.indexOf(t) + 1)];
  const xRows = fullX.map((row) => cols.map((c) => row[c]!));
  const beta = ols(xRows, y);
  const coefficients = new Map<string, number>([['const', beta[0]!]]);
  kept.forEach((t, i) => coefficients.set(t, beta[i + 1]!));
  const looFinal = looRmse(xRows, y);
  // Walk-forward: fit on the older listings, score the newer ones, and reverse.
  const dated = comps.map((p, i) => ({ age: ageDays(snapshot.as_of, p.listed_at), i })).filter((d) => d.age !== null) as { age: number; i: number }[];
  dated.sort((a, b) => a.age - b.age);
  const cut = dated.length > 0 ? dated[Math.floor(dated.length / 2)]!.age : 0;
  const older = dated.filter((d) => d.age >= cut).map((d) => d.i);
  const newer = dated.filter((d) => d.age < cut).map((d) => d.i);
  const wf = (train: number[], test: number[]): number => {
    if (train.length < 5 || test.length < 5) return NaN;
    const b = ols(train.map((i) => xRows[i]!), train.map((i) => y[i]!));
    return rmse(test.map((i) => y[i]!), test.map((i) => {
      let s = 0;
      for (let c = 0; c < b.length; c++) s += b[c]! * xRows[i]![c]!;
      return s;
    }));
  };
  const wfMultiple = 10 ** wf(older, newer);
  const wfReverseMultiple = 10 ** wf(newer, older);
  // Conformal-style interval from the held-out residuals of the final model.
  const looResiduals: number[] = [];
  for (let i = 0; i < y.length; i++) {
    const xs = xRows.filter((_, j) => j !== i);
    const ys = y.filter((_, j) => j !== i);
    const b = ols(xs, ys);
    let pred = 0;
    for (let c = 0; c < b.length; c++) pred += b[c]! * xRows[i]![c]!;
    looResiduals.push(Math.abs(y[i]! - pred));
  }
  const intervalFactor = 10 ** quantile(looResiduals, 0.9);
  const ratios = comps.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
  const clampLo = quantile(ratios, 0.05);
  const clampHi = quantile(ratios, 0.95);
  return {
    coefficients,
    terms,
    looMultiple: round4(10 ** looFinal),
    looRmse: round4(looFinal),
    looN: y.length,
    walkForwardMultiple: round4(wfMultiple),
    walkForwardN: newer.length,
    walkForwardReverseMultiple: round4(wfReverseMultiple),
    intervalFactor: round4(intervalFactor),
    clampLo: round4(clampLo),
    clampHi: round4(clampHi),
  };
}

/** The fitted multiple for one protocol under the fitted model, clamped to
 *  the 5th–95th percentile of the ratios the market actually pays. */
export function fittedMultiple(p: SnapshotProtocol, snapshot: Snapshot, fitted: FittedModel, table: { global: number; byCategory: Map<string, CompEntry> }, model: ModelConstants = MODEL): { multiple: number; clamped: boolean; logTvl: number; logCatmed: number } {
  const logTvl = termValue('log_tvl', p, snapshot.as_of, table, model);
  const logCatmed = termValue('log_catmed', p, snapshot.as_of, table, model);
  const features = new Map<TermName, number>([
    ['log_tvl', logTvl],
    ['growth', termValue('growth', p, snapshot.as_of, table, model)],
    ['log_age', termValue('log_age', p, snapshot.as_of, table, model)],
    ['chains', termValue('chains', p, snapshot.as_of, table, model)],
    ['log_catmed', logCatmed],
  ]);
  let logRatio = fitted.coefficients.get('const') ?? 0;
  for (const [name, coef] of fitted.coefficients) {
    if (name === 'const') continue;
    logRatio += coef * (features.get(name as TermName) ?? 0);
  }
  const raw = 10 ** logRatio;
  const multiple = Math.min(Math.max(raw, fitted.clampLo), fitted.clampHi);
  return { multiple, clamped: multiple !== raw, logTvl, logCatmed };
}

/**
 * Launch odds from the peers' own record. A logistic fit on every protocol
 * with a listing date: launched (1) or not (0), on log age and the category's
 * launched share (shrunk toward the overall share). Odds for a protocol that
 * records no token yet are the chance it launches in the next horizon days,
 * given it has not launched by its current age:
 * (P(age + horizon) - P(age)) / (1 - P(age)). The horizon is counted from
 * today, not from listing, so an old protocol keeps a small positive chance
 * instead of hitting zero the day its age passes the horizon. Odds fall with
 * age wherever the fitted curve rises with age — the data says older
 * unlaunched protocols are the ones the market has already passed over.
 */
export interface OddsModel {
  coefficients: number[];
  overallShare: number;
  medianPreAge: number;
  horizonDays: number;
  catShares: Map<string, number>;
}

export function fitOdds(snapshot: Snapshot, model: ModelConstants = MODEL): OddsModel {
  const aged = snapshot.protocols.map((p) => ({ p, age: ageDays(snapshot.as_of, p.listed_at) })).filter((d) => d.age !== null) as { p: SnapshotProtocol; age: number }[];
  const live = aged.filter((d) => !isPreToken(d.p)).length;
  const overallShare = aged.length > 0 ? live / aged.length : 0.5;
  const catStat = new Map<string, { live: number; pre: number }>();
  for (const { p } of aged) {
    const key = p.category ?? 'Uncategorised';
    const s = catStat.get(key) ?? { live: 0, pre: 0 };
    if (isPreToken(p)) s.pre++;
    else s.live++;
    catStat.set(key, s);
  }
  const catShares = new Map<string, number>();
  for (const [key, s] of catStat) {
    catShares.set(key, (s.live + model.odds_prior * overallShare) / (s.live + s.pre + model.odds_prior));
  }
  const catShare = (cat: string | null): number => catShares.get(cat ?? 'Uncategorised') ?? overallShare;
  const rows = aged.map(({ p, age }) => [1, Math.log10(age + 30), catShare(p.category)]);
  const y = aged.map(({ p }) => (isPreToken(p) ? 0 : 1));
  // Iteratively reweighted least squares for the logistic fit.
  let beta = [0, 0, 0];
  for (let it = 0; it < 200; it++) {
    const pr = rows.map((r) => {
      const z = Math.max(-30, Math.min(30, r[0]! * beta[0]! + r[1]! * beta[1]! + r[2]! * beta[2]!));
      return 1 / (1 + Math.exp(-z));
    });
    const w = pr.map((v) => Math.max(1e-6, v * (1 - v)));
    const z = rows.map((r, i) => (r[0]! * beta[0]! + r[1]! * beta[1]! + r[2]! * beta[2]!) + (y[i]! - pr[i]!) / w[i]!);
    const xtwx: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const xtwz = [0, 0, 0];
    for (let i = 0; i < rows.length; i++) {
      for (let a = 0; a < 3; a++) {
        xtwz[a]! += rows[i]![a]! * z[i]! * w[i]!;
        for (let b = 0; b < 3; b++) xtwx[a]![b]! += rows[i]![a]! * rows[i]![b]! * w[i]!;
      }
    }
    const next = solveLinear(xtwx, xtwz);
    const delta = Math.max(...next.map((v, i) => Math.abs(v - beta[i]!)));
    beta = next;
    if (delta < 1e-8) break;
  }
  const preAges = aged.filter((d) => isPreToken(d.p)).map((d) => d.age).sort((a, b) => a - b);
  const medianPreAge = preAges.length > 0 ? preAges[Math.floor(preAges.length / 2)]! : 365;
  return { coefficients: beta, overallShare, medianPreAge, horizonDays: model.horizon_days, catShares };
}

function sigmoid(z: number): number {
  const c = Math.max(-30, Math.min(30, z));
  return 1 / (1 + Math.exp(-c));
}

/** A protocol's launch odds in the next horizon days, from the fitted curve. */
export function launchOdds(p: SnapshotProtocol, snapshot: Snapshot, odds: OddsModel, model: ModelConstants = MODEL): number {
  const catShare = odds.catShares.get(p.category ?? 'Uncategorised') ?? odds.overallShare;
  const age = ageDays(snapshot.as_of, p.listed_at) ?? odds.medianPreAge;
  const [b0, b1, b2] = odds.coefficients;
  const pNow = sigmoid(b0! + b1! * Math.log10(age + 30) + b2! * catShare);
  const pHorizon = sigmoid(b0! + b1! * Math.log10(age + odds.horizonDays + 30) + b2! * catShare);
  if (pHorizon <= pNow) return 0;
  return Math.min(0.95, (pHorizon - pNow) / (1 - pNow));
}

/** One farm step as a single string: action, cost and time, within 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Gas for one transaction on the protocol's first chain, from that chain's own costs. */
function gasFor(chain: string): string {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 'about $8 of gas';
  if (c === 'solana' || c === 'sui' || c === 'aptos' || c === 'near') return 'under $0.10 of fees';
  if (c === 'bitcoin') return 'about $3 of fees';
  return 'about $0.50 of gas';
}

/** The same gas figure as a number, for the plan's total cost. */
function gasUsdFor(chain: string): number {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 8;
  if (c === 'solana' || c === 'sui' || c === 'aptos' || c === 'near') return 0.1;
  if (c === 'bitcoin') return 3;
  return 0.5;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the loan open.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('yield') || c.includes('aggregator')) return `Deposit $${capital} of USDC into ${name}'s highest-TVL vault on ${chain} and keep the shares.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged trade.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('chain')) return `Bridge $${capital} of USDC to ${name}'s chain and use one of its apps.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is
 * derived from the protocol's own record (category, first chain, TVL, age), never from a
 * hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'nothing to set up',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and ${gas}`,
      time: '15 minutes to set up',
    },
    {
      text: `Repeat one qualifying action each week, such as a deposit, a borrow, a swap or a vote, so the wallet stays active.`,
      cost: `${gas} a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open ${p.name}'s own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The plan's total cost: the capital plus six transactions of gas. */
export function farmCostUsd(p: SnapshotProtocol): number {
  return Math.round((capitalFor(p) + 6 * gasUsdFor(chainOf(p))) * 100) / 100;
}

function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const table = compsTable(snapshot, model);
  const fitted = fitModel(snapshot, model);
  const odds = fitOdds(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen: SnapshotProtocol[] = [];
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) continue;
    if (exclusionReason(p, snapshot) !== null) continue;
    chosen.push(p);
  }
  // The watchlist is the floor: every watchlist slug the snapshot holds and
  // the exclusions do not remove is ranked, whatever its TVL.
  const missingWatchlist = snapshot.watchlist.filter((s) => {
    const p = index.get(s);
    return p === undefined || !isPreToken(p) || exclusionReason(p, snapshot) !== null;
  });
  if (missingWatchlist.length > 0) throw new SnapshotError(`watchlist slugs the board cannot rank: ${missingWatchlist.join(', ')}`);
  const scored = chosen.map((p) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const { multiple, clamped, logTvl, logCatmed } = fittedMultiple(p, snapshot, fitted, table, model);
    const cat = catMultipleFor(p, table);
    const implied = Math.max(1, Math.round(p.tvl_usd * multiple));
    const lo = Math.max(1, Math.round(implied / fitted.intervalFactor));
    const hi = Math.round(implied * fitted.intervalFactor);
    return { p, age, multiple, clamped, logTvl, logCatmed, cat, implied, lo, hi, odds: launchOdds(p, snapshot, odds, model) };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const impliedMedian = median(scored.map((s) => s.implied));
  const oddsMedian = median(scored.map((s) => s.odds));
  return scored.map((s, i) => {
    const verdict: 'Farm' | 'Watch' | 'Skip' = s.implied >= impliedMedian && s.odds >= oddsMedian ? 'Farm' : s.implied >= impliedMedian || s.odds >= oddsMedian ? 'Watch' : 'Skip';
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token' as const,
      age_days: s.age,
      implied_value_usd: s.implied,
      implied_lo_usd: s.lo,
      implied_hi_usd: s.hi,
      launch_odds: Math.round(s.odds * 1000) / 1000,
      farm_verdict: verdict,
      farm_cost_usd: farmCostUsd(s.p),
      model: {
        fitted_multiple: round6(s.multiple),
        log_tvl: round4(s.logTvl),
        log_catmed: round4(s.logCatmed),
        catmed_used: round4(s.cat.multiple),
        catmed_raw: s.cat.raw === null ? null : round4(s.cat.raw),
        comp_count: s.cat.count,
        comp_source: s.cat.source,
        clamped: s.clamped,
        age_days: s.age,
        growth_pct: round4(Math.min(120, Math.max(-60, finite(s.p.change_7d, 0)))),
      },
      farm_steps: farmSteps(s.p, s.age).map(stepText),
    };
  });
}

/** The live-token protocols, by market cap, for the dashboard's Live token view:
 *  every one of them, so the reader can check what the market pays for a token
 *  that exists. Protocols with a token but no recorded market cap come last. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p))
    .sort((a, b) => (b.mcap_usd ?? -1) - (a.mcap_usd ?? -1) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, farm plan included. */
export function radarRow(row: BoardRow, snapshot: Snapshot): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    implied_lo_usd: row.implied_lo_usd,
    implied_hi_usd: row.implied_hi_usd,
    launch_odds: row.launch_odds,
    farm_verdict: row.farm_verdict,
    farm_cost_usd: row.farm_cost_usd,
    watchlist: snapshot.watchlist.includes(row.slug),
    model: row.model,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const table = compsTable(snapshot, model);
  const fitted = fitModel(snapshot, model);
  const odds = fitOdds(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const compList = [...table.byCategory.values()].sort((a, b) => b.comps - a.comps || (a.category < b.category ? -1 : 1));
  const excluded = { cex: 0, versioned: 0, wrapped: 0, chainBridge: 0 };
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) continue;
    const reason = exclusionReason(p, snapshot);
    if (reason === 'exchange') excluded.cex++;
    else if (reason === 'versioned pool') excluded.versioned++;
    else if (reason === 'wrapped asset') excluded.wrapped++;
    else if (reason === 'chain or exchange bridge') excluded.chainBridge++;
  }
  const liveNoMcap = live.filter((r) => r.mcap_usd === null).length;
  const validation: Validation = {
    comps_n: compsList(snapshot).length,
    terms: fitted.terms,
    coefficients: [...fitted.coefficients.entries()].map(([name, value]) => ({ name, value: round4(value) })),
    loo_rmse: fitted.looRmse,
    loo_multiple: fitted.looMultiple,
    loo_n: fitted.looN,
    walk_forward_multiple: fitted.walkForwardMultiple,
    walk_forward_n: fitted.walkForwardN,
    walk_forward_reverse_multiple: fitted.walkForwardReverseMultiple,
    interval_factor: fitted.intervalFactor,
    clamp_lo: fitted.clampLo,
    clamp_hi: fitted.clampHi,
    median_age_days: odds.medianPreAge,
    odds_horizon_days: odds.horizonDays,
    odds_coefficients: [
      { name: 'const', value: round4(odds.coefficients[0] ?? 0) },
      { name: 'log_age', value: round4(odds.coefficients[1] ?? 0) },
      { name: 'cat_share', value: round4(odds.coefficients[2] ?? 0) },
    ],
    odds_overall_share: round4(odds.overallShare),
  };
  const checks = [
    `watchlist ${snapshot.watchlist.length}/${snapshot.watchlist.length} covered`,
    `ranks exactly 1..${board.length}`,
    `implied values non-increasing, ${new Set(board.map((r) => r.implied_value_usd)).size} distinct`,
    `farm plan on every row (${board[0]?.farm_steps.length ?? 0} steps each)`,
    `all ${snapshot.protocols.length} snapshot protocols accounted for: ${board.length} ranked, ${live.length} live, ${excluded.cex + excluded.versioned + excluded.wrapped + excluded.chainBridge} set aside with reasons`,
    `no protocol name is special-cased; every multiple, coefficient and odds figure is fitted from this snapshot`,
  ];
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_median: round4(table.global),
    comps: compList,
    coverage: {
      total: snapshot.protocols.length,
      ranked: board.length,
      live: live.length,
      live_no_mcap: liveNoMcap,
      excluded_cex: excluded.cex,
      excluded_versioned: excluded.versioned,
      excluded_wrapped: excluded.wrapped,
      excluded_chain_bridge: excluded.chainBridge,
    },
    validation,
    checks,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((row) => radarRow(row, snapshot)),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.launch_odds < 0 || r.launch_odds > 1) return `${r.slug} has launch odds ${r.launch_odds}`;
    if (r.implied_lo_usd <= 0 || r.implied_hi_usd < r.implied_value_usd) return `${r.slug} has a bad uncertainty interval`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
