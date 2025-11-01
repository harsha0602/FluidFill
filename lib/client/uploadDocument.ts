"use client";

const apiBase =
  process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "") ?? "";

export async function uploadDocument(file: File) {
  const formData = new FormData();
  formData.append("file", file);

  const target = apiBase ? `${apiBase}/api/upload` : "/api/upload";
  const response = await fetch(target, {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Upload failed.");
  }

  const json = await response.json().catch(() => null);
  if (!json || typeof json.documentId !== "string") {
    throw new Error("Upload succeeded but no document ID was returned.");
  }

  window.location.href = `/doc/${json.documentId}`;
}
