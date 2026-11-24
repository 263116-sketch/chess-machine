import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import JSZip from 'jszip';

const ROOT = process.cwd();
const EXT_DIR = path.join(ROOT, 'extension');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PUBLIC_EXT_DIR = path.join(PUBLIC_DIR, 'extension');
const PUBLIC_ENGINE_DIR = path.join(PUBLIC_DIR, 'engine');
const STOCKFISH_BIN = path.join(ROOT, 'node_modules', 'stockfish', 'bin');

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0; // filter type 0
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

// Draw a crisp 2x2 chess-board rounded badge with a white knight silhouette
function generateChessIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const radius = size * 0.2;

  // Knight polygon in normalized [0..1] coordinates
  const knightPoly = [
    [0.28, 0.80],
    [0.72, 0.80],
    [0.72, 0.72],
    [0.64, 0.72],
    [0.66, 0.56],
    [0.64, 0.36],
    [0.56, 0.24],
    [0.48, 0.18],
    [0.44, 0.24],
    [0.36, 0.22],
    [0.24, 0.36],
    [0.28, 0.45],
    [0.42, 0.42],
    [0.48, 0.46],
    [0.38, 0.62],
    [0.36, 0.72],
    [0.28, 0.72]
  ];

  function pointInPoly(px, py, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1];
      const xj = poly[j][0], yj = poly[j][1];
      const intersect =
        yi > py !== yj > py &&
        px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-9) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const cx = x + 0.5;
      const cy = y + 0.5;

      // Rounded rect SDF
      const dx = Math.max(0, Math.abs(cx - size / 2) - (size / 2 - radius));
      const dy = Math.max(0, Math.abs(cy - size / 2) - (size / 2 - radius));
      const dist = Math.hypot(dx, dy) - radius;

      if (dist > 0.75) {
        buf[idx] = 0;
        buf[idx + 1] = 0;
        buf[idx + 2] = 0;
        buf[idx + 3] = 0;
        continue;
      }

      const alpha = dist > -0.75 ? Math.round((0.75 - dist) / 1.5 * 255) : 255;
      const nx = cx / size;
      const ny = cy / size;

      // 2x2 subtle chess quadrant background (deep slate #0F172A and emerald #15803D)
      const isLightQuad = (nx < 0.5 && ny < 0.5) || (nx >= 0.5 && ny >= 0.5);
      let r = isLightQuad ? 21 : 15;
      let g = isLightQuad ? 128 : 23;
      let b = isLightQuad ? 61 : 42;

      // Draw crisp white knight silhouette
      if (pointInPoly(nx, ny, knightPoly)) {
        r = 248;
        g = 250;
        b = 252;
      }

      buf[idx] = r;
      buf[idx + 1] = g;
      buf[idx + 2] = b;
      buf[idx + 3] = alpha;
    }
  }
  return encodePng(size, size, buf);
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

async function addDirToZip(zip, dir, baseDir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      await addDirToZip(zip, fullPath, baseDir);
    } else {
      zip.file(relPath, fs.readFileSync(fullPath));
    }
  }
}

async function main() {
  // 1. Generate PNG icons
  const iconsDir = path.join(EXT_DIR, 'icons');
  fs.mkdirSync(iconsDir, { recursive: true });
  for (const size of [16, 48, 128]) {
    fs.writeFileSync(path.join(iconsDir, `icon${size}.png`), generateChessIcon(size));
  }

  // 2. Copy Stockfish 19 lite-single JS & WASM to extension/engine and public/engine
  const extEngineDir = path.join(EXT_DIR, 'engine');
  fs.mkdirSync(extEngineDir, { recursive: true });
  fs.mkdirSync(PUBLIC_ENGINE_DIR, { recursive: true });

  for (const file of ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm']) {
    const src = path.join(STOCKFISH_BIN, file);
    fs.copyFileSync(src, path.join(extEngineDir, file));
    fs.copyFileSync(src, path.join(PUBLIC_ENGINE_DIR, file));
  }

  // 3. Mirror extension files into public/extension for live inspection & custom JSZip export
  if (fs.existsSync(PUBLIC_EXT_DIR)) {
    fs.rmSync(PUBLIC_EXT_DIR, { recursive: true, force: true });
  }
  copyDirRecursive(EXT_DIR, PUBLIC_EXT_DIR);

  // 4. Build Chrome Web Store ready ZIP
  const zip = new JSZip();
  await addDirToZip(zip, EXT_DIR, EXT_DIR);
  const zipBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 }
  });

  const zipOutPath = path.join(PUBLIC_DIR, 'chess-com-stockfish-advisor-v1.0.0.zip');
  fs.writeFileSync(zipOutPath, zipBuffer);

  console.log(`Built extension ZIP: ${zipOutPath} (${(zipBuffer.length / 1024).toFixed(1)} KB)`);
  console.log('ZIP entries:', Object.keys(zip.files).sort().join(', '));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
