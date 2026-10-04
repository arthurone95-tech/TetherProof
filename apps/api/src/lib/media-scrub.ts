/**
 * Removes metadata from uploaded media before it reaches storage.
 *
 * A photo taken on a phone carries GPS coordinates in its EXIF data, which can
 * reveal a worker's or a client's home address, and timestamps that place a
 * person somewhere at a time they may not want recorded. A recording carries
 * the same information in its ID3 tags or MP4 metadata atoms. Once an object is
 * in storage the only reliable remedy is deletion, so the metadata is removed
 * here, in memory, before a single byte is uploaded.
 *
 * Two strategies are used, because the formats differ:
 *
 * * **Images are re-encoded.** sharp drops all metadata by default, so the
 *   output is clean by construction rather than by trying to enumerate every
 *   tag that might carry a location. This is the reason images are re-encoded
 *   rather than patched: a re-encode cannot miss a tag format we did not think
 *   of.
 * * **Audio containers are edited in place.** Re-encoding audio would need an
 *   external binary such as ffmpeg, so the tag containers are cut out instead.
 *   Editing MP4 requires care, see `stripMp4Metadata` below.
 *
 * Nothing here inspects whether media is genuine. Synthetic-image detection is a
 * separate concern and is not implemented; see doc/13 E-008.
 */
import sharp from 'sharp';
import type { Sharp } from 'sharp';
import { AppError } from './errors.js';

/** What a scrub found and removed, recorded so the outcome is auditable. */
export interface ScrubResult {
  buffer: Buffer;
  /** Media type after scrubbing. Matches the input for every format here. */
  contentType: string;
  /** True when the file carried an EXIF GPS block before scrubbing. */
  hadGps: boolean;
  /** True when the file carried any EXIF or ICC metadata before scrubbing. */
  hadMetadata: boolean;
  /** True when audio tag data was found and cut. */
  hadAudioTags: boolean;
}

/* -------------------------------------------------------------------------- */
/* Images                                                                     */
/* -------------------------------------------------------------------------- */

const GPS_IFD_TAG = 0x8825;
const EXIF_IFD_TAG = 0x8769;

/**
 * Reports whether an EXIF block contains a GPS information IFD.
 *
 * The GPS pointer may sit in IFD0 or in the Exif sub-IFD, so both are walked.
 * This exists only to record that a location was removed, so a shallow parse is
 * enough: a false negative costs an audit detail, never a leak, because the
 * re-encode removes the whole block either way.
 */
function exifCarriesGps(exif: Buffer): boolean {
  // EXIF payloads are prefixed with the six-byte "Exif\0\0" marker.
  if (exif.length < 14) return false;
  const marker = exif.subarray(0, 6).toString('latin1');
  if (marker !== 'Exif\0\0') return false;

  const tiff = exif.subarray(6);
  const byteOrder = tiff.subarray(0, 2).toString('latin1');
  const littleEndian = byteOrder === 'II';
  if (!littleEndian && byteOrder !== 'MM') return false;

  const readU16 = (offset: number): number =>
    littleEndian ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset);
  const readU32 = (offset: number): number =>
    littleEndian ? tiff.readUInt32LE(offset) : tiff.readUInt32BE(offset);

  if (readU16(2) !== 0x2a) return false;

  const visited = new Set<number>();

  const walk = (ifdOffset: number, depth: number): boolean => {
    if (depth > 4 || visited.has(ifdOffset)) return false;
    visited.add(ifdOffset);
    if (ifdOffset <= 0 || ifdOffset + 2 > tiff.length) return false;

    const entries = readU16(ifdOffset);
    for (let i = 0; i < entries; i += 1) {
      const entry = ifdOffset + 2 + i * 12;
      if (entry + 12 > tiff.length) return false;

      const tag = readU16(entry);
      if (tag === GPS_IFD_TAG) return true;
      if (tag === EXIF_IFD_TAG && walk(readU32(entry + 8), depth + 1)) return true;
    }
    return false;
  };

  return walk(readU32(4), 0);
}

/** Maps each supported image type to the sharp encoder that writes it. */
const IMAGE_ENCODERS: Record<string, (image: Sharp) => Sharp> = {
  'image/jpeg': (image) => image.jpeg({ quality: 90, mozjpeg: true }),
  'image/png': (image) => image.png({ compressionLevel: 9 }),
  'image/webp': (image) => image.webp({ quality: 90 }),
  // HEIC is re-encoded as HEIC so the container survives; only metadata goes.
  'image/heic': (image) => image.heif({ compression: 'av1', quality: 80 }),
};

export function isScrubbableImage(contentType: string): boolean {
  return contentType.toLowerCase() in IMAGE_ENCODERS;
}

/**
 * Re-encodes an image so that no metadata survives.
 *
 * `rotate()` with no argument applies the EXIF orientation and then discards the
 * tag, which keeps photos upright without retaining the value that describes the
 * device's orientation. Nothing calls `withMetadata`, so EXIF, ICC, and any
 * embedded location block are all dropped by sharp's defaults.
 */
export async function scrubImage(input: Buffer, contentType: string): Promise<ScrubResult> {
  const encoder = IMAGE_ENCODERS[contentType.toLowerCase()];
  if (!encoder) {
    throw AppError.badRequest('That file type is not supported.');
  }

  // Read the metadata before it is discarded, purely to record what was removed.
  let hadGps = false;
  let hadMetadata = false;
  try {
    const before = await sharp(input, { failOn: 'none' }).metadata();
    hadGps = before.exif ? exifCarriesGps(before.exif) : false;
    hadMetadata = Boolean(before.exif) || Boolean(before.icc) || before.orientation !== undefined;
  } catch {
    // A file sharp cannot read has no metadata we could record. The re-encode
    // below is what decides whether the upload is accepted.
  }

  let buffer: Buffer;
  try {
    buffer = await encoder(sharp(input, { failOn: 'none' }).rotate()).toBuffer();
  } catch {
    // Deliberately vague to the caller: a decode failure can mean a truncated
    // upload, a corrupt file, or content that only claims to be an image.
    throw AppError.badRequest('That image could not be read. Please try a different photo.');
  }

  return { buffer, contentType: contentType.toLowerCase(), hadGps, hadMetadata, hadAudioTags: false };
}

/* -------------------------------------------------------------------------- */
/* Audio                                                                      */
/* -------------------------------------------------------------------------- */

/** MP3 ID3v2 sizes are "synchsafe": seven bits per byte, never the high bit. */
function readSynchsafe(buffer: Buffer, offset: number): number {
  return (
    ((buffer[offset] as number & 0x7f) << 21) |
    ((buffer[offset + 1] as number & 0x7f) << 14) |
    ((buffer[offset + 2] as number & 0x7f) << 7) |
    (buffer[offset + 3] as number & 0x7f)
  );
}

/**
 * Cuts ID3v2 and ID3v1 tags from an MP3.
 *
 * ID3v2 is a declared-length block at the start of the file, so it is removed by
 * its own header rather than by scanning for frame identifiers. ID3v1 is a fixed
 * 128-byte trailer. The MPEG audio frames between them are untouched, so the
 * result is still a valid MP3.
 */
function stripId3(input: Buffer): { buffer: Buffer; removed: boolean } {
  let start = 0;

  if (input.length >= 10 && input.subarray(0, 3).toString('latin1') === 'ID3') {
    const flags = input[5] as number;
    const declared = readSynchsafe(input, 6);
    // Bit 4 signals a 10-byte footer present in the same block.
    const footer = (flags & 0x10) !== 0 ? 10 : 0;
    start = Math.min(input.length, 10 + declared + footer);
  }

  let end = input.length;
  if (input.length >= 128 && input.subarray(end - 128, end - 125).toString('latin1') === 'TAG') {
    end -= 128;
  }

  if (start === 0 && end === input.length) return { buffer: input, removed: false };
  return { buffer: input.subarray(start, end), removed: true };
}

interface Mp4Box {
  type: string;
  start: number;
  end: number;
  /** Bytes occupied by the size and type fields. */
  headerSize: number;
}

/** Reads one box header. Returns null when the bytes are not a well-formed box. */
function readMp4Box(buffer: Buffer, offset: number): Mp4Box | null {
  if (offset + 8 > buffer.length) return null;

  const declared = buffer.readUInt32BE(offset);
  const type = buffer.subarray(offset + 4, offset + 8).toString('latin1');
  let size = declared;
  let headerSize = 8;

  if (declared === 1) {
    // A size of 1 means the real 64-bit size follows the type field.
    if (offset + 16 > buffer.length) return null;
    const large = buffer.readBigUInt64BE(offset + 8);
    if (large > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    size = Number(large);
    headerSize = 16;
  } else if (declared === 0) {
    // A size of 0 means the box runs to the end of the file.
    size = buffer.length - offset;
  }

  if (size < headerSize || offset + size > buffer.length) return null;
  return { type, start: offset, end: offset + size, headerSize };
}

/** Boxes whose payload is a list of further boxes. */
const MP4_CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'udta', 'ilst']);

/** Boxes dropped wholesale, because they carry only descriptive metadata. */
const MP4_METADATA_BOXES = new Set(['udta', 'meta']);

type Range = { start: number; end: number };

/** Collects the byte ranges of every metadata box, without descending into them. */
function collectMp4Metadata(buffer: Buffer, range: Range, depth: number, found: Range[]): void {
  if (depth > 8) return;

  let offset = range.start;
  while (offset < range.end) {
    const box = readMp4Box(buffer, offset);
    if (!box) return;

    if (MP4_METADATA_BOXES.has(box.type)) {
      found.push({ start: box.start, end: box.end });
    } else if (MP4_CONTAINERS.has(box.type)) {
      collectMp4Metadata(buffer, { start: box.start + box.headerSize, end: box.end }, depth + 1, found);
    }

    offset = box.end;
  }
}

/** Visits every box in the tree, including the metadata boxes. */
function walkMp4Boxes(
  buffer: Buffer,
  range: Range,
  depth: number,
  visit: (box: Mp4Box) => void,
): void {
  if (depth > 8) return;

  let offset = range.start;
  while (offset < range.end) {
    const box = readMp4Box(buffer, offset);
    if (!box) return;

    visit(box);

    if (MP4_CONTAINERS.has(box.type)) {
      walkMp4Boxes(buffer, { start: box.start + box.headerSize, end: box.end }, depth + 1, visit);
    }

    offset = box.end;
  }
}

/** Total number of bytes deleted that fall strictly before `position`. */
function deletedBefore(position: number, removals: Range[]): number {
  let total = 0;
  for (const range of removals) {
    if (range.end <= position) total += range.end - range.start;
  }
  return total;
}

/**
 * Repoints the sample offset tables after bytes are removed.
 *
 * MP4 stores absolute file offsets to media samples in `stco` (32-bit) and
 * `co64` (64-bit), both inside the sample table. Deleting a metadata box that
 * sits before the media data shifts that data earlier in the file, so every
 * offset would now point at the wrong place and the audio would not play.
 * Subtracting the bytes removed ahead of each offset keeps the file valid.
 */
function repointSampleOffsets(buffer: Buffer, removals: Range[]): void {
  walkMp4Boxes(buffer, { start: 0, end: buffer.length }, 0, (box) => {
    if (box.type !== 'stco' && box.type !== 'co64') return;

    // A table that is itself being deleted needs no correcting.
    const deleted = removals.some((r) => box.start < r.end && r.start < box.end);
    if (deleted) return;

    const wide = box.type === 'co64';
    const width = wide ? 8 : 4;
    const countOffset = box.start + box.headerSize + 4;
    if (countOffset + 4 > buffer.length) return;

    const count = buffer.readUInt32BE(countOffset);
    const first = countOffset + 4;

    for (let i = 0; i < count; i += 1) {
      const at = first + i * width;
      if (at + width > buffer.length) break;

      const original = wide ? Number(buffer.readBigUInt64BE(at)) : buffer.readUInt32BE(at);
      const adjusted = original - deletedBefore(original, removals);
      if (adjusted < 0 || adjusted === original) continue;

      if (wide) buffer.writeBigUInt64BE(BigInt(adjusted), at);
      else buffer.writeUInt32BE(adjusted, at);
    }
  });
}

/**
 * Cuts the metadata atoms from an MP4-family container (m4a, aac).
 *
 * `udta` holds the descriptive atoms, including the `©xyz` location atom that
 * records where a recording was made. `ftyp` and `mdat`, the actual audio, are
 * never touched.
 */
function stripMp4Metadata(input: Buffer): { buffer: Buffer; removed: boolean } {
  const buffer = Buffer.from(input);
  const removals: Range[] = [];

  collectMp4Metadata(buffer, { start: 0, end: buffer.length }, 0, removals);
  if (removals.length === 0) return { buffer, removed: false };

  // Nested metadata boxes cannot occur, because collection does not descend into
  // one, but sorting keeps the rebuild correct regardless of discovery order.
  removals.sort((a, b) => a.start - b.start);
  repointSampleOffsets(buffer, removals);

  const parts: Buffer[] = [];
  let cursor = 0;
  for (const range of removals) {
    parts.push(buffer.subarray(cursor, range.start));
    cursor = range.end;
  }
  parts.push(buffer.subarray(cursor));

  return { buffer: Buffer.concat(parts), removed: true };
}

function looksLikeMp4(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  const type = buffer.subarray(4, 8).toString('latin1');
  return type === 'ftyp';
}

export function isScrubbableAudio(contentType: string): boolean {
  const type = contentType.toLowerCase();
  return type === 'audio/mpeg' || type === 'audio/mp4' || type === 'audio/aac';
}

/**
 * Removes tag data from an audio upload.
 *
 * A file whose declared type does not match its actual container is refused
 * rather than passed through, because silently uploading an unsanitised file
 * under the promise of having been scrubbed is the exact failure this module
 * exists to prevent.
 */
export function scrubAudio(input: Buffer, contentType: string): ScrubResult {
  const type = contentType.toLowerCase();

  if (type === 'audio/mpeg') {
    const result = stripId3(input);
    return {
      buffer: result.buffer,
      contentType: type,
      hadGps: false,
      hadMetadata: result.removed,
      hadAudioTags: result.removed,
    };
  }

  if (type === 'audio/mp4' || type === 'audio/aac') {
    if (!looksLikeMp4(input)) {
      throw AppError.badRequest('That audio file could not be read. Please try recording again.');
    }

    const result = stripMp4Metadata(input);
    return {
      buffer: result.buffer,
      contentType: type,
      hadGps: false,
      hadMetadata: result.removed,
      hadAudioTags: result.removed,
    };
  }

  throw AppError.badRequest('That file type is not supported.');
}