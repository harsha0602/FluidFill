"use client";

import { useCallback, useState } from "react";
import { LandingUpload } from "@/components/LandingUpload";

export default function Home() {
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);

  const handleUpload = useCallback((file: File) => {
    setUploadedFileName(file.name);
    // Future integration point: trigger API upload or route transition.
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

      {uploadedFileName && (
        <p className="text-sm text-text/60">
          Last uploaded: <span className="font-medium text-text">{uploadedFileName}</span>
        </p>
      )}
    </section>
  );
}
