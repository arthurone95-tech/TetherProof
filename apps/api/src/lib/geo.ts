/**
 * Coordinate parsing and distance.
 *
 * Shared by the submission endpoint and the confirmation endpoint so both apply
 * exactly the same rules. That was not previously true: the confirm endpoint
 * checked only the `lat,lon` shape, so `999,999` was accepted there while the
 * submission endpoint rejected it. One endpoint's laxer validation is enough to
 * poison the proximity check, which is the only consumer of these values.
 */
import { z } from 'zod';

export interface Coordinate {
  latitude: number;
  longitude: number;
}

/**
 * A `latitude,longitude` pair that is both well-formed and in range.
 *
 * The shape check on its own accepts `999,999`, so the range check is not
 * optional. Applied at the boundary in both directions: an out-of-range
 * coordinate must never reach the database, because a later proximity
 * calculation over a nonsense point produces a confident, wrong answer.
 */
export const gpsSchema = z
  .string()
  .trim()
  .regex(/^-?\d{1,3}(\.\d+)?,-?\d{1,3}(\.\d+)?$/, 'Location coordinates are malformed.')
  .refine((value) => parseCoordinate(value) !== null, 'Location coordinates are out of range.');

/**
 * Parses a validated coordinate string, or returns null.
 *
 * Returns null rather than throwing so callers can treat "no usable location"
 * as an ordinary outcome. A confirmation link tapped by a client who declined
 * geolocation sharing is not an error, and must not be reported as one.
 */
export function parseCoordinate(value: string | null | undefined): Coordinate | null {
  if (!value) return null;

  const [latitude, longitude] = value.split(',');
  const lat = Number(latitude);
  const lon = Number(longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  // Rejects NaN and Infinity as well, since comparisons against them are false.
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

  return { latitude: lat, longitude: lon };
}

const EARTH_RADIUS_KM = 6371.0088;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Great-circle distance between two coordinates, in kilometres.
 *
 * Uses the haversine formula, which is numerically well behaved for the small
 * distances this is used on. Vincenty's more accurate variant would be the
 * choice for long-haul navigation and is unnecessary here: the comparison is
 * against a threshold in the tens of kilometres, where the two agree to well
 * under a percent.
 */
export function distanceKm(a: Coordinate, b: Coordinate): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}