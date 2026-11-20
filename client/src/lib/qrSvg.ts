/**
 * Self-contained, zero-dependency ISO/IEC 18004 QR Code Generator (Byte Mode, ECC Level L, Versions 1–10).
 * Produces a boolean[][] module matrix for razor-sharp offline SVG rendering on 4K TVs.
 */

// Total codewords and ECC codewords per block for ECC Level L (Versions 1..10)
const VERSION_ECC_L: Array<{ totalCodewords: number; ecCodewordsPerBlock: number; numBlocks: number }> = [
  { totalCodewords: 0, ecCodewordsPerBlock: 0, numBlocks: 0 }, // unused index 0
  { totalCodewords: 26, ecCodewordsPerBlock: 7, numBlocks: 1 }, // v1 (17 bytes max)
  { totalCodewords: 44, ecCodewordsPerBlock: 10, numBlocks: 1 }, // v2 (32 bytes)
  { totalCodewords: 70, ecCodewordsPerBlock: 15, numBlocks: 1 }, // v3 (53 bytes)
  { totalCodewords: 100, ecCodewordsPerBlock: 20, numBlocks: 1 }, // v4 (78 bytes)
  { totalCodewords: 134, ecCodewordsPerBlock: 26, numBlocks: 1 }, // v5 (106 bytes)
  { totalCodewords: 172, ecCodewordsPerBlock: 18, numBlocks: 2 }, // v6 (134 bytes)
  { totalCodewords: 196, ecCodewordsPerBlock: 20, numBlocks: 2 }, // v7 (154 bytes)
  { totalCodewords: 242, ecCodewordsPerBlock: 24, numBlocks: 2 }, // v8 (192 bytes)
  { totalCodewords: 292, ecCodewordsPerBlock: 30, numBlocks: 2 }, // v9 (230 bytes)
  { totalCodewords: 346, ecCodewordsPerBlock: 18, numBlocks: 4 }, // v10 (271 bytes)
];

const ALIGNMENT_POSITIONS: number[][] = [
  [],
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

// GF(256) arithmetic for Reed-Solomon (primitive polynomial 0x11D)
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function buildReedSolomonDivisor(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const root = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], root);
    }
    poly = next;
  }
  return poly.slice(1); // omit leading 1
}

function computeReedSolomonRemainder(data: Uint8Array, degree: number): Uint8Array {
  const divisor = buildReedSolomonDivisor(degree);
  const rem = new Uint8Array(degree);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ rem[0];
    rem.copyWithin(0, 1);
    rem[degree - 1] = 0;
    for (let j = 0; j < degree; j++) {
      rem[j] ^= gfMul(divisor[j], factor);
    }
  }
  return rem;
}

export function encodeQrMatrix(rawText: string): boolean[][] {
  const text = (rawText || "https://localhost").slice(0, 260);
  const utf8 = new TextEncoder().encode(text);

  // Pick smallest version 1..10 that fits Byte mode
  let version = 1;
  while (version <= 10) {
    const spec = VERSION_ECC_L[version];
    const dataCodewords = spec.totalCodewords - spec.ecCodewordsPerBlock * spec.numBlocks;
    const headerBits = 4 + (version <= 9 ? 8 : 16);
    if (utf8.length * 8 + headerBits <= dataCodewords * 8) break;
    version++;
  }
  if (version > 10) version = 10;

  const spec = VERSION_ECC_L[version];
  const dataCapacityBytes = spec.totalCodewords - spec.ecCodewordsPerBlock * spec.numBlocks;
  const payload = utf8.slice(0, dataCapacityBytes - 3);

  // Build bit stream: Mode 0100 (Byte), length, bytes, terminator, pad bytes
  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };

  pushBits(0b0100, 4);
  pushBits(payload.length, version <= 9 ? 8 : 16);
  for (let i = 0; i < payload.length; i++) pushBits(payload[i], 8);

  const maxDataBits = dataCapacityBytes * 8;
  pushBits(0, Math.min(4, maxDataBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);

  let padToggle = 0;
  while (bits.length < maxDataBits) {
    pushBits(padToggle % 2 === 0 ? 0xec : 0x11, 8);
    padToggle++;
  }

  const dataBytes = new Uint8Array(dataCapacityBytes);
  for (let i = 0; i < dataCapacityBytes; i++) {
    let v = 0;
    for (let b = 0; b < 8; b++) v = (v << 1) | bits[i * 8 + b];
    dataBytes[i] = v;
  }

  // Split into blocks & interleave (for versions 1..10 ECC-L, blocks have equal sizes except v10: 2x68 + 2x69)
  const numBlocks = spec.numBlocks;
  const shortBlockLen = Math.floor(dataCapacityBytes / numBlocks);
  const numShortBlocks = numBlocks - (dataCapacityBytes % numBlocks);

  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;
  for (let b = 0; b < numBlocks; b++) {
    const len = b < numShortBlocks ? shortBlockLen : shortBlockLen + 1;
    const block = dataBytes.slice(offset, offset + len);
    offset += len;
    dataBlocks.push(block);
    ecBlocks.push(computeReedSolomonRemainder(block, spec.ecCodewordsPerBlock));
  }

  const finalCodewords: number[] = [];
  const maxBlockLen = shortBlockLen + (numShortBlocks < numBlocks ? 1 : 0);
  for (let i = 0; i < maxBlockLen; i++) {
    for (let b = 0; b < numBlocks; b++) {
      if (i < dataBlocks[b].length) finalCodewords.push(dataBlocks[b][i]);
    }
  }
  for (let i = 0; i < spec.ecCodewordsPerBlock; i++) {
    for (let b = 0; b < numBlocks; b++) {
      finalCodewords.push(ecBlocks[b][i]);
    }
  }

  // Matrix construction
  const size = version * 4 + 17;
  const modules: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const isFunction: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  const setFunctionModule = (x: number, y: number, dark: boolean) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    modules[y][x] = dark;
    isFunction[y][x] = true;
  };

  const drawFinder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        setFunctionModule(x, y, dist !== 2 && dist !== 4);
      }
    }
  };

  drawFinder(3, 3);
  drawFinder(size - 4, 3);
  drawFinder(3, size - 4);

  // Timing patterns
  for (let i = 0; i < size; i++) {
    if (!isFunction[6][i]) setFunctionModule(i, 6, i % 2 === 0);
    if (!isFunction[i][6]) setFunctionModule(6, i, i % 2 === 0);
  }

  // Alignment patterns
  const alignCoords = ALIGNMENT_POSITIONS[version];
  for (let i = 0; i < alignCoords.length; i++) {
    for (let j = 0; j < alignCoords.length; j++) {
      if (
        (i === 0 && j === 0) ||
        (i === 0 && j === alignCoords.length - 1) ||
        (i === alignCoords.length - 1 && j === 0)
      ) {
        continue;
      }
      const cx = alignCoords[i];
      const cy = alignCoords[j];
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          setFunctionModule(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }

  // Reserve format info & dark module
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      if (!isFunction[8][i]) setFunctionModule(i, 8, false);
      if (!isFunction[i][8]) setFunctionModule(8, i, false);
    }
  }
  for (let i = 0; i < 8; i++) {
    if (!isFunction[8][size - 1 - i]) setFunctionModule(size - 1 - i, 8, false);
    if (!isFunction[size - 1 - i][8]) setFunctionModule(8, size - 1 - i, false);
  }
  setFunctionModule(8, size - 8, true);

  // Version >= 7 version info blocks
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const vBits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((vBits >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunctionModule(a, b, bit);
      setFunctionModule(b, a, bit);
    }
  }

  // Place data bits in zig-zag upward/downward pairs
  let bitIdx = 0;
  const totalBits = finalCodewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunction[y][x] && bitIdx < totalBits) {
          const byte = finalCodewords[bitIdx >>> 3];
          const dark = ((byte >>> (7 - (bitIdx & 7))) & 1) !== 0;
          modules[y][x] = dark;
          bitIdx++;
        }
      }
    }
  }

  // Apply Mask 0 ((x + y) % 2 === 0) and write Format Info bits (ECC Level L = 01, Mask 0 = 000)
  const mask = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!isFunction[y][x] && (x + y) % 2 === 0) {
        modules[y][x] = !modules[y][x];
      }
    }
  }

  const formatData = (0b01 << 3) | mask; // ECC L = 01
  let fRem = formatData;
  for (let i = 0; i < 10; i++) fRem = (fRem << 1) ^ ((fRem >>> 9) * 0x537);
  const formatBits = ((formatData << 10) | fRem) ^ 0x5412;

  const getFBit = (i: number) => ((formatBits >>> i) & 1) !== 0;
  for (let i = 0; i <= 5; i++) setFunctionModule(8, i, getFBit(i));
  setFunctionModule(8, 7, getFBit(6));
  setFunctionModule(8, 8, getFBit(7));
  setFunctionModule(7, 8, getFBit(8));
  for (let i = 9; i < 15; i++) setFunctionModule(14 - i, 8, getFBit(i));

  for (let i = 0; i < 8; i++) setFunctionModule(size - 1 - i, 8, getFBit(i));
  for (let i = 8; i < 15; i++) setFunctionModule(8, size - 15 + i, getFBit(i));
  setFunctionModule(8, size - 8, true);

  return modules;
}
