import json
from pathlib import Path
from typing import Any, Dict, Optional

# -----------------------------
# 1) Util: parse de JSON "stringificado" em rawResponse...text
# -----------------------------
def safe_json_loads_maybe(x: Any) -> Optional[Any]:
    if not isinstance(x, str):
        return None
    s = x.strip()
    if not s:
        return None
    try:
        return json.loads(s)  # json.loads converte string JSON em objetos Python [web:26]
    except Exception:
        return None

# -----------------------------
# 2) Contador: pai + subcomponentes (recursivo)
# Regra: todo dict que tem 'id' e 'type' conta como 1 componente.
# Isso inclui menu_bar (1) + menu_items (N) + qualquer outro aninhado em meta.* [web:38]
# -----------------------------
def count_components_anywhere(root: Any) -> int:
    count = 0
    stack = [root]

    while stack:
        x = stack.pop()

        if isinstance(x, dict):
            if "id" in x and "type" in x:
                count += 1
            for v in x.values():
                if isinstance(v, (dict, list)):
                    stack.append(v)

        elif isinstance(x, list):
            for item in x:
                if isinstance(item, (dict, list)):
                    stack.append(item)

    return count

# -----------------------------
# 3) Extrair as "raízes" contáveis (ignora wrapper)
# - Se tiver data["ui"], usa ui
# - Se não tiver ui, tenta rawResponse.candidates[0].content.parts[0].text (lista JSON stringificada)
# - Se você também tiver ui_structure/filhos (seu outro formato), suporta também [file:1]
# -----------------------------
def extract_roots_to_count(data: Any) -> Dict[str, Any]:
    roots: Dict[str, Any] = {}
    if not isinstance(data, dict):
        return roots

    # Formato "ui" (exemplo do LibreOffice)
    if isinstance(data.get("ui"), list):
        roots["ui"] = data["ui"]

    # Formato "ui_structure" (seu arquivo original) [file:1]
    if isinstance(data.get("ui_structure"), list):
        roots["ui_structure"] = data["ui_structure"]

    # rawResponse...text com JSON stringificado
    raw = data.get("rawResponse")
    if isinstance(raw, dict):
        candidates = raw.get("candidates")
        if isinstance(candidates, list) and candidates:
            content = candidates[0].get("content", {})
            parts = content.get("parts")
            if isinstance(parts, list) and parts:
                txt = parts[0].get("text")
                parsed = safe_json_loads_maybe(txt)
                if parsed is not None:
                    roots["raw_text"] = parsed

    return roots

# -----------------------------
# 4) Analisar 1 arquivo:
# Retorna dois números no JSON:
# - components.wrapper: numberofComponents (se existir)
# - components.detectado: contagem recursiva real (pai+subcomponentes)
# Também retorna detectado_por_origem quando houver mais de uma raiz.
# -----------------------------
def analyze_json_file(fp: Path) -> Dict[str, Any]:
    data = json.loads(fp.read_text(encoding="utf-8"))

    wrapper = data.get("numberofComponents") if isinstance(data, dict) else None
    roots = extract_roots_to_count(data)

    detected_by_origin: Dict[str, int] = {}
    for origin, root in roots.items():
        detected_by_origin[origin] = count_components_anywhere(root)

    # Prioridade: ui > ui_structure > raw_text
    detected = None
    for key in ("ui", "ui_structure", "raw_text"):
        if key in detected_by_origin:
            detected = detected_by_origin[key]
            break

    return {
        "components": {
            "wrapper": wrapper,
            "detectado": detected,
            "detectado_por_origem": detected_by_origin,
            "diverge": (wrapper is not None and detected is not None and wrapper != detected),
        }
    }

# -----------------------------
# 5) Varrer pasta e subpastas (americanas/bis/...)
# rglob é recursivo [web:4]
# -----------------------------
def build_folder_report(root_dir: str) -> Dict[str, Any]:
    root_path = Path(root_dir)
    out: Dict[str, Any] = {"pasta": str(root_path.resolve()), "arquivos": {}}

    for fp in root_path.rglob("*.json"):  # recursivo [web:4]
        if not fp.is_file():
            continue

        rel = str(fp.relative_to(root_path))
        try:
            out["arquivos"][rel] = analyze_json_file(fp)
        except Exception as e:
            out["arquivos"][rel] = {"erro": str(e)}

    return out

if __name__ == "__main__":
    # Exemplo: entra em "americanas" e analisa todos os JSON dentro (inclusive subpastas tipo americanas/bis/)
    report = build_folder_report("PrefeituraLimeira")

    Path("relatorio_componentes.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
