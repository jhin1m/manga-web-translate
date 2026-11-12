import { afterEach, describe, expect, it, vi } from "vitest";
import { bandFingerprint, bandTrims, fingerprint, type LearnedEdgeBand } from "./image-fingerprint.ts";

type Draw = number[];

/** Ảnh giả `w`×`h`: mỗi lần vẽ ghi lại vùng nguồn; pixel đích là gradient để hash không trơn. */
function stubImage(w: number, h: number) {
  const draws: Draw[] = [];
  const close = vi.fn();
  vi.stubGlobal("createImageBitmap", async () => ({ width: w, height: h, close }));
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      constructor(
        readonly width: number,
        readonly height: number,
      ) {}
      getContext() {
        const { width, height } = this;
        return {
          imageSmoothingQuality: "",
          drawImage: (_b: unknown, ...a: number[]) => draws.push([...a, width, height]),
          getImageData: () => {
            const data = new Uint8ClampedArray(width * height * 4);
            for (let i = 0; i < width * height; i++) data.fill((Math.floor(i / 3) * 37) % 256, i * 4, i * 4 + 3);
            return { data };
          },
        };
      }
    },
  );
  return { draws, close };
}

afterEach(() => vi.unstubAllGlobals());

describe("fingerprint", () => {
  it("still shrinks the whole bitmap straight to 9x8 and reports its size", async () => {
    const { draws } = stubImage(800, 300);
    const fp = await fingerprint(new Blob());
    expect(draws).toEqual([[0, 0, 800, 300, 0, 0, 9, 8, 9, 8]]);
    expect(fp).toMatchObject({ width: 800, height: 300 });
    expect(fp?.dhash).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("bandFingerprint", () => {
  it("reads the top band from y=0 at full width and reports the band size", async () => {
    const { draws, close } = stubImage(800, 3000);
    const fp = await bandFingerprint(new Blob(), "top", 120);
    // Chép 1:1 sang canvas đúng cỡ dải (không co về 9×8 ngay trên bitmap).
    expect(draws).toEqual([[0, 0, 800, 120, 0, 0, 800, 120, 800, 120]]);
    expect(fp).toMatchObject({ width: 800, height: 120 });
    expect(fp?.dhash).toMatch(/^[0-9a-f]{16}$/);
    expect(close).toHaveBeenCalled();
  });

  it("reads the bottom band from H - band", async () => {
    const { draws } = stubImage(800, 3000);
    const fp = await bandFingerprint(new Blob(), "bottom", 200);
    expect(draws).toEqual([[0, 2800, 800, 200, 0, 0, 800, 200, 800, 200]]);
    expect(fp).toMatchObject({ width: 800, height: 200 });
  });

  it("returns null for an undecodable image, a band taller than the image, or a bad size", async () => {
    stubImage(800, 100);
    expect(await bandFingerprint(new Blob(), "top", 101)).toBeNull();
    expect(await bandFingerprint(new Blob(), "top", 0)).toBeNull();
    expect(await bandFingerprint(new Blob(), "top", 1.5)).toBeNull();
    vi.stubGlobal("createImageBitmap", async () => {
      throw new Error("decode");
    });
    expect(await bandFingerprint(new Blob(), "bottom", 10)).toBeNull();
  });
});

/** Ảnh giả: `pixel(x, y)` = độ xám tại điểm; createImageBitmap/OffscreenCanvas đọc đúng vùng được vẽ. */
type Scene = { w: number; h: number; pixel: (x: number, y: number) => number };

function stubScenes(scenes: Map<Blob, Scene>) {
  type Bmp = { width: number; height: number; scene: Scene; close: () => void };
  vi.stubGlobal("createImageBitmap", async (b: Blob) => {
    const scene = scenes.get(b);
    if (!scene) throw new Error("decode");
    return { width: scene.w, height: scene.h, scene, close: () => {} } satisfies Bmp;
  });
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      private src?: { bmp: Bmp; sy: number };
      constructor(
        readonly width: number,
        readonly height: number,
      ) {}
      getContext() {
        return {
          imageSmoothingQuality: "",
          drawImage: (bmp: Bmp, _sx: number, sy: number) => {
            this.src = { bmp, sy };
          },
          getImageData: () => {
            const data = new Uint8ClampedArray(this.width * this.height * 4);
            const src = this.src;
            for (let y = 0; y < this.height; y++) {
              for (let x = 0; x < this.width; x++) {
                const v = src ? src.bmp.scene.pixel(x, src.sy + y) : 0;
                data.fill(v, (y * this.width + x) * 4, (y * this.width + x) * 4 + 3);
              }
            }
            return { data };
          },
        };
      }
    },
  );
}

describe("bandTrims", () => {
  const W = 160;
  /** Sọc dọc xen kẽ: nhiều bit 1, không bị coi là ảnh trơn. */
  const stripe = (x: number) => (Math.floor(x / 10) % 2 ? 30 : 220);
  /** Ảnh cao `h`: dải sọc `top` hàng đầu và `bottom` hàng cuối; phần còn lại là dốc sáng dần (hash trơn). */
  const page = (h: number, top = 0, bottom = 0): Scene => ({
    w: W,
    h,
    pixel: (x, y) => (y < top || y >= h - bottom ? stripe(x) : x),
  });
  const fp = { dhash: "0f0f0f0f0f0f0f0f", width: W, height: 1000 };
  const blobsOf = (scenes: Scene[]) => {
    const blobs = scenes.map(() => new Blob());
    stubScenes(new Map(blobs.map((b, i) => [b, scenes[i] as Scene])));
    return blobs;
  };
  const learn = async (edge: "top" | "bottom", px: number): Promise<LearnedEdgeBand> => {
    const [b] = blobsOf([page(600, edge === "top" ? px : 0, edge === "bottom" ? px : 0)]);
    const f = await bandFingerprint(b as Blob, edge, px);
    if (!f) throw new Error("no fingerprint");
    return { edge, ...f };
  };

  it("trims the top of one of the first three images and the bottom of one of the last three", async () => {
    const top = await learn("top", 40);
    const bottom = await learn("bottom", 50);
    const scenes = [page(600, 40), ...Array.from({ length: 6 }, () => page(600)), page(600, 0, 50), page(600)];
    const blobs = blobsOf(scenes);
    const out = await bandTrims(
      blobs,
      blobs.map(() => fp),
      [top, bottom],
    );
    expect(out).toEqual([{ top: 40, bottom: 0 }, ...Array(6).fill(null), { top: 0, bottom: 50 }, null]);
  });

  it("only looks at the first three and last three images", async () => {
    const top = await learn("top", 40);
    const blobs = blobsOf(Array.from({ length: 8 }, (_, i) => page(600, i === 3 ? 40 : 0)));
    expect(
      await bandTrims(
        blobs,
        blobs.map(() => fp),
        [top],
      ),
    ).toEqual(Array(8).fill(null));
  });

  it("checks both edges of an image in a short chapter, keeping at least the minimum below the second cut", async () => {
    const top = await learn("top", 40);
    const bottom = await learn("bottom", 50);
    const roomy = blobsOf([page(300, 40, 50)]);
    expect(await bandTrims(roomy, [fp], [top, bottom])).toEqual([{ top: 40, bottom: 50 }]);
    // 40 + 50 cắt từ ảnh cao 140 chỉ còn 50 < 64: bỏ dải thứ hai.
    const tight = blobsOf([page(140, 40, 50)]);
    expect(await bandTrims(tight, [fp], [top, bottom])).toEqual([{ top: 40, bottom: 0 }]);
  });

  it("skips images without a fingerprint, undecodable images, and returns nothing without bands", async () => {
    const top = await learn("top", 40);
    const blobs = blobsOf([page(600, 40), page(600, 40)]);
    blobs[1] = new Blob(); // không có trong bảng ảnh → giải mã lỗi
    expect(await bandTrims(blobs, [null, fp], [top])).toEqual([null, null]);
    expect(await bandTrims(blobsOf([page(600, 40)]), [fp], [])).toEqual([null]);
  });

  it("never matches a plain window, even against a plain learned band", async () => {
    const plainBand: LearnedEdgeBand = { edge: "top", dhash: "0000000000000001", width: W, height: 40 };
    const blobs = blobsOf([page(600)]);
    expect(await bandTrims(blobs, [fp], [plainBand])).toEqual([null]);
  });

  it("takes the first matching band in list order", async () => {
    const short = await learn("bottom", 50);
    const tall = await learn("bottom", 80);
    const blobs = blobsOf([page(600, 0, 80)]);
    expect(await bandTrims(blobs, [fp], [short, tall])).toEqual([{ top: 0, bottom: 50 }]);
    expect(await bandTrims(blobs, [fp], [tall, short])).toEqual([{ top: 0, bottom: 80 }]);
  });

  it("scales the learned band height with the image width", async () => {
    const bottom = await learn("bottom", 50);
    const wide: Scene = { w: 2 * W, h: 1200, pixel: (x, y) => (y >= 1100 ? stripe(x / 2) : x / 2) };
    const blobs = blobsOf([wide]);
    expect(await bandTrims(blobs, [{ ...fp, width: 2 * W }], [bottom])).toEqual([{ top: 0, bottom: 100 }]);
  });
});
