import { afterEach, describe, expect, it, vi } from "vitest";
import { bandFingerprint, fingerprint } from "./image-fingerprint.ts";

type Draw = number[];

/** Ảnh giả `w`×`h`: mỗi lần vẽ ghi lại vùng nguồn; pixel đích là gradient để hash không trơn. */
function stubImage(w: number, h: number) {
  const draws: Draw[] = [];
  const close = vi.fn();
  vi.stubGlobal("createImageBitmap", async () => ({ width: w, height: h, close }));
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      getContext() {
        return {
          imageSmoothingQuality: "",
          drawImage: (_b: unknown, ...a: number[]) => draws.push(a),
          getImageData: () => {
            const data = new Uint8ClampedArray(9 * 8 * 4);
            for (let i = 0; i < 72; i++) data.fill((i * 37) % 256, i * 4, i * 4 + 3);
            return { data };
          },
        };
      }
    },
  );
  return { draws, close };
}

afterEach(() => vi.unstubAllGlobals());

describe("bandFingerprint", () => {
  it("reads the top band from y=0 at full width and reports the band size", async () => {
    const { draws, close } = stubImage(800, 3000);
    const fp = await bandFingerprint(new Blob(), "top", 120);
    expect(draws).toEqual([[0, 0, 800, 120, 0, 0, 9, 8]]);
    expect(fp).toMatchObject({ width: 800, height: 120 });
    expect(fp?.dhash).toMatch(/^[0-9a-f]{16}$/);
    expect(close).toHaveBeenCalled();
  });

  it("reads the bottom band from H - band", async () => {
    const { draws } = stubImage(800, 3000);
    const fp = await bandFingerprint(new Blob(), "bottom", 200);
    expect(draws).toEqual([[0, 2800, 800, 200, 0, 0, 9, 8]]);
    expect(fp).toMatchObject({ width: 800, height: 200 });
  });

  it("gives the same hash as the whole-image fingerprint when the band is the whole image", async () => {
    stubImage(800, 300);
    const whole = await fingerprint(new Blob());
    expect(await bandFingerprint(new Blob(), "top", 300)).toEqual(whole);
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
