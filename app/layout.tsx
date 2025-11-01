import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Footer } from "@/components/Footer";
import { TopBar } from "@/components/TopBar";

import "./globals.css";

export const metadata: Metadata = {
  title: "FluidFill",
  description: "FluidFill — a crisp starting point for fluid design experiments."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <TopBar />
        <main className="flex flex-1 items-center justify-center px-4">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
