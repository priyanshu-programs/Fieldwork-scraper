import { notFound } from "next/navigation";
import Lab from "@/components/collector/lab";
export default function Page() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <Lab />;
}
