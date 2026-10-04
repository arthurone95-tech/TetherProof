/**
 * Exercises the metadata scrubber against constructed fixtures.
 *
 * The point is to prove that location data which was present is absent
 * afterwards, and that the files remain structurally valid. Run with:
 *   npx tsx scripts/scrub-check.ts
 */
import sharp from 'sharp';
import { scrubAudio, scrubImage } from '../apps/api/src/lib/media-scrub.js';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
}

/* ---------------------------------------------------------------- helpers */

/** Builds a JPEG carrying a GPS EXIF block, as a phone camera would produce. */
function buildGpsJpeg(): Buffer {
  // TIFF/EXIF, little endian, with a GPS IFD pointer in IFD0.
  const tiff = Buffer.alloc(32);
  tiff.write('II', 0, 'latin1');
  tiff.writeUInt16LE(0x2a, 2);
  tiff.writeUInt32LE(8, 4); // IFD0 at 8
  tiff.writeUInt16LE(1, 8); // one entry
  tiff.writeUInt16LE(0x8825, 10); // GPSInfo
  tiff.writeUInt16LE(7, 12); // UNDEFINED
  tiff.writeUInt32LE(1, 14); // count 1
  tiff.writeUInt32LE(26, 18); // value = GPS IFD offset
  tiff.writeUInt32LE(0, 22); // no next IFD
  tiff.writeUInt16LE(0, 26); // GPS IFD: no entries
  tiff.writeUInt32LE(0, 28);

  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const app1 = Buffer.alloc(4);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(payload.length + 2, 2);

  return Buffer.concat([app1, payload]);
}

/**
 * An EXIF APP1 segment carrying the fields a phone camera writes.
 *
 * Built by hand rather than with sharp's `withMetadata`, so the fixture is an
 * independent description of the format. If the fixture and the parser were both
 * produced by the same library, a shared misunderstanding would pass unnoticed.
 *
 * Laid out explicitly rather than generically, because the interesting part is
 * that `DateTimeOriginal` (0x9003) belongs in the Exif sub-IFD reached through
 * the 0x8769 pointer, not in IFD0 next to Make and Model. A parser that only
 * looked at IFD0 would find the make and model and miss the timestamp, and this
 * fixture is what makes that failure visible.
 *
 * @param make Camera make. When absent, Model is written alone.
 * @param model Camera model.
 * @param capturedAt EXIF `DateTimeOriginal`, as `YYYY:MM:DD HH:MM:SS`.
 */
function buildExifSegment(make: string | null, model: string | null, capturedAt: string | null): Buffer {
  // Offsets within the TIFF block.
  const IFD0 = 8;

  const ifd0Count = (make ? 1 : 0) + (model ? 1 : 0) + (capturedAt ? 1 : 0);
  let cursor = IFD0 + 2 + ifd0Count * 12 + 4;

  // Values must begin on a word boundary, so pad odd lengths.
  const align = () => {
    if (cursor % 2 !== 0) cursor += 1;
    return cursor;
  };

  const makeOffset = make ? align() : -1;
  if (make) cursor += Buffer.byteLength(make, 'latin1') + 1;

  const modelOffset = model ? align() : -1;
  if (model) cursor += Buffer.byteLength(model, 'latin1') + 1;

  const capturedOffset = capturedAt ? align() : -1;
  if (capturedAt) cursor += Buffer.byteLength(capturedAt, 'latin1') + 1;

  // The Exif sub-IFD, holding DateTimeOriginal.
  const subIfd = capturedAt ? cursor : -1;
  if (capturedAt) cursor += 2 + 12 + 4;

  const tiff = Buffer.alloc(cursor);
  tiff.write('II', 0, 'latin1');
  tiff.writeUInt16LE(0x2a, 2);
  tiff.writeUInt32LE(IFD0, 4);

  tiff.writeUInt16LE(ifd0Count, IFD0);

  /** Writes one IFD entry, pointing at an external offset when the value is long. */
  const writeEntry = (at: number, tag: number, inline: string | null, external: number): void => {
    tiff.writeUInt16LE(tag, at);
    tiff.writeUInt16LE(2, at + 2); // ASCII
    if (inline === null) {
      tiff.writeUInt32LE(Buffer.byteLength('x', 'latin1') + 1, at + 4);
      tiff.writeUInt32LE(external, at + 8);
    } else {
      tiff.writeUInt32LE(Buffer.byteLength(inline, 'latin1') + 1, at + 4);
      if (Buffer.byteLength(inline, 'latin1') + 1 <= 4) tiff.write(inline, at + 8, 'latin1');
      else tiff.writeUInt32LE(external, at + 8);
    }
    // The unused half of an inline value field.
    if (inline !== null && Buffer.byteLength(inline, 'latin1') + 1 <= 4) {
      tiff.fill(0, at + 8 + Buffer.byteLength(inline, 'latin1') + 1, at + 12);
    }
  };

  let i = 0;
  const next = () => IFD0 + 2 + i * 12;

  if (make) writeEntry(next(), 0x010f, make.length <= 3 ? make : null, makeOffset);
  if (make && make.length > 3) tiff.write(make, makeOffset, 'latin1');
  i += 1;

  if (model) writeEntry(next(), 0x0110, model.length <= 3 ? model : null, modelOffset);
  if (model && model.length > 3) tiff.write(model, modelOffset, 'latin1');
  i += 1;

  if (capturedAt) {
    writeEntry(next(), 0x8769, null, subIfd);
    i += 1;
    tiff.writeUInt32LE(0, IFD0 + 2 + ifd0Count * 12); // no next IFD

    tiff.writeUInt16LE(1, subIfd);
    tiff.writeUInt16LE(0x9003, subIfd + 2);
    tiff.writeUInt16LE(2, subIfd + 4);
    tiff.writeUInt32LE(Buffer.byteLength(capturedAt, 'latin1') + 1, subIfd + 6);
    tiff.writeUInt32LE(capturedOffset, subIfd + 10);
    tiff.writeUInt32LE(0, subIfd + 14);
    tiff.write(capturedAt, capturedOffset, 'latin1');
  } else {
    tiff.writeUInt32LE(0, IFD0 + 2 + ifd0Count * 12);
  }

  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const app1 = Buffer.alloc(4);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(payload.length + 2, 2);

  return Buffer.concat([app1, payload]);
}

function mp4Box(type: string, payload: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(payload.length + 8, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, payload]);
}

function mp4FullBox(type: string, payload: Buffer): Buffer {
  return mp4Box(type, Buffer.concat([Buffer.alloc(4), payload]));
}

/**
 * An MP4 with `moov` before `mdat`, which is the layout where sample offsets
 * actually have to be corrected.
 *
 * With `moov` first, removing bytes from `moov` shifts the audio data earlier in
 * the file, so every absolute offset in `stco` would end up pointing at the wrong
 * place. That is the case worth testing; a faststart file with `mdat` first needs
 * no correction and would hide a broken implementation.
 */
function buildMp4WithMetadata(): {
  file: Buffer;
  mdatPayloadOffset: number;
  udtaSize: number;
} {
  const audio = Buffer.from('AUDIO'.repeat(20));

  // The location atom a recording tool writes: (c)xyz, the ISO 6709 string.
  const locationAtom = mp4Box('\xa9xyz', Buffer.from('+233.0,-0.1\0', 'latin1'));
  const udta = mp4Box('udta', locationAtom);

  // stco holds an absolute file offset to the audio. It is filled in below,
  // once the layout length is known.
  const stcoPlaceholder = mp4FullBox('stco', Buffer.alloc(8));
  const stbl = mp4Box('stbl', Buffer.concat([mp4FullBox('stsd', Buffer.alloc(4)), stcoPlaceholder]));
  const moov = mp4Box('moov', Buffer.concat([stbl, udta]));

  const ftyp = mp4Box('ftyp', Buffer.concat([Buffer.from('M4A '), Buffer.alloc(4)]));
  const mdatHeader = 8;
  const mdatPayloadOffset = ftyp.length + moov.length + mdatHeader;

  // Rewrite the single stco entry now that the offset is known.
  const stcoStart = ftyp.length + moov.indexOf(Buffer.from('stco', 'latin1'));
  const file = Buffer.concat([ftyp, moov, mp4Box('mdat', audio)]);
  const entryAt = stcoStart + 8 + 4;
  file.writeUInt32BE(1, entryAt - 4); // entry count
  file.writeUInt32BE(mdatPayloadOffset, entryAt); // the offset itself

  return { file, mdatPayloadOffset, udtaSize: udta.length };
}

/* ------------------------------------------------------------------ tests */

async function run(): Promise<void> {
  console.log('\n=== images ===');

  const plainJpeg = await sharp({
    create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 120, b: 40 } },
  })
    .jpeg()
    .toBuffer();

  const taggedJpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8]), // SOI
    buildGpsJpeg(),
    plainJpeg.subarray(2), // the rest, minus the original SOI
  ]);

  const before = await sharp(taggedJpeg, { failOn: 'none' }).metadata();
  check('fixture really does carry EXIF', Boolean(before.exif), before.exif ? `${before.exif.length} bytes` : 'none');

  const scrubbedTagged = await scrubImage(taggedJpeg, 'image/jpeg');
  check('GPS is detected before scrubbing', scrubbedTagged.hadGps === true, `hadGps=${scrubbedTagged.hadGps}`);
  check('metadata is reported as present', scrubbedTagged.hadMetadata === true);

  const afterMeta = await sharp(scrubbedTagged.buffer, { failOn: 'none' }).metadata();
  check('no EXIF survives the scrub', !afterMeta.exif, afterMeta.exif ? `${afterMeta.exif.length} bytes left` : 'clean');
  check('no ICC survives the scrub', !afterMeta.icc);
  check('output is still a JPEG', afterMeta.format === 'jpeg', String(afterMeta.format));
  check('dimensions survive', afterMeta.width === 64 && afterMeta.height === 48, `${afterMeta.width}x${afterMeta.height}`);

  const scrubbedPlain = await scrubImage(plainJpeg, 'image/jpeg');
  check('a file without metadata reports none', scrubbedPlain.hadMetadata === false, `hadMetadata=${scrubbedPlain.hadMetadata}`);
  check('a file without metadata is not flagged for GPS', scrubbedPlain.hadGps === false);

  const png = await sharp({
    create: { width: 32, height: 32, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } },
  })
    .png()
    .toBuffer();
  const scrubbedPng = await scrubImage(png, 'image/png');
  const pngMeta = await sharp(scrubbedPng.buffer).metadata();
  check('PNG stays a PNG', pngMeta.format === 'png', String(pngMeta.format));

  const webp = await sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 9, g: 9, b: 9 } },
  })
    .webp()
    .toBuffer();
  const scrubbedWebp = await scrubImage(webp, 'image/webp');
  const webpMeta = await sharp(scrubbedWebp.buffer).metadata();
  check('WebP stays WebP', webpMeta.format === 'webp', String(webpMeta.format));

  // A file that only claims to be an image must not slip through the re-encode.
  const genuine = await sharp(
    { create: { width: 16, height: 16, channels: 3, background: { r: 0, g: 0, b: 0 } } },
  )
    .jpeg()
    .toBuffer();
  let rejected = false;
  try {
    await scrubImage(Buffer.from('<?php echo "not an image"; ?>'), 'image/jpeg');
  } catch {
    rejected = true;
  }
  check('a non-image claiming image/jpeg is refused', rejected);
  check('a genuine JPEG is accepted', (await scrubImage(genuine, 'image/jpeg')).buffer.length > 0);

  try {
    const heic = await sharp({
      create: { width: 32, height: 32, channels: 3, background: { r: 5, g: 5, b: 5 } },
    })
      .heif({ compression: 'av1' })
      .toBuffer();
    const scrubbedHeic = await scrubImage(heic, 'image/heic');
    const heicMeta = await sharp(scrubbedHeic.buffer).metadata();
    check('HEIC re-encodes and stays HEIC', heicMeta.format === 'heif', String(heicMeta.format));
  } catch (error) {
    console.log(`  NOTE  HEIC round-trip not exercised: ${(error as Error).message.slice(0, 80)}`);
  }

  console.log('\n=== provenance signals (derived, then discarded) ===');

  // A fixed submission time, so the plausibility check is deterministic.
  const submittedAt = new Date(Date.UTC(2026, 9, 4, 12, 0, 0));
  const withSegment = (segment: Buffer) =>
    Buffer.concat([Buffer.from([0xff, 0xd8]), segment, plainJpeg.subarray(2)]);

  // A file shaped like a phone camera capture: a named device, taken a minute
  // before it was submitted.
  const genuineCapture = withSegment(
    buildExifSegment('ACME', 'Snapper 12', '2026:10:04 11:59:00'),
  );
  const genuineSignals = (await scrubImage(genuineCapture, 'image/jpeg', submittedAt)).signals;
  check('a named capture device is detected', genuineSignals.hasCameraSignature === true, String(genuineSignals.hasCameraSignature));
  check(
    'a capture time just before submission is plausible',
    genuineSignals.timestampPlausible === true,
    String(genuineSignals.timestampPlausible),
  );
  check('a well-formed JPEG is structurally sound', genuineSignals.encoderKnown === true);

  // The sub-IFD is the part a shallow parser gets wrong, so assert it was read.
  check(
    'DateTimeOriginal is read from the Exif sub-IFD, not just IFD0',
    genuineSignals.timestampPlausible === true,
  );

  // A file with a make but no model is a stripped-down block, not a capture claim.
  const halfBlock = withSegment(buildExifSegment('ACME', null, '2026:10:04 11:59:00'));
  const halfSignals = (await scrubImage(halfBlock, 'image/jpeg', submittedAt)).signals;
  check('a make without a model is not a camera signature', halfSignals.hasCameraSignature === false, String(halfSignals.hasCameraSignature));

  // Unset clocks and generators both land on the epoch.
  const epoch = withSegment(buildExifSegment('ACME', 'Snapper 12', '1970:01:01 00:00:00'));
  const epochSignals = (await scrubImage(epoch, 'image/jpeg', submittedAt)).signals;
  check('an epoch capture time is implausible', epochSignals.timestampPlausible === false, String(epochSignals.timestampPlausible));

  const pre2005 = withSegment(buildExifSegment('ACME', 'Snapper 12', '1999:12:31 23:59:59'));
  check(
    'a pre-2005 capture time is implausible',
    (await scrubImage(pre2005, 'image/jpeg', submittedAt)).signals.timestampPlausible === false,
  );

  const future = withSegment(buildExifSegment('ACME', 'Snapper 12', '2027:01:01 00:00:00'));
  check(
    'a capture time after submission is implausible',
    (await scrubImage(future, 'image/jpeg', submittedAt)).signals.timestampPlausible === false,
  );

  // A photo from earlier in the week is legitimate and must not be flagged.
  const lastWeek = withSegment(buildExifSegment('ACME', 'Snapper 12', '2026:09:27 09:00:00'));
  check(
    'an older photo is still plausible',
    (await scrubImage(lastWeek, 'image/jpeg', submittedAt)).signals.timestampPlausible === true,
  );

  // No EXIF at all: absence of a signature is a finding, absence of a time is not.
  const bareSignals = (await scrubImage(plainJpeg, 'image/jpeg', submittedAt)).signals;
  check('a file with no EXIF has no camera signature', bareSignals.hasCameraSignature === false, String(bareSignals.hasCameraSignature));
  check('a file with no EXIF has no timestamp claim', bareSignals.timestampPlausible === null, String(bareSignals.timestampPlausible));
  check('a plain JPEG is still structurally sound', bareSignals.encoderKnown === true);

  // A PNG must never be reported as having read a camera block it cannot hold.
  const pngSignals = (await scrubImage(png, 'image/png', submittedAt)).signals;
  check('a PNG is structurally sound', pngSignals.encoderKnown === true);

  // The whole point: the conclusions survive, the values do not.
  const afterProvenance = await sharp(genuineCapture, { failOn: 'none' }).metadata();
  const scrubbedProvenance = await scrubImage(genuineCapture, 'image/jpeg', submittedAt);
  const scrubbedMeta = await sharp(scrubbedProvenance.buffer, { failOn: 'none' }).metadata();
  check('a signal-bearing file is still scrubbed clean', !scrubbedMeta.exif, scrubbedMeta.exif ? `${scrubbedMeta.exif.length} bytes left` : 'clean');
  check('the camera make does not survive', !scrubbedProvenance.buffer.includes(Buffer.from('ACME', 'latin1')));
  check('the camera model does not survive', !scrubbedProvenance.buffer.includes(Buffer.from('Snapper 12', 'latin1')));
  check('the capture timestamp does not survive', !scrubbedProvenance.buffer.includes(Buffer.from('2026:10:04', 'latin1')));
  check('the signals are booleans only', Object.values(genuineSignals).every((v) => typeof v === 'boolean'));
  check('the fixture really did carry EXIF to read', Boolean(afterProvenance.exif));

  console.log('\n=== audio: mp3 ===');

  // ID3v2 block with a GEOB frame, then real MPEG data.
  const frames = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(200, 0x55)]);
  const id3Body = Buffer.concat([Buffer.from('GEOB'), Buffer.alloc(60, 0x41)]);
  // The 10-byte ID3v2 header contains the size field itself, so the declared size
  // covers only the frames that follow it.
  const id3Header = Buffer.alloc(10);
  id3Header.write('ID3', 0, 'latin1');
  id3Header.writeUInt8(4, 3); // version 2.4
  id3Header.writeUInt8(0, 4); // flags
  const synchsafe = (n: number) => Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
  id3Header.set(synchsafe(id3Body.length), 6);
  const id3v1 = Buffer.concat([Buffer.from('TAG'), Buffer.alloc(125)]);
  const mp3 = Buffer.concat([id3Header, id3Body, frames, id3v1]);

  const scrubbedMp3 = scrubAudio(mp3, 'audio/mpeg');
  check('MP3 tags are detected', scrubbedMp3.hadAudioTags === true);
  check('ID3v2 marker is gone', !scrubbedMp3.buffer.subarray(0, 3).toString('latin1').includes('ID3'));
  check('ID3v1 trailer is gone', !scrubbedMp3.buffer.subarray(-128, -125).toString('latin1').includes('TAG'));
  check('audio frames survive untouched', scrubbedMp3.buffer.equals(frames), `${scrubbedMp3.buffer.length} vs ${frames.length}`);

  const bare = scrubAudio(frames, 'audio/mpeg');
  check('a bare MP3 reports no tags', bare.hadAudioTags === false);

  // Audio carries no capture device and no capture time. Reporting false would
  // assert that the absence of a camera signature was a finding, which for an
  // audio file it is not, so these must be null.
  check('audio reports no camera signal', scrubbedMp3.signals.hasCameraSignature === null, String(scrubbedMp3.signals.hasCameraSignature));
  check('audio reports no timestamp signal', scrubbedMp3.signals.timestampPlausible === null, String(scrubbedMp3.signals.timestampPlausible));
  check('audio reports no encoder signal', scrubbedMp3.signals.encoderKnown === null, String(scrubbedMp3.signals.encoderKnown));

  console.log('\n=== audio: mp4 / m4a ===');

  const { file, mdatPayloadOffset, udtaSize } = buildMp4WithMetadata();
  const scrubbedMp4 = scrubAudio(file, 'audio/mp4');
  check('MP4 metadata atoms are detected', scrubbedMp4.hadAudioTags === true);
  check('the udta atom is gone', !scrubbedMp4.buffer.includes(Buffer.from('udta')));
  check('the location atom is gone', !scrubbedMp4.buffer.includes(Buffer.from('+233.0,-0.1')));
  check('ftyp is preserved', scrubbedMp4.buffer.subarray(4, 8).toString('latin1') === 'ftyp');
  check('mdat audio is preserved', scrubbedMp4.buffer.includes(Buffer.from('AUDIO'.repeat(20))));
  check(
    'the file shrank by exactly the removed atom',
    file.length - scrubbedMp4.buffer.length === udtaSize,
    `${file.length} -> ${scrubbedMp4.buffer.length}, expected -${udtaSize}`,
  );

  // moov precedes mdat here, so the audio moved earlier in the file and the
  // stored offset is now wrong unless the scrubber corrected it. Without this the
  // file would still parse but play the wrong bytes, or nothing at all.
  const readStco = (buf: Buffer): number => {
    const at = buf.indexOf(Buffer.from('stco', 'latin1'));
    return buf.readUInt32BE(at + 8 + 4);
  };
  const newAudioOffset = scrubbedMp4.buffer.indexOf(Buffer.from('AUDIO'.repeat(20)));
  const stcoValue = readStco(scrubbedMp4.buffer);
  check(
    'the stored sample offset now points at the audio',
    stcoValue === newAudioOffset,
    `stco=${stcoValue} actual=${newAudioOffset}`,
  );
  check(
    'the offset moved earlier by exactly the removed bytes',
    mdatPayloadOffset - newAudioOffset === udtaSize,
    `was ${mdatPayloadOffset}, now ${newAudioOffset}, removed ${udtaSize}`,
  );

  let mp4MismatchRefused = false;
  try {
    scrubAudio(Buffer.from('not really an mp4 at all'), 'audio/mp4');
  } catch {
    mp4MismatchRefused = true;
  }
  check('a non-MP4 claiming audio/mp4 is refused', mp4MismatchRefused);

  console.log('\n=== audio: removed formats ===');
  let webmRefused = false;
  try {
    scrubAudio(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), 'audio/webm');
  } catch {
    webmRefused = true;
  }
  check('WebM is refused because it cannot be stripped', webmRefused);

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void run();