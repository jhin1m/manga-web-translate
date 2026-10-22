/** PNG xám 8 bit w×h từ hàm độ sáng — ảnh có nội dung khác nhau (dHash khác nhau) cho e2e. */
import { crc32, deflateSync } from "node:zlib";

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

export function grayPng(w: number, h: number, shade: (x: number, y: number) => number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 0, 0, 0, 0], 8); // 8 bit, xám, deflate, filter 0, không interlace
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = Math.max(0, Math.min(255, Math.round(shade(x, y))));
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
