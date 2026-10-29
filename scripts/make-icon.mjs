// Generates media/icon.png (256x256): hub-and-spoke motif on a rounded indigo tile.
// No dependencies: shapes are rasterised with 4x4 supersampling and written as a PNG with zlib.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const N = 256;
const SS = 4;
const BG = [30, 27, 75];
const BG2 = [67, 56, 202];
const HUB = [251, 146, 60];
const SPOKE = [226, 232, 240];
const LINE = [165, 180, 252];

const hub = { x: 104, y: 128, r: 34 };
const spokes = [
  { x: 196, y: 64, r: 22 },
  { x: 204, y: 140, r: 22 },
  { x: 178, y: 208, r: 22 }
];

const roundedRect = (x, y, r) => {
  const cx = Math.min(Math.max(x, r), N - r);
  const cy = Math.min(Math.max(y, r), N - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const inCircle = (x, y, c, r = c.r) => (x - c.x) ** 2 + (y - c.y) ** 2 <= r * r;
function nearSegment(x, y, a, b, w) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
  return (x - a.x - t * dx) ** 2 + (y - a.y - t * dy) ** 2 <= w * w;
}

function sample(x, y) {
  if (!roundedRect(x, y, 48)) return null;
  const g = (x + y) / (2 * N);
  let c = BG.map((v, i) => Math.round(v + (BG2[i] - v) * g));
  for (const s of spokes) if (nearSegment(x, y, hub, s, 6)) c = LINE;
  for (const s of spokes) {
    if (inCircle(x, y, s)) c = SPOKE;
    if (inCircle(x, y, s, s.r - 9)) c = BG;
  }
  if (inCircle(x, y, hub)) c = HUB;
  if (inCircle(x, y, hub, 14)) c = [255, 255, 255];
  return c;
}

const raw = Buffer.alloc((N * 4 + 1) * N);
for (let y = 0; y < N; y++) {
  raw[y * (N * 4 + 1)] = 0;
  for (let x = 0; x < N; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const c = sample(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
        if (c) {
          r += c[0];
          g += c[1];
          b += c[2];
          a++;
        }
      }
    }
    const o = y * (N * 4 + 1) + 1 + x * 4;
    raw[o] = a ? Math.round(r / a) : 0;
    raw[o + 1] = a ? Math.round(g / a) : 0;
    raw[o + 2] = a ? Math.round(b / a) : 0;
    raw[o + 3] = Math.round((a / (SS * SS)) * 255);
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0);
ihdr.writeUInt32BE(N, 4);
ihdr[8] = 8;
ihdr[9] = 6;
writeFileSync(
  'media/icon.png',
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
);
console.log('media/icon.png written');
