import { describe, expect, it } from 'vitest';
import { skillSearchTerms } from './matching.js';

/**
 * The search term splitter, tested directly.
 *
 * This is the function that decides what an employer's words have to match
 * against a worker's recorded skill. It has three failure modes worth pinning
 * down, and none of them are visible from an API test: a query that matches
 * everything, a query that matches nothing when it should match something, and a
 * query that stops matching because of a stray capital letter.
 *
 * The database layer above this function is covered by the live suite; what is
 * checked here is the decision itself, with no database in the way.
 */
describe('skillSearchTerms', () => {
  it('keeps every meaningful word from a multi-word skill', () => {
    expect(skillSearchTerms('Solar Panel Installation')).toEqual([
      'solar',
      'panel',
      'installation',
    ]);
  });

  it('lowercases, so capitalisation cannot decide a match', () => {
    expect(skillSearchTerms('SOLAR PANEL')).toEqual(skillSearchTerms('solar panel'));
    expect(skillSearchTerms('Solar Panel')).toEqual(['solar', 'panel']);
  });

  it('drops words too short to narrow anything', () => {
    // "of" and "a" appear across a large share of real skill tags; matching on
    // them would return most of the network for a query carrying no intent.
    expect(skillSearchTerms('a of in on')).toEqual([]);
  });

  it('drops stopwords but keeps the words around them', () => {
    expect(skillSearchTerms('Repair of Air Conditioners')).toEqual([
      'repair',
      'air',
      'conditioners',
    ]);
  });

  it('falls back to the whole query when nothing survives the length rule', () => {
    // Two characters cannot narrow anything on its own, but it is still what the
    // employer typed and it is still better than matching everything.
    expect(skillSearchTerms('AI')).toEqual(['ai']);
  });

  it('returns nothing for a query with no usable characters at all', () => {
    expect(skillSearchTerms('   ')).toEqual([]);
    expect(skillSearchTerms('---')).toEqual([]);
    expect(skillSearchTerms('')).toEqual([]);
  });

  it('never returns a LIKE wildcard, on any path', () => {
    // The regression this file exists for. An earlier version sanitised the
    // split terms but fell back to the *raw* query when none survived, so `%`
    // became `like '%%%'` — which matches every row, and returned the whole
    // network for a query that named nobody.
    for (const query of ['%', '_', '%%', '%_%', '%%%', '%solar%', '_', '\\']) {
      const terms = skillSearchTerms(query);
      for (const term of terms) {
        expect(term, `query ${JSON.stringify(query)} leaked a wildcard`).not.toMatch(
          /[%_\\]/,
        );
      }
    }

    // And the specific case: a bare wildcard must produce no terms at all, so
    // the query is answered with nothing rather than with everyone.
    expect(skillSearchTerms('%')).toEqual([]);
    expect(skillSearchTerms('_')).toEqual([]);
  });

  it('still finds a real skill that happens to start with a wildcard character', () => {
    // The sanitising must not eat the intent: "100% done" is a findable phrase,
    // and the terms that carry it survive.
    expect(skillSearchTerms('100% done')).toEqual(['100', 'done']);
  });

  it('splits on punctuation rather than on spaces alone', () => {
    expect(skillSearchTerms('Welding, MIG & TIG')).toEqual(['welding', 'mig', 'tig']);
  });
});
