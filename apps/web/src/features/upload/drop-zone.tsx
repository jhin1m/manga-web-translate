/**
 * Thả file / folder (kéo-thả hoặc chọn): dải thả (hoặc vùng lớn khi chưa có series), nút chọn file, và thả bất kỳ đâu trên trang. Chỉ trả về danh sách
 * File; đọc ZIP/kiểm file do dòng xác nhận / upload-manager làm.
 */
import { type DragEvent, type ReactNode, useEffect, useRef, useState } from "react";
import "../home/home.css";
import { filesFromDataTransfer } from "./dropped-paths.ts";

export const ACCEPT_UPLOAD = "image/png,image/jpeg,image/webp,.zip,application/zip";

/** Đọc cả folder thả vào (async); lỗi đọc → coi như không có file. */
const readDrop = (dt: DataTransfer | null) => filesFromDataTransfer(dt).catch((): File[] => []);

/** `<label class="btn">` bọc input file ẩn — bấm được bằng bàn phím qua nhãn. `directory`: chọn cả folder. */
export function FilePickButton({
  children,
  onFiles,
  className = "",
  multiple = true,
  directory = false,
}: {
  children: ReactNode;
  onFiles: (files: File[]) => void;
  className?: string;
  multiple?: boolean;
  directory?: boolean;
}) {
  return (
    <label className={`btn file-pick ${className}`}>
      {children}
      <input
        type="file"
        multiple={multiple}
        // webkitdirectory không có trong type React; hộp chọn folder bỏ qua `accept`.
        {...(directory ? { webkitdirectory: "" } : { accept: ACCEPT_UPLOAD })}
        onChange={(e) => {
          const list = e.target.files ? [...e.target.files] : [];
          e.target.value = "";
          // Folder rỗng → báo lên để hiện "không có ảnh"; chọn file thường không bao giờ rỗng.
          if (list.length || directory) onFiles(list);
        }}
      />
    </label>
  );
}

/** Props kéo-thả gắn vào phần tử bất kỳ (hàng chương nháp…); `over` để tô sáng. */
export function useDropTarget(onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  return {
    over,
    props: {
      onDragEnter: (e: DragEvent) => {
        e.preventDefault();
        depth.current++;
        setOver(true);
      },
      onDragOver: (e: DragEvent) => e.preventDefault(),
      onDragLeave: () => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        // Item của DataTransfer hết hạn sau handler: lấy cờ + entry đồng bộ trước khi await.
        // Thả toàn folder rỗng / rác → `onFiles([])` để người gọi báo "không có ảnh".
        if (!e.dataTransfer?.types.includes("Files")) return;
        void readDrop(e.dataTransfer).then(onFiles);
      },
    },
  };
}

/** Thả file ở bất kỳ đâu trên trang (ngoài các vùng thả riêng, chúng đã preventDefault) = `onFiles`. */
export function usePageDrop(onFiles: (files: File[]) => void) {
  const cb = useRef(onFiles);
  cb.current = onFiles;
  useEffect(() => {
    const over = (e: globalThis.DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    const drop = (e: globalThis.DragEvent) => {
      if (e.defaultPrevented) return;
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      void readDrop(e.dataTransfer).then((list) => cb.current(list));
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);
}

const UploadIcon = ({ size }: { size: number }) => (
  <svg
    className="dropzone-icon"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    aria-hidden="true"
  >
    <path d="M12 16V4M6 10l6-6 6 6M4 20h16" />
  </svg>
);

/**
 * `strip`: dải 56px một dòng (icon + tiêu đề + "chọn file"), dùng khi đã có series. `lg`: vùng lớn có dòng gợi ý,
 * dùng cho người chưa có series nào. `md`: vùng vừa có dòng gợi ý (màn chương, tải tiếp ảnh).
 */
export function DropZone(props: {
  label: string;
  title: ReactNode;
  hint?: ReactNode;
  onFiles: (files: File[]) => void;
  size?: "lg" | "md" | "strip";
}) {
  const size = props.size ?? "strip";
  const drop = useDropTarget(props.onFiles);
  return (
    <section aria-label={props.label} className="dropzone" data-size={size} data-over={drop.over} {...drop.props}>
      <UploadIcon size={size === "lg" ? 36 : size === "md" ? 28 : 18} />
      <div className="dropzone-text">
        <div className="dropzone-title">{props.title}</div>
        {size !== "strip" && props.hint && <div className="dropzone-hint">{props.hint}</div>}
      </div>
      {size === "strip" ? (
        <>
          <FilePickButton className="link" onFiles={props.onFiles}>
            chọn file
          </FilePickButton>
          <FilePickButton className="link" directory onFiles={props.onFiles}>
            chọn folder
          </FilePickButton>
        </>
      ) : (
        <>
          <FilePickButton className={`btn-primary ${size === "lg" ? "lg" : ""}`} onFiles={props.onFiles}>
            Chọn file…
          </FilePickButton>
          <FilePickButton className={size === "lg" ? "lg" : ""} directory onFiles={props.onFiles}>
            Chọn folder…
          </FilePickButton>
        </>
      )}
    </section>
  );
}
