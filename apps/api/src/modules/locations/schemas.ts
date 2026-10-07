import { z } from 'zod';

/**
 * Decimal degrees, matching how the rest of the API reads coordinates.
 *
 * Coerced from strings because the parameters arrive as query text; the range
 * checks reject a coordinate pair that cannot be a place.
 */
export const reverseGeocodeQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
});