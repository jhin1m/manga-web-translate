/**
 * Bảng region (nguồn | bản dịch) sửa nhanh hàng loạt: sửa bản dịch cập nhật region + box gắn với nó
 * (1 bước undo mỗi lượt gõ liên tục). Bấm dòng → chọn box và cuộn canvas tới vùng đó.
 */
import { setRegionTranslation } from "../actions.ts";
import { editorStore, useEditor } from "../store.ts";
import { TextField } from "./TextField.tsx";

const FLAG_LABEL = { sfx: "SFX", empty: "trống", low_conf: "cần soát" } as const;

/** Cuộn khung nhìn để vùng nằm ở 1/3 trên màn hình. */
function focusRegion(regionId: string) {
  const s = editorStore.getState();
  const r = s.doc?.regions.find((x) => x.id === regionId);
  if (!r) return;
  const box = s.doc?.text_boxes.find((b) => b.region_id === regionId);
  if (box) s.select(box.id);
  const y = r.bbox[1];
  s.setView({ ...s.view, y: -y * s.view.scale + 120 });
}

export function RegionTable() {
  const regions = useEditor((s) => s.doc?.regions);
  const selectedRegion = useEditor((s) => s.doc?.text_boxes.find((b) => b.id === s.selection)?.region_id ?? null);
  const readOnly = useEditor((s) => !!s.readOnly);
  if (!regions?.length) return <p className="muted small ed-pad">Trang chưa có vùng chữ.</p>;

  return (
    <table className="data ed-regions">
      <thead>
        <tr>
          <th className="num">#</th>
          <th>Nguồn</th>
          <th>Bản dịch</th>
        </tr>
      </thead>
      <tbody>
        {regions.map((r, i) => (
          <tr key={r.id} className={r.id === selectedRegion ? "on" : undefined} onClick={() => focusRegion(r.id)}>
            <td className="num">{i + 1}</td>
            <td>
              <div className="ed-src">{r.source_text || <span className="muted">—</span>}</div>
              {r.flags.length > 0 && (
                <div className="ed-flags">
                  {r.flags.map((f) => (
                    <span key={f} className="status" data-tone={f === "low_conf" ? "warn" : "idle"}>
                      {FLAG_LABEL[f]}
                    </span>
                  ))}
                </div>
              )}
            </td>
            <td>
              <TextField
                aria-label={`Bản dịch vùng ${i + 1}`}
                rows={2}
                value={r.translation}
                disabled={readOnly}
                onValue={(v) => {
                  const s = editorStore.getState();
                  if (s.layout) s.apply(setRegionTranslation(r.id, v, s.layout), `region:${r.id}`);
                }}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
