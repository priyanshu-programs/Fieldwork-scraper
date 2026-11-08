import { notFound } from "next/navigation";
import { Suspense } from "react";
import Workspace from "@/components/workspace";
export default function Page() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <Suspense>
      <Workspace />
    </Suspense>
  );
}
