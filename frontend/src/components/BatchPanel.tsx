// components/BatchPanel.tsx
import React from "react";
import type { QueueItem } from "../types";

interface Props {
  queue: QueueItem[];
  isProcessing: boolean;
  onFolderChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onStart: () => void;
  onClear: () => void;
}

const STATUS_LABEL: Record<QueueItem["status"], string> = {
  pending: "Aguardando",
  running: "Processando...",
  done: "Concluído",
  error: "Erro",
};

export function BatchPanel({ queue, isProcessing, onFolderChange, onStart, onClear }: Props) {
  const counts = {
    total: queue.length,
    done: queue.filter((i) => i.status === "done").length,
    pending: queue.filter((i) => i.status === "pending").length,
    running: queue.filter((i) => i.status === "running").length,
    error: queue.filter((i) => i.status === "error").length,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-md)" }}>
      <div className="results-header">
        <div className="input-group" style={{ flex: 1 }}>
          <label className="input-label">Selecionar pasta de imagens</label>
          {/* @ts-ignore */}
          <input
            type="file"
            accept="image/*"
            multiple
            webkitdirectory=""
            className="input-field"
            onChange={onFolderChange}
          />
          <span style={{ fontSize: "0.78rem", color: "var(--text-tertiary)" }}>
            Todas as imagens da pasta entrarão na fila automaticamente
          </span>
        </div>
      </div>

      {queue.length === 0 ? (
        <div className="batch-empty">
          <span className="batch-empty-icon">📁</span>
          <p>Nenhuma imagem na fila.</p>
          <p>Selecione uma pasta acima para começar.</p>
        </div>
      ) : (
        <>
          <div className="batch-summary">
            <span>Total: <strong>{counts.total}</strong></span>
            <span>✅ <strong>{counts.done}</strong></span>
            <span>⏳ <strong>{counts.pending}</strong></span>
            <span>🔄 <strong>{counts.running}</strong></span>
            <span>❌ <strong>{counts.error}</strong></span>
          </div>

          <div className="batch-queue-list">
            {queue.map((item) => (
              <div key={item.id} className={`batch-item ${item.status}`}>
                <span className={`batch-status-badge ${item.status}`}>
                  {STATUS_LABEL[item.status]}
                </span>
                <span className="batch-item-name">{item.fileName}</span>
                {item.status === "done" && item.response && (
                  <span className="batch-item-info">
                    {item.response.results.filter((r) => r.status === "success").length} ok
                  </span>
                )}
                {item.status === "error" && (
                  <span className="batch-item-info" style={{ color: "var(--danger)" }}>
                    {item.error}
                  </span>
                )}
              </div>
            ))}
          </div>

          <div className="batch-actions">
            <button
              className="btn-primary purple"
              onClick={onStart}
              disabled={isProcessing || counts.pending === 0}
            >
              {isProcessing ? "⏳ Processando fila..." : "▶️ Iniciar fila"}
            </button>
            <button className="btn-danger" onClick={onClear} disabled={isProcessing}>
              🗑️ Limpar fila
            </button>
          </div>
        </>
      )}
    </div>
  );
}
