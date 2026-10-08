/**
 * How icons are drawn across the app.
 *
 * Every icon comes from Lucide (the Feather set, kept current), imported by name
 * from `lucide-react`. One set for the whole app is the point: a product about
 * verified capability cannot have three icon families, because the mismatched
 * geometry is what makes an interface read as unfinished.
 *
 * Size comes from a Tailwind class at the call site (`h-6 w-6`, `h-5 w-5`), so
 * an icon is sized by the same scales as the text and boxes around it.
 *
 * Stroke width is the one value that must never drift: Lucide defaults to 2,
 * which is slightly heavier than the weight this interface has always used, so
 * every icon passes `strokeWidth={ICON_STROKE_WIDTH}` rather than relying on the
 * default. Colour is never set here — icons inherit `currentColor` from their
 * container, which is how hover and active states already work.
 *
 * Decorative icons take `aria-hidden`; an icon that is the only content of a
 * control needs an `aria-label` on the control instead, which the surrounding
 * markup already does.
 */
export const ICON_STROKE_WIDTH = 1.8;