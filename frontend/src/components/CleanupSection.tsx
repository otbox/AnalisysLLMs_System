// components/CleanupSection.tsx
import React from "react";

interface Props {
  idsToRemoveInput: string;
  onInputChange: (val: string) => void;
  detectedIds: string[];
  selectedIdsToRemove: Set<string>;
  onToggleId: (id: string) => void;
}

export function CleanupSection({
  idsToRemoveInput,
  onInputChange,
  detectedIds,
  selectedIdsToRemove,
  onToggleId,
}: Props) {
  return (
    <div className="panel-section">
      <h2 className="section-title">🧹 Limpeza</h2>
      <div className="ids-section">
        <label className="ids-section-label">
          IDs para remover do JSON limpo{" "}
          <span style={{ fontWeight: 400, color: "var(--text-tertiary)" }}>
            (separados por vírgula)
          </span>
        </label>
        <input
          className="ids-input"
          placeholder="ex: menu_hamburger_top, accessibility_icon_main"
          value={idsToRemoveInput}
          onChange={(e) => onInputChange(e.target.value)}
        />
        {detectedIds.length > 0 && (
          <>
            <label className="ids-section-label">
              Clique para marcar componentes detectados:
            </label>
            <div className="ids-chips">
              {detectedIds.map((id) => (
                <span
                  key={id}
                  className={`id-chip ${selectedIdsToRemove.has(id) ? "selected" : ""}`}
                  onClick={() => onToggleId(id)}
                >
                  {selectedIdsToRemove.has(id) ? "✕ " : ""}
                  {id}
                </span>
              ))}
            </div>
            {selectedIdsToRemove.size > 0 && (
              <span className="ids-counter">
                {selectedIdsToRemove.size} componente(s) serão removidos
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
