import { describe, expect, it } from "vitest";
import { dirOf, filesFromDataTransfer, relPath, usableFiles } from "./dropped-paths.ts";

type Node = { name: string; children?: Node[] };

const BATCH = 100;

function entryOf(node: Node, parent = ""): FileSystemEntry {
  const fullPath = `${parent}/${node.name}`;
  if (!node.children) {
    return {
      isFile: true,
      isDirectory: false,
      name: node.name,
      fullPath,
      file: (ok: (f: File) => void) => ok(new File(["x"], node.name)),
    } as unknown as FileSystemEntry;
  }
  const kids = node.children.map((c) => entryOf(c, fullPath));
  return {
    isFile: false,
    isDirectory: true,
    name: node.name,
    fullPath,
    createReader: () => {
      let at = 0;
      return {
        // Như Chrome: mỗi lần tối đa BATCH entry, hết thì trả mảng rỗng.
        readEntries: (ok: (e: FileSystemEntry[]) => void) => {
          const part = kids.slice(at, at + BATCH);
          at += part.length;
          queueMicrotask(() => ok(part));
        },
      };
    },
  } as unknown as FileSystemEntry;
}

/** DataTransfer giả: item hết hạn (webkitGetAsEntry → null) sau khi handler thoát đồng bộ. */
function dtOf(roots: Node[], files: File[] = []) {
  let alive = true;
  queueMicrotask(() => {
    alive = false;
  });
  const items = roots.map((r) => ({
    kind: "file",
    webkitGetAsEntry: () => (alive ? entryOf(r) : null),
  }));
  return { items, files } as unknown as DataTransfer;
}

const names = (n: number, ext = "png") => Array.from({ length: n }, (_, i) => ({ name: `${i + 1}.${ext}` }));

describe("filesFromDataTransfer", () => {
  it("reads every batch of a large folder", async () => {
    const files = await filesFromDataTransfer(dtOf([{ name: "ch 1", children: names(130) }]));
    expect(files).toHaveLength(130);
    expect(relPath(files[0] as File)).toBe("ch 1/1.png");
  });

  it("walks nested folders, keeps full paths and skips junk", async () => {
    const files = await filesFromDataTransfer(
      dtOf([
        {
          name: "series",
          children: [
            { name: "ch 9", children: [{ name: "1.png" }, { name: ".DS_Store" }, { name: "Thumbs.db" }] },
            { name: "ch 10", children: [{ name: "1.png" }] },
            { name: "__MACOSX", children: [{ name: "x.png" }] },
            { name: "cover.png" },
          ],
        },
      ]),
    );
    expect(files.map(relPath).sort()).toEqual(["series/ch 10/1.png", "series/ch 9/1.png", "series/cover.png"]);
    expect(files.map(dirOf).sort()).toEqual(["series", "series/ch 10", "series/ch 9"]);
  });

  it("keeps loose files dropped at the root", async () => {
    const files = await filesFromDataTransfer(
      dtOf([{ name: "001.png" }, { name: "f", children: [{ name: "a.png" }] }]),
    );
    expect(files.map(relPath)).toEqual(["001.png", "f/a.png"]);
  });

  it("skips only the entry that fails to read", async () => {
    const bad = {
      isFile: true,
      isDirectory: false,
      name: "bad.png",
      fullPath: "/f/bad.png",
      file: (_ok: unknown, fail: (e: Error) => void) => fail(new Error("unreadable")),
    } as unknown as FileSystemEntry;
    const good = entryOf({ name: "f", children: [{ name: "1.png" }, { name: "2.png" }] });
    const kids = [
      bad,
      ...(await new Promise<FileSystemEntry[]>((ok, fail) =>
        (good as FileSystemDirectoryEntry).createReader().readEntries(ok, fail),
      )),
    ];
    let served = false;
    const folder = {
      isFile: false,
      isDirectory: true,
      name: "f",
      fullPath: "/f",
      createReader: () => ({
        readEntries: (ok: (e: FileSystemEntry[]) => void) => {
          ok(served ? [] : kids);
          served = true;
        },
      }),
    } as unknown as FileSystemEntry;
    const dt = { items: [{ kind: "file", webkitGetAsEntry: () => folder }], files: [] } as unknown as DataTransfer;
    expect((await filesFromDataTransfer(dt)).map(relPath)).toEqual(["f/1.png", "f/2.png"]);
  });

  it("returns nothing for an empty folder", async () => {
    expect(await filesFromDataTransfer(dtOf([{ name: "empty", children: [] }]))).toEqual([]);
  });

  it("falls back to dt.files without the entry API", async () => {
    const f = new File(["x"], "a.png");
    const dt = { items: [{ kind: "file" }], files: [f] } as unknown as DataTransfer;
    expect(await filesFromDataTransfer(dt)).toEqual([f]);
    expect(await filesFromDataTransfer(null)).toEqual([]);
  });
});

describe("relPath", () => {
  it("uses webkitRelativePath from a folder picker, else the name", () => {
    const f = new File(["x"], "1.png");
    Object.defineProperty(f, "webkitRelativePath", { value: "ch 1/1.png" });
    expect(relPath(f)).toBe("ch 1/1.png");
    expect(dirOf(f)).toBe("ch 1");
    expect(relPath(new File(["x"], "2.png"))).toBe("2.png");
    expect(dirOf(new File(["x"], "2.png"))).toBe("");
  });
});

describe("usableFiles", () => {
  const at = (path: string) => {
    const f = new File(["x"], path.split("/").pop() ?? path);
    Object.defineProperty(f, "webkitRelativePath", { value: path.includes("/") ? path : "" });
    return f;
  };
  it("drops junk and non-images inside folders, keeps loose files and ZIPs", () => {
    const kept = usableFiles(
      ["s/1.png", "s/a.txt", "s/.DS_Store", "s/x.zip", "__MACOSX/1.png", "notes.txt", "2.webp"].map(at),
    ).map(relPath);
    expect(kept).toEqual(["s/1.png", "s/x.zip", "notes.txt", "2.webp"]);
  });
});
