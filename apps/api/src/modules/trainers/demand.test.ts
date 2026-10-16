/**
 * Market demand aggregation.
 *
 * The one piece of the training provider module that is a pure function over
 * already-fetched rows, which makes it the one piece worth testing without a
 * database. Everything else here is a query or a gate, and the live suite covers
 * those against the real database — which is the only place they mean anything.
 */
import { describe, expect, it } from 'vitest';
import { buildDemandRows, demandTotals } from './demand.js';

describe('buildDemandRows', () => {
  /**
   * Rows are read by index in these tests rather than through a non-null assertion.
   *
   * Every case below asserts the length first, so an unexpected shape fails on the
   * assertion that describes it rather than on a null dereference that says nothing
   * about what went wrong. `toMatchObject` on a possibly-undefined element would
   * otherwise throw before it could compare anything.
   */
  it('reports a gap only where demand exceeds supply', () => {
    const rows = buildDemandRows(
      {
        searches: [{ skillTag: 'Welding', count: 5 }],
        supply: [{ skillTag: 'Welding', count: 2 }],
      },
      10,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      skillTag: 'Welding',
      activeSearches: 5,
      availableWorkers: 2,
      gapScore: 3,
    });
  });

  /**
   * A skill with more people offering it than hiring for it is oversupplied, and a
   * negative gap would read as a shortage the moment it touched a colour scale or a
   * sort. This is the assertion that would have caught that.
   */
  it('floors the gap at zero so an oversupplied skill never reads as a shortage', () => {
    const rows = buildDemandRows(
      {
        searches: [{ skillTag: 'Welding', count: 1 }],
        supply: [{ skillTag: 'Welding', count: 9 }],
      },
      10,
    );

    expect(rows[0]?.gapScore).toBe(0);
  });

  /**
   * "Welding" and "welding" are one skill, and a case-sensitive join would report the
   * network as empty — the same reason `skillSearchTerms` matches case-insensitively.
   */
  it('groups the same skill however it was capitalised', () => {
    const rows = buildDemandRows(
      {
        searches: [
          { skillTag: 'Welding', count: 3 },
          { skillTag: 'welding', count: 2 },
        ],
        supply: [{ skillTag: 'WELDING', count: 4 }],
      },
      10,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.activeSearches).toBe(5);
    expect(rows[0]?.availableWorkers).toBe(4);
  });

  it('collapses runs of whitespace so a re-typed skill is not half a gap', () => {
    const rows = buildDemandRows(
      {
        searches: [{ skillTag: 'Solar  Panel', count: 2 }],
        supply: [{ skillTag: ' solar panel ', count: 1 }],
      },
      10,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.gapScore).toBe(1);
  });

  /**
   * An oversupplied skill is the finding an institute most needs and the one a
   * demand-only list can never produce, so a skill nobody is hiring for still has to
   * appear — with a gap of zero, because that is what its gap is.
   */
  it('keeps a skill nobody is searching for, at a gap of zero', () => {
    const rows = buildDemandRows({ searches: [], supply: [{ skillTag: 'Welding', count: 6 }] }, 10);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ skillTag: 'Welding', activeSearches: 0, gapScore: 0 });
  });

  it('divides demand by supply, and does not divide by zero', () => {
    const rows = buildDemandRows(
      {
        searches: [
          { skillTag: 'Welding', count: 4 },
          { skillTag: 'Soldering', count: 3 },
        ],
        supply: [{ skillTag: 'Welding', count: 2 }],
      },
      10,
    );

    const welding = rows.find((row) => row.skillTag === 'Welding');
    const soldering = rows.find((row) => row.skillTag === 'Soldering');

    expect(welding?.demandPerWorker).toBe(2);
    // Nobody offers this one, so the ratio is the raw demand rather than a
    // division by zero turned into Infinity or NaN.
    expect(soldering?.demandPerWorker).toBe(3);
    expect(Number.isFinite(soldering?.demandPerWorker)).toBe(true);
  });

  /**
   * A dashboard whose order jitters between refreshes is one nobody trusts enough to
   * teach a curriculum from, so ties break on demand and then alphabetically.
   */
  it('orders by gap, then demand, then name', () => {
    const rows = buildDemandRows(
      {
        searches: [
          { skillTag: 'Zebra', count: 5 },
          { skillTag: 'Alpha', count: 5 },
          { skillTag: 'Big', count: 9 },
        ],
        supply: [],
      },
      10,
    );

    expect(rows.map((row) => row.skillTag)).toEqual(['Big', 'Alpha', 'Zebra']);
  });

  it('honours the limit, and never returns nothing for a positive one', () => {
    const input = {
      searches: [
        { skillTag: 'A', count: 1 },
        { skillTag: 'B', count: 1 },
        { skillTag: 'C', count: 1 },
      ],
      supply: [],
    };

    expect(buildDemandRows(input, 2)).toHaveLength(2);
    // A zero or negative limit clamps to one rather than to none: an empty
    // dashboard reads as "no demand on the network", which is a claim, while one
    // row reads as "here is the top of it". The request schema already refuses a
    // limit below 1, so this only guards a direct caller. It clamps rather than
    // ignoring the limit, so a caller asking for nothing still cannot pull the
    // whole table.
    expect(buildDemandRows(input, 0)).toHaveLength(1);
    expect(buildDemandRows(input, -5)).toHaveLength(1);
  });

  it('ignores rows whose skill is only whitespace', () => {
    const rows = buildDemandRows(
      { searches: [{ skillTag: '   ', count: 9 }], supply: [{ skillTag: '', count: 3 }] },
      10,
    );

    expect(rows).toHaveLength(0);
  });

  it('returns nothing at all for an empty network', () => {
    expect(buildDemandRows({ searches: [], supply: [] }, 10)).toEqual([]);
  });
});

describe('demandTotals', () => {
  /**
   * The tiles and the rows come from one set of inputs, so a headline figure can
   * never disagree with the table beneath it — the failure mode of a dashboard
   * assembled from separate requests.
   */
  it('sums the same rows the table is built from', () => {
    const inputs = {
      searches: [
        { skillTag: 'Welding', count: 3 },
        { skillTag: 'Soldering', count: 2 },
      ],
      supply: [
        { skillTag: 'Welding', count: 4 },
        { skillTag: 'Soldering', count: 1 },
      ],
    };

    expect(demandTotals(inputs)).toEqual({ activeSearches: 5, availableWorkers: 5 });
  });

  it('is zero on an empty network rather than undefined', () => {
    expect(demandTotals({ searches: [], supply: [] })).toEqual({
      activeSearches: 0,
      availableWorkers: 0,
    });
  });
});
