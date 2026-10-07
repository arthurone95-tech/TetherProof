/**
 * Turns the stored `latitude,longitude` pair into something readable.
 *
 * The API keeps the pair exactly as the worker typed it or as the GPS filled
 * it, with full precision; the display strips that precision so a sentence
 * reads like a place rather than a sensor dump.
 */
export function prettyCoords(gps: string): string {
  const [lat, lon] = gps.split(',');
  const latNum = Number(lat);
  const lonNum = Number(lon);
  if (Number.isFinite(latNum) && Number.isFinite(lonNum)) return `${latNum}, ${lonNum}`;
  return gps;
}