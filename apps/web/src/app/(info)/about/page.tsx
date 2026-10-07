import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'About — TetherProof',
};

const sections = [
  {
    title: 'What TetherProof is',
    body: 'TetherProof is a record of work done. A worker logs a finished job with a photo or a voice note, says what they did and where, and a person they worked with confirms it through a link. Confirmed work becomes proof an employer can check instead of a résumé claim.',
  },
  {
    title: 'How proof stays honest',
    body: 'The photo or recording is scrubbed of its built-in location and device details before it is stored, so the only record of where something happened is what the worker typed. Confirmation links are single-use, expire, and each can only confirm one job. Proof logs and the skills attached to them stay with the worker as a growing record.',
  },
  {
    title: 'Who it is for',
    body: 'Workers build the record. Employers define the skills they need and search confirmed proof rather than reading applications, and invite workers whose records match. A training provider module is in the works; until it ships, training providers see a page that says so rather than a half-built tool.',
  },
  {
    title: 'Where the project stands',
    body: 'TetherProof is being built and tested in the open. Everything a worker sees today — logging work, GPS location, confirmation links, the logbook, invitations — is live. Some employer-side and provider-side pieces are still being built, and pages that are not ready say that plainly.',
  },
];

export default function AboutPage() {
  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-2xl font-bold text-ink-900 sm:text-3xl">About TetherProof</h1>
        <p className="mt-2 text-ink-600">
          Proof of the work you have done, tethered to the people who saw you do it.
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