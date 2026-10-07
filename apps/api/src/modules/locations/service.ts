import { logger } from '../../config/logger.js';
import { AppError } from '../../lib/errors.js';

/**
 * A place name for coordinates, or null when the provider has nothing to call it.
 *
 * The web client sends the browser's GPS fix here so the worker is shown a
 * place/area name instead of being asked to read "5.6037,-0.1870". The name is
 * presentation only: the proof is stored with the coordinates, never with this
 * text, so a provider that cannot name a spot costs the worker a label, not the
 * location itself.
 */
export interface ReverseGeocodeResult {
  placeName: string | null;
}

/**
 * The reverse geocoder.
 *
 * Nominatim (nominatim.openstreetmap.org) is the keyless OpenStreetMap
 * service, which keeps the deployment self-contained: no billing setup, no
 * credential to rotate. It is a third-party service regardless, so this is
 * deliberately the only place the API knows its address, every call carries a
 * descriptive User-Agent as its policy asks, and each request is bounded by a
 * timeout and a rate limit so a hung or abusive caller cannot stall a request
 * or burn egress forever. The earlier Photon provider proved too flaky
 * (regular 503s), which is why the URL and parser are isolated in this one
 * file.
 */
const NOMINATIM_REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';
const TIMEOUT_MS = 6000;

export async function reverseGeocode(
  latitude: number,
  longitude: number,
): Promise<ReverseGeocodeResult> {
  const url = `${NOMINATIM_REVERSE_URL}?format=jsonv2&zoom=16&accept-language=en&lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`;

  // Transient failures are real: a dropped connection or a slow network answers
  // "we could not reach the provider" when a normal retry would have gone
  // through. One retry is the whole budget; the provider's usage policy and the
  // API's own rate limiter are the reasons it stays at one.
  let payload: unknown = null;
  let lastFailure: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: {
          accept: 'application/json',
          'user-agent': 'TetherProof/0.1 (server-side reverse geocoding for worker work logs)',
        },
        signal: controller.signal,
      });
      payload = await response.json().catch(() => null);
      break;
    } catch (cause) {
      lastFailure = cause;
      // A second attempt after a wall-clock delay, so a provider that is simply
      // slow is not hammered with two immediate calls.
      if (attempt === 1) await new Promise((resolve) => setTimeout(resolve, 600));
    } finally {
      clearTimeout(timer);
    }
  }

  if (payload === null && lastFailure !== null) {
    logger.warn('Reverse geocoding request failed', {
      url,
      error: lastFailure instanceof Error ? lastFailure.message : String(lastFailure),
    });
    throw AppError.serviceUnavailable('We could not name that place. The coordinates were still saved.');
  }

  const placeName = composePlace(payload);
  return { placeName };
}

/**
 * Picks a readable name out of Nominatim's answer, or returns null for nothing.
 *
 * Nominatim's jsonv2 reverse response carries `name`, a full `display_name`,
 * and an `address` object with the parts. The name on its own is often a road
 * or landmark, so the area and country follow it — "Patrice Lumumba Road,
 * Accra, Ghana" rather than the raw full address with postcode and district.
 * Every field is checked before use because the answer is external and could
 * be shaped any way.
 */
function composePlace(payload: unknown): string | null {
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
  if (!record) return null;

  const addressRecord = record.address;
  const address =
    addressRecord && typeof addressRecord === 'object'
      ? (addressRecord as Record<string, unknown>)
      : {};

  const take = (...keys: string[]): string => {
    for (const key of keys) {
      const value = address[key];
      if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    }
    return '';
  };

  const name =
    typeof record.name === 'string' && record.name.trim().length > 0
      ? record.name.trim()
      : take('road');
  const area = take('city', 'town', 'village', 'suburb', 'neighbourhood', 'county', 'state');
  const country = take('country');

  const parts = [name, area, country].filter((part) => part.length > 0);
  if (parts.length === 0) return null;

  return parts.join(', ');
}