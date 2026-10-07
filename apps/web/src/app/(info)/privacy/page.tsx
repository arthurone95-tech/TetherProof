import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy — TetherProof',
};

const sections = [
  {
    title: 'What TetherProof collects',
    body: 'To sign up we need your name and email address, and a password. Optional details — a phone number for confirmation links, your location on a work log — are yours to give or withhold. We never read, store, or sell the contents of your work logs for advertising, and nothing you log is visible to the public.',
  },
  {
    title: 'Your work logs',
    body: 'Your logs — descriptions, media, coordinates, and their confirmation status — are visible only to you and to the person you share a confirmation link with. Employers searching for verified proof see aggregated counts and skill records, not your media or your coordinates. The location on a log is stored exactly as you typed it or as the GPS provided it, and is the only location record kept: the file’s own GPS metadata is stripped before storage.',
  },
  {
    title: 'Confirmation links',
    body: 'Each log creates one link that works once and expires after seven days. A verifier’s phone number, when given, is never stored in readable form — only a one-way hash is kept, to notice when the same person confirms several of your logs. The link itself lets its holder confirm one specific job and nothing else.',
  },
  {
    title: 'Deletion and retention',
    body: 'Deleting your account removes everything that identifies you, and files you uploaded are queued for removal from storage. Because proof counts and trust scores are shared aggregates that other people rely on, your work logs remain on the platform after deletion without your name attached — but no longer connected to you in any way that can be looked up.',
  },
  {
    title: 'Security',
    body: 'Media is stored in a private bucket and is only reachable through short-lived, signed links created for the person looking at their own log or the verifier holding a live link. Sessions are handled with tokens rather than permanent credentials. TetherProof is built and tested in the open, and hardens continuously against the ways a platform like this can be misused.',
  },
];

export default function PrivacyPage() {
  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-2xl font-bold text-ink-900 sm:text-3xl">Privacy Policy</h1>
        <p className="mt-2 text-ink-600">
          What we keep, what we scrub, and what we let go of.
        </p>
      </header>

      {sections.map((section) => (
        <section key={section.title} className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-ink-900">{section.title}</h2>
          <p className="leading-7 text-ink-700">{section.body}</p>
        </section>
      ))}
    </div>
  );
}