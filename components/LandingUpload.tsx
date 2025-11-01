"use client";

import { useCallback, useMemo, useState } from "react";
import { useDropzone } from "react-dropzone";

type LandingUploadProps = {
  onUpload: (file: File) => void;
  className?: string;
};

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function LandingUpload({ onUpload, className }: LandingUploadProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const handleDrop = useCallback(
    (acceptedFiles: File[]) => {
      const file = acceptedFiles?.[0];
      if (!file) {
        return;
      }
      setSelectedFile(file);
      onUpload(file);
    },
    [onUpload]
  );
  const acceptConfig = useMemo(
    () => ({
      [DOCX_MIME]: [".docx"]
    }),
    []
  );

  const { getRootProps, getInputProps, isDragActive, open, fileRejections } =
    useDropzone({
      onDrop: handleDrop,
      accept: acceptConfig,
      multiple: false
    });

  const rejectionMessage = fileRejections[0]?.errors[0]?.message;

  return (
    <section
      className={`mx-auto flex w-full max-w-[92vw] flex-col gap-4 rounded-2xl border border-primary/60 bg-background/80 p-6 text-text shadow-lg sm:max-w-[25rem] ${className ?? ""}`}
    >
      <div {...getRootProps({ className: "outline-none" })}>
        <input {...getInputProps()} />
        <div
          className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-primary/50 bg-background/60 px-6 py-10 text-center transition ${
            isDragActive ? "border-primary bg-primary/10 text-primary" : ""
          }`}
        >
          <span className="text-lg font-semibold">Drop your .docx here</span>
          <span className="text-sm text-text/70">
            Drag & drop or use the button below to browse files.
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={open}
        className="w-full rounded-lg border border-primary bg-primary/20 px-5 py-3 text-center text-base font-medium text-primary transition hover:bg-primary hover:text-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary sm:self-center"
      >
        Browse Files
      </button>

      {selectedFile && (
        <p className="truncate text-center text-sm text-text/80">
          Ready to upload: <span className="font-medium">{selectedFile.name}</span>
        </p>
      )}

      {rejectionMessage && (
        <p className="text-center text-sm text-red-400">{rejectionMessage}</p>
      )}
    </section>
  );
}
