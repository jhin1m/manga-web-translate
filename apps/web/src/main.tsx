import { StrictMode, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { authClient } from "./lib/api.ts";
import { AcceptInvitePage } from "./routes/accept-invite.tsx";
import { LoginPage } from "./routes/login.tsx";
import { WorkspaceHomePage, WorkspacePickerPage } from "./routes/workspaces.tsx";

// Router tối giản theo pathname; Phase 4 thay bằng router thật.
const subscribe = (cb: () => void) => {
  addEventListener("popstate", cb);
  return () => removeEventListener("popstate", cb);
};
const usePath = () => useSyncExternalStore(subscribe, () => location.pathname);

function App() {
  const path = usePath();
  const { data: session, isPending } = authClient.useSession();

  if (path === "/accept-invite") return <AcceptInvitePage />;
  if (path === "/login") return <LoginPage />;
  if (isPending) return null;
  if (!session) return <LoginPage next={path} />;

  const ws = /^\/w\/([0-9a-f-]{36})\/?$/.exec(path)?.[1];
  if (ws) return <WorkspaceHomePage ws={ws} />;
  return <WorkspacePickerPage />;
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
