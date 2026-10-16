/**
 * Market demand, derived from what the platform already knows.
 *
 * `doc/02` §5.2 asks a training provider for a live feed of which skills are
 * undersupplied. There is no external labour-market feed on this project, and
 * wiring one up would mean sending aggregate demand to a third party — the same
 * move `doc/08` §3 declines for media and phone numbers. So the dashboard is built
 * from rows the platform already holds, and this file is the whole of the claim:
 *
 * * **Demand** is employer capability specs that are currently running. An
 *   employer writing a spec for a skill is the clearest signal the platform has
 *   that somebody is trying to hire it, and it is a deliberate act rather than an
 *   inferred one.
 * * **Supply** is worker capability blocks. A block is a claim a worker made about
 *   their own skill, and it is counted whatever its proofs went on to become,
 *   because the point of the question is how many people *offer* the skill.
 *
 * Two things this deliberately does not do.
 *
 * It does not use `work_proof_logs` or `verifications`, so nothing here inherits the
 * fraud engine's judgement. A supply figure is not a trust figure, and a skill
 * somebody claims but cannot evidence is still a skill they are offering.
 *
 * It does not use `micro_credentials` either, for the same reason the credential
 * never reaches an employer's search: a credential is institutional evidence, not
 * demand, and counting it as supply would let a bootcamp's own graduates inflate
 * the very shortage figure it uses to justify its curriculum.
 *
 * The whole computation is a pure function over three flat lists so it can be
 * tested without a database. The queries that produce those lists live in
 * `service.ts`, and the numbers below are the only judgement applied to them.
 */
import type { DemandSkillRow } from '@tetherproof/shared';

/** Active specs for one skill. */
export interface SearchCountRow {
  skillTag: string;
  count: number;
}

/** Workers holding a capability block for one skill. */
export interface SupplyCountRow {
  skillTag: string;
  count: number;
}

export interface DemandInputs {
  searches: SearchCountRow[];
  supply: SupplyCountRow[];
}

export interface DemandTotals {
  activeSearches: number;
  availableWorkers: number;
}

/**
 * The key a skill is grouped under.
 *
 * Lower-cased and whitespace-collapsed, so "Solar Panel" and "solar  panel" are
 * one row rather than two halves of a false gap. This is the same reason
 * `skillSearchTerms` matches case-insensitively: a worker who records "Welding" and
 * an employer who searches "welding" are describing the same skill, and a
 * case-sensitive join would report the network as empty.
 *
 * Only the *grouping* key is normalised. The tag shown to the reader is whichever
 * spelling the employers used most recently, so the dashboard does not display a
 * lower-cased version of a skill nobody typed that way.
 */
function groupingKey(skillTag: string): string {
  return skillTag.trim().toLowerCase().replace(/\s+/g, ' ');
}

interface Bucket {
  displayTag: string;
  searches: number;
  supply: number;
}

/**
 * Merges both lists into one row per skill and ranks them.
 *
 * A skill appears when either side mentions it, so a skill nobody is hiring for but
 * several people offer still shows — with a gap of zero, because that is what its
 * gap is. Dropping it would make an oversupplied skill invisible, which is the one
 * finding an institute most needs and the one a demand-only list can never produce.
 *
 * Ordering is by gap, then by demand, then alphabetically, so the ranking is stable
 * between reads. A dashboard whose order jitters on every refresh is one nobody
 * trusts enough to act on.
 */
export function buildDemandRows(inputs: DemandInputs, limit: number): DemandSkillRow[] {
  const buckets = new Map<string, Bucket>();

  function bucket(key: string, tag: string): Bucket {
    let existing = buckets.get(key);
    if (!existing) {
      existing = { displayTag: tag.trim(), searches: 0, supply: 0 };
      buckets.set(key, existing);
    }
    return existing;
  }

  for (const row of inputs.searches) {
    const key = groupingKey(row.skillTag);
    if (!key) continue;
    bucket(key, row.skillTag).searches += row.count;
  }

  for (const row of inputs.supply) {
    const key = groupingKey(row.skillTag);
    if (!key) continue;
    bucket(key, row.skillTag).supply += row.count;
  }

  const rows: DemandSkillRow[] = [...buckets.values()].map((entry) => {
    const demandPerWorker =
      entry.supply === 0 ? entry.searches : Math.round((entry.searches / entry.supply) * 100) / 100;

    return {
      skillTag: entry.displayTag,
      activeSearches: entry.searches,
      availableWorkers: entry.supply,
      demandPerWorker,
      // Floored at zero. A skill with more people offering it than searching for it
      // is oversupplied, and a negative gap would read as a shortage if it ever
      // leaked into a colour scale or a sort.
      gapScore: Math.max(0, entry.searches - entry.supply),
    };
  });

  rows.sort(
    (a, b) => b.gapScore - a.gapScore || b.activeSearches - a.activeSearches || a.skillTag.localeCompare(b.skillTag),
  );

  return rows.slice(0, Math.max(1, limit));
}

/**
 * Network totals alongside the rows.
 *
 * Counted from the same input lists rather than from a separate query, so the
 * headline figure and the rows beneath it can never disagree — the failure mode of
 * a dashboard whose tiles and table are separate requests.
 */
export function demandTotals(inputs: DemandInputs): DemandTotals {
  const sum = (rows: SearchCountRow[] | SupplyCountRow[]): number =>
    rows.reduce((total, row) => total + row.count, 0);

  return {
    activeSearches: sum(inputs.searches),
    availableWorkers: sum(inputs.supply),
  };
}
