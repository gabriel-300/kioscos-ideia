"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface Props {
  value:    string | null;
  onChange: (url: string | null) => void;
  folder?:  string;
}

export function ImageUploader({ value, onChange, folder = "products" }: Props) {
  const [uploading, setUploading] = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [showUrl,   setShowUrl]   = useState(false);
  const [urlValue,  setUrlValue]  = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) { setError("Solo se permiten imágenes"); return; }
    if (file.size > 5 * 1024 * 1024)    { setError("Máximo 5 MB"); return; }

    setError(null);
    setUploading(true);
    try {
      const supabase = createClient();
      const ext  = file.name.split(".").pop() ?? "jpg";
      const path = `${folder}/${crypto.randomUUID()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("product-images")
        .upload(path, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from("product-images")
        .getPublicUrl(path);

      onChange(publicUrl);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function handleUseUrl() {
    const url = urlValue.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) { setError("La URL debe empezar con http:// o https://"); return; }
    setError(null);
    onChange(url);
    setUrlValue("");
    setShowUrl(false);
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />

      <div
        onClick={() => inputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        className="relative group cursor-pointer rounded-xl border-2 border-dashed border-neutral-200 overflow-hidden w-32 aspect-square flex items-center justify-center bg-neutral-50 hover:border-tierra-700 transition-colors"
      >
        {uploading ? (
          <div className="flex flex-col items-center gap-2">
            <span className="size-6 border-2 border-tierra-700 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-neutral-400">Subiendo…</span>
          </div>
        ) : value ? (
          <>
            <img src={value} alt="" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <span className="text-white text-xs font-semibold">Cambiar</span>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 p-3 text-center pointer-events-none">
            <svg className="size-8 text-neutral-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
            </svg>
            <span className="text-xs text-neutral-400 leading-tight">Subir imagen</span>
          </div>
        )}
      </div>

      {value && !uploading && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="mt-1.5 text-xs text-neutral-400 hover:text-danger transition-colors block"
        >
          Quitar imagen
        </button>
      )}

      {!uploading && (
        showUrl ? (
          <div className="mt-1.5 flex items-center gap-1">
            <input
              type="text"
              autoFocus
              placeholder="https://…"
              value={urlValue}
              onChange={(e) => setUrlValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleUseUrl(); } }}
              className="h-7 w-32 rounded border border-neutral-300 bg-white px-2 text-xs focus:outline-none focus:border-tierra-700"
            />
            <button type="button" onClick={handleUseUrl} className="text-xs text-tierra-700 hover:underline font-medium">
              Usar
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowUrl(true)}
            className="mt-1.5 text-xs text-neutral-400 hover:text-tierra-700 transition-colors block"
          >
            o pegar una URL
          </button>
        )
      )}

      {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
    </div>
  );
}
