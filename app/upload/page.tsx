"use client";

import { useCallback } from "react";

import { LandingUpload } from "@/components/LandingUpload";
import { uploadDocument } from "@/lib/client/uploadDocument";

export default function UploadPage() {
  const handleUpload = useCallback(async (file: File) => {
    await uploadDocument(file);
  }, []);

  return (
    <section className="flex flex-col items-center gap-6 text-center">
      <header className="space-y-2">
        <h1 className="text-4xl font-semibold tracking-tight text-text md:text-5xl">
          Upload a document
        </h1>
        <p className="text-sm text-text/70 md:text-base">
          We&apos;ll analyse your SAFE, cache the preview, and prepare the AI form experience.
        </p>
      </header>

      <LandingUpload onUpload={handleUpload} />
    </section>
  );
}
