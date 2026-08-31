// components/FileDropZone.tsx
import React, { useCallback, useId, useRef, useState } from "react";

interface Props {
  accept: string;
  label: string;
  hint?: string;
  fileName?: string;
  onFile: (file: File) => void;
}

function fileMatchesAccept(file: File, accept: string): boolean {
  const tokens = accept.split(",").map((t) => t.trim()).filter(Boolean);
  if (tokens.length === 0) return true;

  return tokens.some((token) => {
    if (token.startsWith(".")) {
      return file.name.toLowerCase().endsWith(token.toLowerCase());
    }
    if (token.endsWith("/*")) {
      return file.type.startsWith(token.slice(0, -1));
    }
    return file.type === token;
  });
}

export function FileDropZone({ accept, label, hint, fileName, onFile }: Props) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const applyFile = useCallback(
    (file: File | undefined | null) => {
      if (!file) return;
      if (!fileMatchesAccept(file, accept)) return;
      onFile(file);
    },
    [accept, onFile],
  );

  const handleDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    applyFile(e.dataTransfer.files?.[0]);
  };

  return (
    <label
      htmlFor={inputId}
      className={`file-drop-zone${dragging ? " dragging" : ""}${fileName ? " has-file" : ""}`}
      onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(true); }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(true); }}
      onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(false); }}
      onDrop={handleDrop}
    >
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept={accept}
        className="file-drop-zone-input"
        onChange={(e) => {
          applyFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <span className="file-drop-zone-icon">{fileName ? "📄" : "⬇️"}</span>
      <span className="file-drop-zone-label">
        {fileName ? fileName : label}
      </span>
      <span className="file-drop-zone-hint">
        {fileName
          ? "Solte outro arquivo para substituir, ou clique para escolher"
          : (hint ?? "Arraste e solte aqui, ou clique para selecionar")}
      </span>
    </label>
  );
}
