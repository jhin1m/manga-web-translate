import "./styles/tokens.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { queryClient, router } from "./app/router.tsx";
import { initI18n } from "./i18n/i18n-store.ts";

function render() {
  const root = document.getElementById("root");
  if (!root) return;
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  );
}

// Chọn ngôn ngữ (và tải bảng chuỗi nếu không phải bản gốc) trước khi vẽ để không nháy chữ Việt; `initI18n` không bao
// giờ từ chối và tự bỏ chờ sau `I18N_INIT_TIMEOUT_MS` (vẽ bằng bản gốc). Không dùng top-level await để giữ tương thích
// target build.
void initI18n().then(render);
