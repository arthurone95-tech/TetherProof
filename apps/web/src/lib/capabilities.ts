import type { SkillLevel } from '@tetherproof/shared';

/**
 * How a skill level reads, and the line that explains it.
 *
 * The level lives on the capability block a worker's proofs hang under (1 is
 * entry, 3 is advanced) and appears wherever that block is shown: the log
 * detail, the profile's capability list, and the public shareable page. One map
 * so every surface agrees on the label and the meaning.
 */
export const SKILL_LEVELS: ReadonlyArray<{ level: SkillLevel; label: string; description: string }> = [
  {
    level: 1,
    label: 'Entry',
    description: 'Starting out — work logged under it counts but is early.',
  },
  {
    level: 2,
    label: 'Skilled',
    description: 'Working regularly and independently in this skill.',
  },
  {
    level: 3,
    label: 'Advanced',
    description: 'Expert in this skill, with a track record behind it.',
  },
];

export function skillLevelLabel(level: SkillLevel): string {
  return SKILL_LEVELS.find((entry) => entry.level === level)?.label ?? 'Entry';
}

export function skillLevelDescription(level: SkillLevel): string {
  return SKILL_LEVELS.find((entry) => entry.level === level)?.description ?? '';
}