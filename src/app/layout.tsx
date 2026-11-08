import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Fieldwork — Research crawler",
  description: "Collect web pages. Keep the source.",
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
