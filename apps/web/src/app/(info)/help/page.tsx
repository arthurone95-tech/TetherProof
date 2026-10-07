import type { Metadata } from 'next';

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
    title: 'Send the confirmation link',
    body: 'Every log makes one link that lets the person you worked with confirm it. Give them a phone number and the link is sent to them; leave it out and you get the link to share yourself, by WhatsApp, SMS, or any other way. The link works once and stops working after seven days.',
  },
  {
    title: 'Edit or fix a log',
    body: 'Open the log from your Logs tab. While nothing has been sent out for confirmation yet, you can change the description, the skill, or the location. Once a confirmation link has actually been sent — or the log has been confirmed — the entry is fixed. Media can never be replaced: it was scrubbed and stored once, on purpose.',
  },
  {
    title: 'Invitations',
    body: 'An employer who sees your verified record can invite you with a note and a skill requirement. Pending invitations sit under the more menu (⋯) in Invitations, and you can accept or decline them there. Accepting confirms your interest; declining is final for that invitation.',
  },
  {
    title: 'Account and privacy',
    body: 'Your profile holds your name and contact details, and only you can see your own logs with their coordinates. Sign out and delete your account live on your Profile page. Deleting removes everything that identifies you; the work you logged stays on the platform without your name, because proof counts are shared and one person leaving should not quietly change everyone else’s totals.',
  },
  {
    title: 'Something is not working',
    body: 'A slow or failed location lookup does not lose your work: the coordinates are saved either way, and the area name is only a label. If a page misbehaves, try again once — most field-contact issues are temporary. Anything that keeps failing is worth reporting, because TetherProof is still being hardened in the open.',
  },
];

export default function HelpPage() {
  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-2xl font-bold text-ink-900 sm:text-3xl">Help</h1>
        <p className="mt-2 text-ink-600">
          How the app works, in the order you will meet it.
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