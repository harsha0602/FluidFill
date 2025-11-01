"use client";

import { useCallback } from "react";

import { LandingUpload } from "@/components/LandingUpload";
import { uploadDocument } from "@/lib/client/uploadDocument";

export default function Home() {
  const handleUpload = useCallback(async (file: File) => {
    await uploadDocument(file);
  }, []);

  return (
    <section className="flex flex-col items-center gap-10 text-center">
      <div>
        <h1 className="text-5xl font-semibold tracking-tight text-text md:text-6xl">
          FluidFill
        </h1>
        <p className="mt-4 max-w-xl text-base text-text/70 md:text-lg">
          Purpose-built Next.js starter with a Lexsy-inspired palette to jumpstart your creative flow.
        </p>
      </div>

      <LandingUpload onUpload={handleUpload} />
    </section>
  );
}
