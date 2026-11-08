import { Suspense } from "react";
import Workspace from "@/components/workspace";
export const dynamic = "force-dynamic";
// Local-only app: no sign-in. The server listens on 127.0.0.1 and the
// private API refuses other hosts and cross-site changes.
export default function Home() {
  return (
    <Suspense
      fallback={
        <main className="container">
          <p role="status">Loading workspace…</p>
        </main>
      }
    >
      <Workspace />
    </Suspense>
  );
}
