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