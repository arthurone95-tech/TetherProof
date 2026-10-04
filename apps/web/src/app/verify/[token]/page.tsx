import type { Metadata } from 'next';
import { VerificationView } from './VerificationView';

/**
 * The verification token is a live capability, so this page must never leak
 * it to a third party through the Referer header.
 */
export const metadata: Metadata = {
  title: 'Confirm work - TetherProof',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

export default async function VerificationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <VerificationView token={token} />;
}
