import type { Metadata } from 'next';
import { InfoPage } from '../InfoPage';

export const metadata: Metadata = {
  title: 'Help — TetherProof',
};

const sections = [
  {
    title: 'Log a finished job',
    body: 'Open the Work tab, choose Photo or Voice note, attach or record it, and write what you did — at least 10 characters, one job at a time. Add where it happened if you want it on the record. Tap “Log this work”. The entry appears in your Logs, and a confirmation link is created for it.',
  },
  {
    title: 'Use my location',
    body: 'Tap “Use my location” and the app asks the browser for your position, then names the area for you through the coordinates it got. Your browser must allow location access. If the GPS cannot get a fix, the app says so and you can type the coordinates yourself instead — that stays a fallback, never the main act.',
  },
  {
    title: 'Share the confirmation link',
    body: 'Every log makes one link that lets the person you worked with confirm it. We never ask for their number and never message them for you — the link is yours to pass on however you already talk to them. On a phone, tap “Share verification link” and choose WhatsApp, Messages, email, or any other app you have; on a computer, or in a browser with no sharing, “Copy link” does the same job and you paste it wherever you need it. Nothing is sent until you send it, and the person you send it to does not need a TetherProof account. The link works once and stops working after seven days.',
  },
  {
    title: 'Edit or fix a log',
    body: 'Open the log from your Logs tab. While no confirmation link is open for it, you can change the description, the skill, or the location. As soon as a link is live — and permanently once the log has been answered — the entry is fixed, so the person reading it sees exactly what you wrote. If a link runs out unanswered, the log becomes editable again and you can raise a fresh one, which stops the old link working straight away. Media can never be replaced: it was scrubbed and stored once, on purpose.',
  },
  {
    title: 'Invitations',
    body: 'An employer who sees your verified record can invite you with a note and a skill requirement. Pending invitations wait behind the invitation icon at the top-right of Home, with a count of how many still need your answer. Open it to accept or decline each one. Accepting confirms your interest; declining is final for that invitation.',
  },
  {
    title: 'Account and privacy',
    body: 'Your profile holds your name and contact details, and only you can see your own logs with their coordinates. Sign out lives on your Profile page, and deleting your account lives under the menu, in Settings. Deleting removes everything that identifies you; the work you logged stays on the platform without your name, because proof counts are shared and one person leaving should not quietly change everyone else’s totals.',
  },
  {
    title: 'Something is not working',
    body: 'A slow or failed location lookup does not lose your work: the coordinates are saved either way, and the area name is only a label. If a page misbehaves, try again once — most field-contact issues are temporary. Anything that keeps failing is worth reporting, because TetherProof is still being hardened in the open.',
  },
];

export default function HelpPage() {
  return (
    <InfoPage title="Help">
      {sections.map((section) => (
        <section key={section.title} className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-ink-900">{section.title}</h2>
          <p className="leading-7 text-ink-700">{section.body}</p>
        </section>
      ))}
    </InfoPage>
  );
}
