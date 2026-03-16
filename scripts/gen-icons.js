/**
 * Dark-Scanner — プレースホルダーアイコン生成スクリプト
 * 외부 패키지 없이 Node.js 내장 zlib만 사용해 PNG를 생성합니다.
 * 디자인: 깊은 인디고 배경 + 스캐너 프레임 코너(보라) + 빨간 수평 스캔 빔
 *
 * 사용법: node scripts/gen-icons.js
 */
import { deflateSync } from 'zlib';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'public');

// ── CRC32 ────────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ── PNG chunk ────────────────────────────────────────────────────────────────
function pngChunk(type, data) {
  const typeB = Buffer.from(type, 'ascii');
  const lenB  = Buffer.alloc(4);  lenB.writeUInt32BE(data.length);
  const crcB  = Buffer.alloc(4);  crcB.writeUInt32BE(crc32(Buffer.concat([typeB, data])));
  return Buffer.concat([lenB, typeB, data, crcB]);
}

// ── 픽셀 배열 → PNG Buffer ───────────────────────────────────────────────────
function encodePNG(pixels, width, height) {
  // pixels: Uint8Array [R,G,B,A, R,G,B,A, ...] row-major
  const rowSize = 1 + width * 4;
  const raw = Buffer.alloc(height * rowSize);
  for (let y = 0; y < height; y++) {
    raw[y * rowSize] = 0; // filter byte: None
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      const dst = y * rowSize + 1 + x * 4;
      raw[dst]   = pixels[src];
      raw[dst+1] = pixels[src+1];
      raw[dst+2] = pixels[src+2];
      raw[dst+3] = pixels[src+3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width,  0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  // bytes 10-12 = 0 (compression, filter, interlace)

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── 픽셀 헬퍼 ────────────────────────────────────────────────────────────────
function setPixel(pixels, w, x, y, r, g, b, a = 255) {
  if (x < 0 || x >= w || y < 0 || y >= w) return;
  const i = (y * w + x) * 4;
  pixels[i] = r; pixels[i+1] = g; pixels[i+2] = b; pixels[i+3] = a;
}

function fillRect(pixels, w, x0, y0, x1, y1, r, g, b, a = 255) {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      setPixel(pixels, w, x, y, r, g, b, a);
}

// ── 아이콘 픽셀 생성 ─────────────────────────────────────────────────────────
// 디자인: 인디고 배경 + 스캐너 코너 프레임 + 빨간 수평 스캔 빔
function generateIconPixels(size) {
  const pixels = new Uint8Array(size * size * 4);

  // 배경: deep indigo #1e1b4b
  fillRect(pixels, size, 0, 0, size-1, size-1, 30, 27, 75);

  const p  = Math.round(size * 0.15);  // 외부 패딩
  const t  = Math.max(1, Math.round(size * 0.08));  // 선 두께
  const cl = Math.round((size - p*2) * 0.35);  // 코너 선 길이

  // 코너 프레임: light indigo #818cf8 (129, 140, 248)
  const [cr, cg, cb] = [129, 140, 248];

  // 상단-좌 코너
  fillRect(pixels, size, p,       p,        p+cl-1, p+t-1,  cr, cg, cb); // 수평
  fillRect(pixels, size, p,       p,        p+t-1,  p+cl-1, cr, cg, cb); // 수직
  // 상단-우 코너
  fillRect(pixels, size, size-p-cl, p,      size-p-1, p+t-1,   cr, cg, cb);
  fillRect(pixels, size, size-p-t,  p,      size-p-1, p+cl-1,  cr, cg, cb);
  // 하단-좌 코너
  fillRect(pixels, size, p,        size-p-t,   p+cl-1,   size-p-1, cr, cg, cb);
  fillRect(pixels, size, p,        size-p-cl,  p+t-1,    size-p-1, cr, cg, cb);
  // 하단-우 코너
  fillRect(pixels, size, size-p-cl, size-p-t,  size-p-1, size-p-1, cr, cg, cb);
  fillRect(pixels, size, size-p-t,  size-p-cl, size-p-1, size-p-1, cr, cg, cb);

  // 수평 스캔 빔: red #ef4444 (239, 68, 68), 반투명
  const beamY  = Math.round(size * 0.50);
  const beamT  = Math.max(1, Math.round(size * 0.06));
  const beamX0 = p + t + 1;
  const beamX1 = size - p - t - 2;
  fillRect(pixels, size, beamX0, beamY - beamT, beamX1, beamY + beamT, 239, 68, 68, 210);

  // 작은 점(dot): 스캔 위치 표시, 빔 중앙에 흰 점
  if (size >= 48) {
    const dotR = Math.max(1, Math.round(size * 0.04));
    const dotX = Math.round(size / 2);
    const dotY = beamY;
    for (let dy = -dotR; dy <= dotR; dy++)
      for (let dx = -dotR; dx <= dotR; dx++)
        if (dx*dx + dy*dy <= dotR*dotR)
          setPixel(pixels, size, dotX+dx, dotY+dy, 255, 255, 255);
  }

  return pixels;
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
for (const size of [16, 48, 128]) {
  const pixels = generateIconPixels(size);
  const png    = encodePNG(pixels, size, size);
  const outPath = join(OUT_DIR, `icon-${size}.png`);
  writeFileSync(outPath, png);
  console.log(`✓ public/icon-${size}.png  (${png.length} bytes)`);
}
console.log('아이콘 생성 완료.');
