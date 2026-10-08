import type { Metadata } from 'next';
import { InfoPage } from '../InfoPage';

export const metadata: Metadata = {
  title: 'Terms & Conditions — TetherProof',
};

const sections = [
  {
    title: 'Using TetherProof',
    body: 'By creating an account you agree to use TetherProof for its intended purpose: keeping an honest, verifiable record of completed work. You are responsible for what you log, the phone numbers you ask us to message, and the links you share.',
  },
  {
    title: 'Accounts and roles',
    body: 'Accounts are personal. A worker logs their own completed work; an employer defines the skills they need and invites workers whose verified records match. Training provider accounts are not yet active. You may only operate an account in a role you actually hold.',
  },
  {
    title: 'Proof logs',
    body: 'A log records one completed job: a photo or voice note, a description, a skill, and optionally the location. You own your logs. Media you upload is scrubbed of its built-in location and device metadata before storage and cannot later be replaced, because replacing evidence would defeat the confirmation process.',
  },
  {
    title: 'Confirmation',
    body: 'Every log creates one single-use confirmation link that expires after seven days. Confirming a log is an assertion by the recipient that the work described happened. Confirmed logs become part of your verified record; unconfirmed logs remain part of your logbook but are not verified proof.',
  },
  {
    title: 'Acceptable use',
    body: 'You may not log work you did not do, confirm work you did not witness, use the platform to harass or mislead, attempt to access another account or another person’s data, or interfere with the service. TetherProof may remove content or suspend accounts that violate these terms.',
  },
  {
    title: 'Account deletion and retention',
    body: 'You can delete your account at any time from your Profile page. Deletion removes everything that identifies you — your account, profile, and personal details. Because proof counts and trust scores are shared aggregates, your work logs remain on the platform without your name attached after deletion. Media attached to your logs is queued for removal from storage.',
  },
  {
    title: 'Changes and liability',
    body: 'TetherProof is provided as it is, and is being built and tested in the open. We may change these terms as the service develops; material changes will be reflected here. TetherProof is not a service that admits, employs, or accredits you — it is a record of work that others may choose to rely on.',
  },
];

export default function TermsPage() {
  return (
    <InfoPage title="Terms & Conditions">
      {sections.map((section) => (
        <section key={section.title} className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-ink-900">{section.title}</h2>
          <p className="leading-7 text-ink-700">{section.body}</p>
        </section>
      ))}
    </InfoPage>
  );
}