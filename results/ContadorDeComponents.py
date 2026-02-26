import json
from pathlib import Path
from typing import Any, Dict, List, Optional

def iter_nodes(obj: Any, children_keys: List[str]) -> List[dict]:
    found = []

    def walk(x: Any):
        if isinstance(x, dict):
            found.append(x)
            for ck in children_keys:
                v = x.get(ck)
                if isinstance(v, list):
                    for child in v:
                        walk(child)
            for v in x.values():
                if isinstance(v, (dict, list)):
                    walk(v)
        elif isinstance(x, list):
            for item in x:
                walk(item)

    walk(obj)
    return found

def count_components(data: Any, root_key: Optional[str], children_keys: List[str]) -> int:
    root = data
    if root_key and isinstance(data, dict) and root_key in data:
        root = data[root_key]
    nodes = iter_nodes(root, children_keys)
    return sum(1 for n in nodes if isinstance(n, dict))

def build_folder_report(root_dir: str,
                        json_glob: str = "*.json",
                        root_key: str = "ui_structure",
                        children_keys: Optional[List[str]] = None) -> Dict[str, Any]:
    """
    Retorna um JSON estilo "pasta" com os arquivos .json encontrados recursivamente.
    """
    children_keys = children_keys or ["filhos"]
    root_path = Path(root_dir)

    out = {"pasta": str(root_path.resolve()), "arquivos": {}}

    # pega todos os JSON dentro da pasta e subpastas (americanas/bis/... etc)
    for fp in root_path.rglob(json_glob):  # rglob é recursivo [web:4][web:5]
        if not fp.is_file():
            continue

        try:
            data = json.loads(fp.read_text(encoding="utf-8"))
            comp = count_components(data, root_key=root_key, children_keys=children_keys)
            rel = str(fp.relative_to(root_path))
            out["arquivos"][rel] = {"components": comp}
        except Exception as e:
            rel = str(fp.relative_to(root_path))
            out["arquivos"][rel] = {"erro": str(e)}

    return out

if __name__ == "__main__":
    # Exemplo: entra em americanas/ e pega qualquer json em qualquer subdiretório (inclui americanas/bis/)
    report = build_folder_report(
        root_dir="Americanas",
        json_glob="*.json",
        root_key="ui_structure",
        children_keys=["filhos"]
    )

    Path("relatorio_componentes.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
