/**
 * The unfilled shape of a page.
 *
 * One primitive for the pulse and the tone, so every route's skeleton is cut
 * from the same material and looks like the same app. Only the arrangement is
 * per-page: a skeleton that does not match the screen it precedes is a second
 * flash of the wrong thing, worse than a blank because it promises a layout that
 * then changes. `aria-hidden` because the block carries no information; the
 * surrounding region is what says it is busy.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-lg bg-brand-100 ${className}`} />;
}

/** Several lines of text at body height, the last one short. */
export function SkeletonText({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden="true" className={`flex flex-col gap-2 ${className}`}>
      {Array.from({ length: lines }).map((_, line) => (
        <Skeleton key={line} className={`h-3.5 ${line === lines - 1 ? 'w-2/3' : 'w-full'}`} />
      ))}
    </div>
  );
}

/**
 * An empty card in the app's own card treatment.
 *
 * The border and the white fill are the part a member recognises as the screen
 * they were already looking at, so a route's skeleton keeps them and only the
 * inside is grey.
 */
export function SkeletonCard({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-brand-100 bg-white p-6 shadow-sm ${className}`}>
      {children}
    </div>
  );
}
