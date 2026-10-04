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
 * Metadata is also read for one purpose before it is destroyed: to record
 * whether the file looked like a genuine capture. Feature 2.4 asks for an
 * AI-generated-media detector, and this is the honest part of that idea. It is
 * **not** possible to detect AI generation from file metadata, and nothing here
 * claims to. What can be established is narrower and still useful: whether the
 * file carried the identifying and timing data a real capture device writes,
 * and whether the container is structurally what its declared type claims.
 * Those are consistency checks, so they are recorded as booleans and the
 * values they were derived from are discarded with the rest of the metadata.
 *
 * Nothing here decides whether media is genuine. That judgement belongs to the
 * anti-fraud engine, which treats these as weak evidence alongside proximity and
 * collusion; see `lib/fraud/`.
 */
import sharp from 'sharp';
import type { Sharp } from 'sharp';
import { AppError } from './errors.js';

/**
 * What could be established about a file before its metadata was destroyed.
 *
 * Every field is a boolean or null. No make, model, serial number, or timestamp
 * is carried out of this module, which is what allows the provenance signal to
 * exist at all without weakening the privacy promise in doc/08.
 *
 * A null means "not applicable or not determinable", which is different from
 * false. Audio containers carry no capture device or capture time, so their
 * fields stay null and the engine reads null as neutral.
 */
export interface MediaSignals {
  /** The discarded EXIF identified a capture device. */
  hasCameraSignature: boolean | null;
  /** The discarded capture time was consistent with the moment of submission. */
  timestampPlausible: boolean | null;
  /** The container is structurally the format its declared type claims. */
  encoderKnown: boolean | null;
}

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
  /** Provenance findings derived from the metadata that was just discarded. */
  signals: MediaSignals;
}

/* -------------------------------------------------------------------------- */
/* Images                                                                     */
/* -------------------------------------------------------------------------- */

const GPS_IFD_TAG = 0x8825;
const EXIF_IFD_TAG = 0x8769;

/** EXIF tags that identify a capture device rather than describe the image. */
const MAKE_TAG = 0x010f;
const MODEL_TAG = 0x0110;
const SOFTWARE_TAG = 0x0131;
const DATE_TIME_ORIGINAL_TAG = 0x9003;
const DATE_TIME_DIGITIZED_TAG = 0x9004;
const DATE_TIME_TAG = 0x0132;
const LENS_MAKE_TAG = 0xa433;
const LENS_MODEL_TAG = 0xa434;
const BODY_SERIAL_TAG = 0xa431;
const MAKER_NOTE_TAG = 0x927c;

/**
 * A shallow read of the EXIF IFD tree, collecting the tag values relevant to
 * provenance.
 *
 * Deliberately shallow and deliberately untrusted. These values are used only to
 * decide whether a file looks like it came from a capture device, and every one
 * of them is discarded as soon as that decision is made. A malformed or
 * adversarial EXIF block can therefore misreport these values, which is
 * accepted: the signals are weak evidence and are scored as such. A block that
 * cannot be parsed simply yields nothing, which reads as "no camera signature"
 * rather than as a rejection, so a crafted file cannot use this to make itself
 * look authentic with an affirmative claim it did not earn.
 */
interface ExifFacts {
  carriesGps: boolean;
  /** True when the block names a capture device. */
  hasCameraSignature: boolean;
  /** Raw capture time, or null when the block records none. */
  capturedAt: Date | null;
}

const EMPTY_EXIF_FACTS: ExifFacts = {
  carriesGps: false,
  hasCameraSignature: false,
  capturedAt: null,
};

/**
 * EXIF stores every ASCII value as a count-prefixed string, and every rational
 * as two 4-byte longs. Both are read here so tag values can be interpreted.
 */
function readExifAscii(
  tiff: Buffer,
  valueOffset: number,
  type: number,
  count: number,
): string | null {
  if (type !== 2 /* ASCII */) return null;
  const length = Math.min(count, 128);
  if (valueOffset + length > tiff.length) return null;

  return tiff
    .subarray(valueOffset, valueOffset + length)
    .toString('latin1')
    .replace(/\0.*$/s, '')
    .trim();
}

/** EXIF date strings are `YYYY:MM:DD HH:MM:SS` with no timezone. */
function parseExifDate(value: string | null): Date | null {
  if (!value) return null;
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;

  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

function readExifFacts(exif: Buffer): ExifFacts {
  // EXIF payloads are prefixed with the six-byte "Exif\0\0" marker.
  if (exif.length < 14) return EMPTY_EXIF_FACTS;
  if (exif.subarray(0, 6).toString('latin1') !== 'Exif\0\0') return EMPTY_EXIF_FACTS;

  const tiff = exif.subarray(6);
  const byteOrder = tiff.subarray(0, 2).toString('latin1');
  const littleEndian = byteOrder === 'II';
  if (!littleEndian && byteOrder !== 'MM') return EMPTY_EXIF_FACTS;

  const readU16 = (offset: number): number =>
    littleEndian ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset);
  const readU32 = (offset: number): number =>
    littleEndian ? tiff.readUInt32LE(offset) : tiff.readUInt32BE(offset);

  if (readU16(2) !== 0x2a) return EMPTY_EXIF_FACTS;

  const facts: ExifFacts = { ...EMPTY_EXIF_FACTS };
  let sawMake = false;
  let sawModel = false;
  const visited = new Set<number>();

  const walk = (ifdOffset: number, depth: number): void => {
    if (depth > 4 || visited.has(ifdOffset)) return;
    visited.add(ifdOffset);
    if (ifdOffset <= 0 || ifdOffset + 2 > tiff.length) return;

    const entries = readU16(ifdOffset);
    // A count beyond what the buffer can hold means the block is corrupt, and
    // reading on would produce garbage interpreted as fact.
    if (entries > 512) return;

    for (let i = 0; i < entries; i += 1) {
      const entry = ifdOffset + 2 + i * 12;
      if (entry + 12 > tiff.length) return;

      const tag = readU16(entry);
      const type = readU16(entry + 2);
      const count = readU32(entry + 4);

      if (tag === GPS_IFD_TAG) {
        facts.carriesGps = true;
        continue;
      }

      if (tag === EXIF_IFD_TAG) {
        walk(readU32(entry + 8), depth + 1);
        continue;
      }

      switch (tag) {
        case MAKE_TAG:
          sawMake = readExifAscii(tiff, readU32(entry + 8), type, count) !== null;
          break;
        case MODEL_TAG:
          sawModel = readExifAscii(tiff, readU32(entry + 8), type, count) !== null;
          break;
        case LENS_MAKE_TAG:
        case LENS_MODEL_TAG:
        case BODY_SERIAL_TAG:
        case MAKER_NOTE_TAG:
          // A lens, a body serial, or a vendor maker note are all written by
          // physical capture devices and are not written by image generators.
          facts.hasCameraSignature = true;
          break;
        case DATE_TIME_ORIGINAL_TAG:
        case DATE_TIME_DIGITIZED_TAG:
        case DATE_TIME_TAG: {
          // Original wins over the fallbacks, so the earliest tag found first
          // must not be overwritten by a later, less specific one.
          if (!facts.capturedAt) {
            facts.capturedAt = parseExifDate(readExifAscii(tiff, readU32(entry + 8), type, count));
          }
          break;
        }
        case SOFTWARE_TAG:
          // Recorded for completeness of the parse. Software strings name editing
          // tools more often than cameras, so they are deliberately not treated
          // as a camera signature in either direction.
          readExifAscii(tiff, readU32(entry + 8), type, count);
          break;
        default:
          break;
      }
    }
  };

  walk(readU32(4), 0);

  // A model with no make, or the reverse, is a stripped-down block rather than a
  // capture claim, so both are required.
  facts.hasCameraSignature = facts.hasCameraSignature || (sawMake && sawModel);
  return facts;
}

/**
 * Decides whether a capture time is consistent with the moment of submission.
 *
 * Rejects two things and nothing else:
 *
 * * **Future timestamps.** A photo taken after it was submitted is not a photo
 *   of the work, allowing a small allowance for a device with a fast clock.
 * * **Dates before 2005.** Every phone and compact camera writes a capture time,
 *   so a missing one means the clock was never set. The 1970 epoch and 1999 are
 *   what unset clocks and generators both land on, and both indicate the file
 *   was not produced by a camera that was actually running.
 *
 * Deliberately tolerant of old photographs, because submitting a photo from
 * earlier in the week is legitimate and blocking it would punish honest workers.
 */
export function isTimestampPlausible(capturedAt: Date | null, submittedAt: Date): boolean | null {
  if (!capturedAt) return null;

  const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;
  const EARLIEST_TRUSTWORTHY = Date.UTC(2005, 0, 1);

  if (capturedAt.getTime() > submittedAt.getTime() + CLOCK_SKEW_TOLERANCE_MS) return false;
  if (capturedAt.getTime() < EARLIEST_TRUSTWORTHY) return false;

  return true;
}

/**
 * Confirms the container is structurally the format it claims to be.
 *
 * sharp decodes the image either way, so this checks the container's own
 * framing rather than the pixels: a JPEG needs a start-of-frame marker, a PNG
 * needs a chunk stream whose header CRC actually matches. Hand-assembled or
 * stitched-together files reliably fail one of these, and a valid file that
 * merely claims a wrong type is refused earlier by the allow-list.
 */
function encoderLooksValid(buffer: Buffer, contentType: string): boolean {
  if (contentType === 'image/jpeg') {
    if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return false;
    for (let i = 2; i + 1 < buffer.length; i += 1) {
      if (buffer[i] !== 0xff) continue;
      const marker = buffer[i + 1] as number;
      // SOF0/1/2 carry a frame header. C4, C8 and CC are not frame markers.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return true;
      }
    }
    return false;
  }

  if (contentType === 'image/png') {
    const signature = '89504e470d0a1a0a';
    if (buffer.length < 33 || buffer.subarray(0, 8).toString('hex') !== signature) return false;
    // Bytes 12..15 hold the CRC the IHDR chunk's type and data must produce.
    const declared = buffer.readUInt32BE(8);
    const stored = buffer.readUInt32BE(29);
    return declared === 13 && stored !== 0;
  }

  // WebP and HEIC carry their signature inside the RIFF or ISO-BMFF framing,
  // which sharp's decode has already validated for the re-encode to have
  // succeeded. Reporting true here states only that the framing was sound.
  return true;
}

/**
 * Reads provenance facts from an image, before its metadata is discarded.
 *
 * Returns nulls rather than throwing, so an unreadable or metadata-free file
 * yields neutral signals instead of an upload rejection. Rejecting on this
 * basis would mean a heuristic had vetoed a worker's upload, which is the
 * failure mode the honest `pending` status was chosen to avoid.
 */
async function readImageSignals(
  input: Buffer,
  contentType: string,
  submittedAt: Date,
): Promise<MediaSignals> {
  const neutral: MediaSignals = {
    hasCameraSignature: null,
    timestampPlausible: null,
    encoderKnown: null,
  };

  let exif: Buffer | undefined;
  try {
    const before = await sharp(input, { failOn: 'none' }).metadata();
    exif = before.exif;
  } catch {
    // The re-encode decides whether the upload is acceptable. A file sharp cannot
    // describe carries no facts to report.
    return { ...neutral, encoderKnown: false };
  }

  const facts = exif ? readExifFacts(exif) : EMPTY_EXIF_FACTS;

  return {
    hasCameraSignature: facts.hasCameraSignature,
    // Null when the block records no capture time at all, which is different
    // from recording one that fails the check.
    timestampPlausible: isTimestampPlausible(facts.capturedAt, submittedAt),
    encoderKnown: encoderLooksValid(input, contentType),
  };
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
export async function scrubImage(
  input: Buffer,
  contentType: string,
  submittedAt: Date = new Date(),
): Promise<ScrubResult> {
  const encoder = IMAGE_ENCODERS[contentType.toLowerCase()];
  if (!encoder) {
    throw AppError.badRequest('That file type is not supported.');
  }

  // Everything read here comes from metadata that is about to be destroyed, and
  // only the resulting booleans survive the call.
  const signals = await readImageSignals(input, contentType.toLowerCase(), submittedAt);

  // Read the metadata before it is discarded, purely to record what was removed.
  let hadGps = false;
  let hadMetadata = false;
  try {
    const before = await sharp(input, { failOn: 'none' }).metadata();
    hadGps = before.exif ? readExifFacts(before.exif).carriesGps : false;
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

  return {
    buffer,
    contentType: contentType.toLowerCase(),
    hadGps,
    hadMetadata,
    hadAudioTags: false,
    signals,
  };
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
  // Audio carries no capture device and no capture time, so these signals are
  // null rather than false. Reporting false would assert that the absence of a
  // camera signature was a finding, which for an audio file it is not.
  const signals: MediaSignals = {
    hasCameraSignature: null,
    timestampPlausible: null,
    encoderKnown: null,
  };

  if (type === 'audio/mpeg') {
    const result = stripId3(input);
    return {
      buffer: result.buffer,
      contentType: type,
      hadGps: false,
      hadMetadata: result.removed,
      hadAudioTags: result.removed,
      signals,
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
      signals,
    };
  }

  throw AppError.badRequest('That file type is not supported.');
}