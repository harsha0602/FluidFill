"use client";

import { useCallback, useMemo, useState } from "react";
import { useDropzone } from "react-dropzone";

type LandingUploadProps = {
  onUpload: (file: File) => Promise<void>;
  className?: string;
};

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function LandingUpload({ onUpload, className }: LandingUploadProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles?.[0];
    if (!file) {
      return;
    }
    setSelectedFile(file);
    setErrorMessage(null);
  }, []);
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

  const handleUploadClick = useCallback(async () => {
    if (!selectedFile || isUploading) {
      return;
    }
    try {
      setIsUploading(true);
      setErrorMessage(null);
      await onUpload(selectedFile);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Upload failed. Please try again.";
      setErrorMessage(message);
    } finally {
      setIsUploading(false);
    }
  }, [selectedFile, onUpload, isUploading]);

  const uploadDisabled = !selectedFile || isUploading;

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

      <button
        type="button"
        onClick={handleUploadClick}
        disabled={uploadDisabled}
        className={`w-full rounded-lg border border-primary bg-primary px-5 py-3 text-center text-base font-semibold text-background transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary sm:self-center ${
          uploadDisabled ? "cursor-not-allowed opacity-60" : "hover:bg-primary/80"
        }`}
      >
        {isUploading ? "Uploading..." : "Upload"}
      </button>

      {selectedFile && (
        <p className="truncate text-center text-sm text-text/80">
          Ready to upload: <span className="font-medium">{selectedFile.name}</span>
        </p>
      )}

      {rejectionMessage && (
        <p className="text-center text-sm text-red-400">{rejectionMessage}</p>
      )}

      {errorMessage && (
        <p className="text-center text-sm text-red-400">{errorMessage}</p>
      )}
    </section>
  );
}
