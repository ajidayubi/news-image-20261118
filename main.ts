// The World in One Day — 18 November 2026
// A deterministic procedural newspaper front page, 1024x1024.
// Drawn entirely by code: hand-rolled raster canvas + hand-written PNG
// encoder. No network, no randomness, no clock, no external reads.
// Run twice and the output bytes are identical.

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

const W = 1024;
const H = 1024;

// ---- palette (newsprint) ----
const PAPER: RGB = [247, 243, 232];
const PANEL: RGB = [255, 253, 246];
const INK: RGB = [18, 18, 18];
const RED: RGB = [164, 30, 34];
const NAVY: RGB = [29, 78, 137];
const SKY: RGB = [168, 198, 224];
const WATER: RGB = [96, 152, 202];
const GOLD: RGB = [196, 148, 44];
const GREEN: RGB = [46, 110, 64];
const GREY: RGB = [120, 118, 110];
const LIGHTGREY: RGB = [214, 210, 198];
const ORANGE: RGB = [224, 122, 32];
const YELLOW: RGB = [240, 196, 64];
const WHITE: RGB = [255, 255, 255];
const BROWN: RGB = [122, 84, 52];
const DARKNAVY: RGB = [24, 38, 64];

type RGB = [number, number, number];

// ---- pixel buffer ----
const buf = new Uint8Array(W * H * 3);

function setPixel(x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  buf[i] = c[0];
  buf[i + 1] = c[1];
  buf[i + 2] = c[2];
}

function fillRect(x: number, y: number, w: number, h: number, c: RGB): void {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(W, x + w);
  const y1 = Math.min(H, y + h);
  for (let yy = y0; yy < y1; yy++) {
    let i = (yy * W + x0) * 3;
    for (let xx = x0; xx < x1; xx++) {
      buf[i] = c[0];
      buf[i + 1] = c[1];
      buf[i + 2] = c[2];
      i += 3;
    }
  }
}

function rectOutline(x: number, y: number, w: number, h: number, c: RGB, t: number): void {
  fillRect(x, y, w, t, c);
  fillRect(x, y + h - t, w, t, c);
  fillRect(x, y, t, h, c);
  fillRect(x + w - t, y, t, h, c);
}

// Bresenham line, with a thickness helper via small squares.
function drawLine(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    setPixel(x, y, c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

function thickLine(x0: number, y0: number, x1: number, y1: number, c: RGB, t: number): void {
  const half = Math.floor(t / 2);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    fillRect(x - half, y - half, t, t, c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

function fillCircle(cx: number, cy: number, r: number, c: RGB): void {
  for (let dy = -r; dy <= r; dy++) {
    const span = Math.floor(Math.sqrt(r * r - dy * dy));
    fillRect(cx - span, cy + dy, span * 2 + 1, 1, c);
  }
}

function drawCircle(cx: number, cy: number, r: number, c: RGB): void {
  let x = r;
  let y = 0;
  let err = 0;
  while (x >= y) {
    setPixel(cx + x, cy + y, c);
    setPixel(cx + y, cy + x, c);
    setPixel(cx - y, cy + x, c);
    setPixel(cx - x, cy + y, c);
    setPixel(cx - x, cy - y, c);
    setPixel(cx - y, cy - x, c);
    setPixel(cx + y, cy - x, c);
    setPixel(cx + x, cy - y, c);
    y += 1;
    err += 1 + 2 * y;
    if (2 * (err - x) + 1 > 0) {
      x -= 1;
      err += 1 - 2 * x;
    }
  }
}

// ---- CRC32 (hand-computed table, PNG polynomial) ----
const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(): Buffer {
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0; // filter: none
    const src = buf.subarray(y * W * 3, (y + 1) * W * 3);
    raw.set(src, y * (1 + W * 3) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = zlib.deflateSync(raw, { level: 9 });
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- 5x7 bitmap font (designed here, one glyph per character) ----
// Each glyph is 7 rows of 5 cells; '#' is ink, '.' is empty.
const GLYPHS: Record<string, string[]> = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".####", "#....", "#....", "#.###", "#...#", "#...#", ".###."],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "##..#", "#.#.#", "#..##", "#..##", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": [".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", "..#..", "..#..", "..#.."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."],
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
  ".": [".....", ".....", ".....", ".....", ".....", ".##..", ".##.."],
  ",": [".....", ".....", ".....", ".....", ".##..", ".##..", ".#..."],
  "-": [".....", ".....", ".....", ".###.", ".....", ".....", "....."],
  ":": [".....", ".##..", ".##..", ".....", ".##..", ".##..", "....."],
  ";": [".....", ".##..", ".##..", ".....", ".##..", ".##..", ".#..."],
  "'": ["..#..", "..#..", "..#..", ".....", ".....", ".....", "....."],
  "(": ["...##", "..#..", ".#...", ".#...", ".#...", "..#..", "...##"],
  ")": ["##...", "..#..", "...#.", "...#.", "...#.", "..#..", "##..."],
  "/": ["....#", "....#", "...#.", "..#..", ".#...", "#....", "#...."],
  "%": ["##..#", "##.#.", "..#..", ".#...", "#..##", "#..##", "....."],
  "!": ["..#..", "..#..", "..#..", "..#..", "..#..", ".....", "..#.."],
  "?": [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."],
  "+": [".....", "..#..", "..#..", "#####", "..#..", "..#..", "....."],
  "&": [".##..", "#..#.", "#.#..", ".#...", "#.#.#", "#..#.", ".##.#"],
  $: ["..#..", ".####", "#.#..", ".###.", "..#.#", "####.", "..#.."],
  "=": [".....", ".....", "#####", ".....", "#####", ".....", "....."],
  '"': [".#.#.", ".#.#.", ".#.#.", ".....", ".....", ".....", "....."],
};

function drawChar(ch: string, x: number, y: number, scale: number, c: RGB): void {
  const glyph = GLYPHS[ch] ?? GLYPHS["?"];
  for (let row = 0; row < 7; row++) {
    const line = glyph[row];
    for (let col = 0; col < 5; col++) {
      if (line[col] === "#") {
        fillRect(x + col * scale, y + row * scale, scale, scale, c);
      }
    }
  }
}

// All page text is set in capitals, in the manner of a newspaper.
function drawText(x: number, y: number, text: string, scale: number, c: RGB): void {
  const upper = text.toUpperCase();
  let cx = x;
  for (const ch of upper) {
    drawChar(ch, cx, y, scale, c);
    cx += 6 * scale;
  }
}

function textWidth(text: string, scale: number): number {
  const upper = text.toUpperCase();
  if (upper.length === 0) return 0;
  return upper.length * 6 * scale - scale;
}

function wrapText(text: string, scale: number, maxWidth: number): string[] {
  const words = text.toUpperCase().split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const trial = cur === "" ? word : cur + " " + word;
    if (textWidth(trial, scale) <= maxWidth) {
      cur = trial;
    } else {
      if (cur !== "") lines.push(cur);
      cur = word;
    }
  }
  if (cur !== "") lines.push(cur);
  return lines;
}

function drawTextBlock(
  x: number,
  y: number,
  text: string,
  scale: number,
  maxWidth: number,
  lineGap: number,
  c: RGB,
): number {
  const lines = wrapText(text, scale, maxWidth);
  for (let i = 0; i < lines.length; i++) {
    drawText(x, y + i * (7 * scale + lineGap), lines[i], scale, c);
  }
  return y + lines.length * (7 * scale + lineGap);
}

function drawTextCentred(y: number, text: string, scale: number, c: RGB): void {
  const w = textWidth(text, scale);
  drawText(Math.floor((W - w) / 2), y, text, scale, c);
}

// ---- pictograms: small scenes drawn only with canvas primitives ----

// Three leaders at a summit table under three flags.
function drawSummit(x: number, y: number, w: number, h: number): void {
  fillRect(x, y, w, h, SKY);
  fillRect(x, y + h - 18, w, 18, GREEN); // lawn
  const poles = [x + 34, x + Math.floor(w / 2), x + w - 34];
  const flagCols: RGB[] = [RED, NAVY, GOLD];
  for (let i = 0; i < 3; i++) {
    const px = poles[i];
    fillRect(px, y + 8, 3, h - 34, INK); // pole
    fillRect(px + 3, y + 10, 34, 20, flagCols[i]); // flag
    fillRect(px + 3, y + 10, 34, 4, WHITE);
  }
  // table
  fillRect(x + 16, y + h - 52, w - 32, 10, BROWN);
  fillRect(x + 24, y + h - 42, 6, 24, BROWN);
  fillRect(x + w - 30, y + h - 42, 6, 24, BROWN);
  // three heads behind the table
  for (let i = 0; i < 3; i++) {
    fillCircle(poles[i], y + h - 62, 11, [232, 196, 160]);
    fillRect(poles[i] - 12, y + h - 56, 24, 6, INK); // shoulders
  }
  rectOutline(x, y, w, h, INK, 2);
}

// Night strike: a base under an explosion burst.
function drawStrike(x: number, y: number, w: number, h: number): void {
  fillRect(x, y, w, h, DARKNAVY);
  fillCircle(x + Math.floor(w * 0.68), y + 22, 9, [240, 230, 200]); // moon
  // runway and tower
  fillRect(x, y + h - 26, w, 8, LIGHTGREY);
  fillRect(x + 18, y + h - 58, 26, 32, GREY);
  fillRect(x + 14, y + h - 66, 34, 8, GREY);
  // explosion burst
  const cx = x + Math.floor(w * 0.62);
  const cy = y + Math.floor(h * 0.45);
  for (let k = 0; k < 10; k++) {
    const ang = (k * 36 * Math.PI) / 180;
    const len = k % 2 === 0 ? 34 : 24;
    const ex = Math.round(cx + Math.cos(ang) * len);
    const ey = Math.round(cy + Math.sin(ang) * len);
    thickLine(cx, cy, ex, ey, k % 3 === 0 ? YELLOW : ORANGE, 3);
  }
  fillCircle(cx, cy, 16, ORANGE);
  fillCircle(cx, cy, 10, YELLOW);
  fillCircle(cx - 26, cy + 12, 8, GREY);
  fillCircle(cx + 24, cy + 16, 7, GREY);
  rectOutline(x, y, w, h, INK, 2);
}

// The Kerch bridge: deck with a gap, one arch fallen into the strait.
function drawBridge(x: number, y: number, w: number, h: number): void {
  fillRect(x, y, w, h, SKY);
  const waterY = y + h - 34;
  fillRect(x, waterY, w, 34, WATER);
  drawLine(x + 6, waterY + 10, x + w - 6, waterY + 10, WHITE);
  drawLine(x + 20, waterY + 22, x + w - 20, waterY + 22, WHITE);
  // towers
  fillRect(x + 30, y + 14, 8, waterY - y - 14, INK);
  fillRect(x + w - 38, y + 14, 8, waterY - y - 14, INK);
  // standing arch (left half) and deck
  const deckY = y + 34;
  thickLine(x + 4, deckY, x + Math.floor(w * 0.52), deckY, INK, 4);
  thickLine(x + Math.floor(w * 0.78), deckY, x + w - 4, deckY, INK, 4);
  // intact arch over the left span
  for (let t = 0; t <= 12; t++) {
    const ax = x + 30 + Math.floor(((w / 2 - 34) * t) / 12);
    const ay = deckY - Math.floor(18 * Math.sin((t * Math.PI) / 12));
    fillCircle(ax, ay, 2, RED);
  }
  // fallen arch: tilted segment sinking into the water
  thickLine(x + Math.floor(w * 0.55), deckY, x + Math.floor(w * 0.72), waterY + 16, RED, 5);
  thickLine(x + Math.floor(w * 0.60), deckY + 2, x + Math.floor(w * 0.74), waterY + 8, RED, 3);
  fillCircle(x + Math.floor(w * 0.72), waterY + 16, 5, RED);
  // splash rings
  drawCircle(x + Math.floor(w * 0.72), waterY + 18, 10, WHITE);
  drawCircle(x + Math.floor(w * 0.72), waterY + 18, 15, WHITE);
  // debris drifting in the strait
  fillRect(x + Math.floor(w * 0.58), waterY + 6, 8, 4, INK);
  fillRect(x + Math.floor(w * 0.80), waterY + 14, 10, 4, INK);
  // small boat heading for the gap
  const boatX = x + Math.floor(w * 0.30);
  const boatY = waterY + 12;
  thickLine(boatX, boatY, boatX + 26, boatY, WHITE, 3);
  thickLine(boatX + 4, boatY, boatX + 10, boatY - 6, WHITE, 2);
  thickLine(boatX + 10, boatY, boatX + 22, boatY - 6, WHITE, 2);
  fillRect(boatX + 12, boatY - 16, 2, 10, WHITE); // mast
  fillRect(boatX + 14, boatY - 16, 10, 8, RED); // sail
  rectOutline(x, y, w, h, INK, 2);
}

// A ballot box with a paper going in and a big check mark.
function drawBallot(x: number, y: number, w: number, h: number): void {
  fillRect(x, y, w, h, PANEL);
  const bx = x + Math.floor(w * 0.18);
  const by = y + h - 52;
  // ballot paper, tilted into the slot
  thickLine(bx + 26, by - 34, bx + 44, by - 6, WHITE, 2);
  fillRect(bx + 20, by - 40, 26, 36, WHITE);
  rectOutline(bx + 20, by - 40, 26, 36, INK, 2);
  drawLine(bx + 24, by - 32, bx + 42, by - 32, INK);
  drawLine(bx + 24, by - 25, bx + 42, by - 25, INK);
  // the box
  fillRect(bx, by, 64, 40, NAVY);
  fillRect(bx - 6, by - 8, 76, 8, NAVY);
  fillRect(bx + 14, by - 5, 36, 3, INK); // slot
  drawText(bx + 18, by + 12, "VOTE", 2, WHITE);
  // big green check
  thickLine(x + w - 66, y + 22, x + w - 48, y + 44, GREEN, 5);
  thickLine(x + w - 48, y + 44, x + w - 16, y + 8, GREEN, 5);
  rectOutline(x, y, w, h, INK, 2);
}

// A measles virus: spiked ball.
function drawVirus(x: number, y: number, w: number, h: number): void {
  fillRect(x, y, w, h, [250, 238, 230]);
  const cx = x + Math.floor(w / 2);
  const cy = y + Math.floor(h / 2);
  for (let k = 0; k < 12; k++) {
    const ang = (k * 30 * Math.PI) / 180;
    const x1 = Math.round(cx + Math.cos(ang) * 26);
    const y1 = Math.round(cy + Math.sin(ang) * 26);
    const x2 = Math.round(cx + Math.cos(ang) * 36);
    const y2 = Math.round(cy + Math.sin(ang) * 36);
    thickLine(x1, y1, x2, y2, RED, 3);
    fillCircle(x2, y2, 4, RED);
  }
  fillCircle(cx, cy, 26, RED);
  fillCircle(cx - 9, cy - 8, 5, [255, 150, 140]);
  fillCircle(cx + 10, cy + 6, 4, [255, 150, 140]);
  fillCircle(cx + 2, cy - 12, 3, [255, 150, 140]);
  rectOutline(x, y, w, h, INK, 2);
}

// A computer chip with rising bars.
function drawChip(x: number, y: number, w: number, h: number): void {
  fillRect(x, y, w, h, PANEL);
  const cx = x + Math.floor(w / 2) - 8;
  const cy = y + Math.floor(h / 2) - 6;
  // pins
  for (let i = 0; i < 4; i++) {
    const off = 12 + i * 14;
    fillRect(cx + off, cy - 8, 8, 4, INK);
    fillRect(cx + off, cy + 34, 8, 4, INK);
    fillRect(cx - 8, cy + off - 8, 4, 8, INK);
    fillRect(cx + 60, cy + off - 8, 4, 8, INK);
  }
  fillRect(cx, cy - 4, 56, 44, DARKNAVY);
  fillRect(cx + 12, cy + 8, 32, 20, [70, 110, 180]);
  drawText(cx + 18, cy + 13, "NV", 2, WHITE);
  // rising bars
  const bars = [10, 18, 26];
  for (let i = 0; i < 3; i++) {
    fillRect(x + w - 34 + i * 10, y + h - 12 - bars[i], 7, bars[i], GREEN);
  }
  rectOutline(x, y, w, h, INK, 2);
}

// Four flags over a Manila skyline.
function drawQuad(x: number, y: number, w: number, h: number): void {
  fillRect(x, y, w, h, SKY);
  // skyline
  fillRect(x + 8, y + h - 40, 18, 40, GREY);
  fillRect(x + 30, y + h - 52, 16, 52, LIGHTGREY);
  fillRect(x + 50, y + h - 34, 22, 34, GREY);
  fillCircle(x + 61, y + h - 34, 11, LIGHTGREY);
  fillRect(x + w - 34, y + h - 46, 20, 46, GREY);
  // four flags
  const flagCols: RGB[] = [NAVY, RED, GREEN, GOLD];
  for (let i = 0; i < 4; i++) {
    const px = x + 16 + i * Math.floor((w - 32) / 4);
    fillRect(px, y + 8, 3, 34, INK);
    fillRect(px + 3, y + 10, 26, 15, flagCols[i]);
    fillRect(px + 3, y + 10, 26, 3, WHITE);
  }
  rectOutline(x, y, w, h, INK, 2);
}

// ---- a small story panel ----
type PicFn = (x: number, y: number, w: number, h: number) => void;

function drawPanel(
  x: number,
  y: number,
  w: number,
  h: number,
  kicker: string,
  headline: string,
  standfirst: string,
  pic: PicFn,
): void {
  fillRect(x, y, w, h, PANEL);
  rectOutline(x, y, w, h, INK, 2);
  fillRect(x, y, w, 4, RED);
  drawText(x + 12, y + 12, kicker, 2, RED);
  pic(x + 12, y + 34, w - 24, 72);
  drawTextBlock(x + 12, y + 116, headline, 2, w - 24, 4, INK);
  drawTextBlock(x + 12, y + 158, standfirst, 1, w - 24, 3, [64, 62, 56]);
}

// ---- the front page ----
function drawFrontPage(): void {
  fillRect(0, 0, W, H, PAPER);

  // Masthead
  drawTextCentred(26, "THE WORLD IN ONE DAY", 5, INK);
  drawTextCentred(76, "18 NOVEMBER 2026", 2, RED);
  drawTextCentred(96, "WEDNESDAY EDITION", 1, GREY);
  fillRect(24, 112, W - 48, 3, INK);
  fillRect(24, 118, W - 48, 1, INK);

  // Lead story: Xi and Putin meet in Shenzhen ahead of the trilateral.
  const lx = 24;
  const ly = 130;
  const lw = W - 48;
  const lh = 232;
  fillRect(lx, ly, lw, lh, PANEL);
  rectOutline(lx, ly, lw, lh, INK, 2);
  fillRect(lx, ly, lw, 4, RED);
  drawText(lx + 14, ly + 14, "LEAD - APEC SUMMIT", 2, RED);
  drawSummit(lx + 14, ly + 40, 250, 176);
  const tx = lx + 282;
  const tw = lw - 282 - 16;
  drawTextBlock(tx, ly + 40, "XI AND PUTIN MEET IN SHENZHEN BEFORE FIRST TRILATERAL WITH TRUMP", 3, tw, 6, INK);
  // gold rule separates headline from standfirst
  fillRect(tx, ly + 106, tw, 3, GOLD);
  drawTextBlock(
    tx,
    ly + 122,
    "THE THREE LEADERS WILL HOLD A FIRST-EVER TRILATERAL SUMMIT ON THURSDAY ON THE SIDELINES OF APEC.",
    2,
    tw,
    5,
    [64, 62, 56],
  );
  // location tag
  const tag = "APEC - SHENZHEN";
  rectOutline(tx, ly + 186, textWidth(tag, 2) + 20, 26, RED, 2);
  drawText(tx + 10, ly + 193, tag, 2, RED);

  // Six smaller stories in a 3 x 2 grid.
  const cols = [24, 353, 682];
  const colW = 318;
  const rows = [374, 600];
  const rowH = 214;

  drawPanel(
    cols[0], rows[0], colW, rowH,
    "MIDDLE EAST",
    "IRAN STRIKES U.S. BASES IN KUWAIT AND BAHRAIN",
    "TEHRAN HITS ALI AL SALEM AIR BASE AFTER A U.S. STRIKE ON QESHM ISLAND IN THE STRAIT OF HORMUZ.",
    drawStrike,
  );
  drawPanel(
    cols[1], rows[0], colW, rowH,
    "UKRAINE",
    "UKRAINIAN ATTACK PARTLY COLLAPSES KERCH BRIDGE",
    "ONE OF THE BRIDGE'S TWO ARCHES FALLS INTO THE STRAIT, CUTTING THE LINK TO CRIMEA.",
    drawBridge,
  );
  drawPanel(
    cols[2], rows[0], colW, rowH,
    "U.S. POLITICS",
    "PELTOLA WINS ALASKA SENATE RACE",
    "DEMOCRAT MARY PELTOLA'S WIN GIVES DEMOCRATS A 56-44 SENATE MAJORITY.",
    drawBallot,
  );
  drawPanel(
    cols[0], rows[1], colW, rowH,
    "HEALTH",
    "U.S. LOSES MEASLES-ELIMINATION STATUS",
    "THE STATUS ENDS AFTER 26 YEARS, HEALTH AUTHORITIES CONFIRM.",
    drawVirus,
  );
  drawPanel(
    cols[1], rows[1], colW, rowH,
    "MARKETS",
    "NVIDIA REVENUE $115.8B, UP 103 PERCENT",
    "Q3 SALES MORE THAN DOUBLE YEAR ON YEAR. THE BOARD RULES OUT REINSTATING JENSEN HUANG.",
    drawChip,
  );
  drawPanel(
    cols[2], rows[1], colW, rowH,
    "ASIA-PACIFIC",
    "QUAD LEADERS MEET IN MANILA",
    "FIRST QUAD SUMMIT IN OVER TWO YEARS. TRUMP ANNOUNCES A PHILIPPINES TRADE DEAL.",
    drawQuad,
  );

  // Ticker: the rest of the day's news.
  const ty = 828;
  drawText(24, ty, "ALSO TODAY", 2, RED);
  fillRect(24, ty + 20, W - 48, 1, INK);
  const ticker: string[] = [
    "EBOLA IN DR CONGO KILLS NEARLY THREE-QUARTERS OF INFECTED CHILDREN UNDER 5",
    "COLD THREATENS DISPLACED FAMILIES IN GAZA TENTS",
    "RUSSIAN MILITARY PLANE CRASHES IN SIBERIA, 19 DEAD",
    "NASA'S VOYAGER 1 REACHES A LIGHT-DAY MILESTONE",
  ];
  for (let i = 0; i < ticker.length; i++) {
    const yy = ty + 30 + i * 22;
    fillRect(24, yy + 2, 8, 8, RED);
    drawText(40, yy, ticker[i], 2, INK);
  }

  // Footer strip.
  const fy = 948;
  fillRect(24, fy, W - 48, 52, INK);
  drawText(40, fy + 19, "18 NOVEMBER 2026", 2, WHITE);
  const foot = "DRAWN PROCEDURALLY - NO PHOTOGRAPHS";
  drawText(W - 40 - textWidth(foot, 2), fy + 19, foot, 2, WHITE);
}

function main(): void {
  drawFrontPage();
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "out";
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "entry.png"), encodePNG());
}

main();
