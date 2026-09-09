# Magic Paint の旧バックエンド（現在は使っていない）。
# アプリは静的サイトとして動くようになり、プロジェクト保存はファイル、
# MODはZIP、AIはブラウザから各社APIへ直接送るようになった。
# 動かす場合の依存: Flask==2.2.5 / Werkzeug==2.2.3 / PyMySQL==1.1.0
from flask import Flask, request, jsonify, send_from_directory
import pymysql, json, time, os
from pathlib import Path
from lolipop_config import DB_HOST, DB_USER, DB_PASSWORD, DB_NAME

app = Flask(__name__, static_folder=".", static_url_path="")

@app.after_request
def add_no_cache_headers(response):
    if request.path == "/" or request.path.endswith((".html", ".js", ".css")):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

def get_db():
    return pymysql.connect(
        host=DB_HOST,
        user=DB_USER,
        password=DB_PASSWORD,
        database=DB_NAME,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=True
    )

def init_db():
    with get_db() as con:
        with con.cursor() as cur:
            cur.execute("""
            CREATE TABLE IF NOT EXISTS projects (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                data LONGTEXT NOT NULL,
                thumbnail LONGTEXT,
                updated_at DATETIME NOT NULL
            ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
            """)

init_db()

# ── AI Framework ──────────────────────────────────────────────
from ai_api import init_ai
init_ai(app, get_db)

@app.route("/")
def index():
    return send_from_directory(".", "index.html")

@app.route("/<path:path>")
def static_files(path):
    return send_from_directory(".", path)

@app.route("/projects", methods=["GET"])
def list_projects():
    with get_db() as con:
        with con.cursor() as cur:
            cur.execute("SELECT id, name, thumbnail, updated_at FROM projects ORDER BY id DESC")
            rows = cur.fetchall()
    return jsonify(rows)

@app.route("/projects/<int:project_id>", methods=["GET"])
def get_project(project_id):
    with get_db() as con:
        with con.cursor() as cur:
            cur.execute(
                "SELECT id, name, data, thumbnail, updated_at FROM projects WHERE id=%s",
                (project_id,)
            )
            row = cur.fetchone()
    if not row:
        return jsonify({"error": "not found"}), 404
    row["data"] = json.loads(row["data"])
    return jsonify(row)

@app.route("/projects", methods=["POST"])
def create_project():
    body = request.get_json(force=True)
    name       = body.get("name") or "無題"
    data       = body.get("data") or {}
    thumbnail  = body.get("thumbnail")
    updated_at = time.strftime("%Y-%m-%d %H:%M:%S")
    with get_db() as con:
        with con.cursor() as cur:
            cur.execute(
                "INSERT INTO projects(name, data, thumbnail, updated_at) VALUES(%s,%s,%s,%s)",
                (name, json.dumps(data, ensure_ascii=False), thumbnail, updated_at)
            )
            pid = cur.lastrowid
    return jsonify({"ok": True, "id": pid})

@app.route("/projects/<int:project_id>", methods=["PUT"])
def update_project(project_id):
    body = request.get_json(force=True)
    name       = body.get("name") or "無題"
    data       = body.get("data") or {}
    thumbnail  = body.get("thumbnail")
    updated_at = time.strftime("%Y-%m-%d %H:%M:%S")
    with get_db() as con:
        with con.cursor() as cur:
            cur.execute(
                "UPDATE projects SET name=%s, data=%s, thumbnail=%s, updated_at=%s WHERE id=%s",
                (name, json.dumps(data, ensure_ascii=False), thumbnail, updated_at, project_id)
            )
    return jsonify({"ok": True, "id": project_id})

@app.route("/projects/<int:project_id>", methods=["DELETE"])
def delete_project(project_id):
    with get_db() as con:
        with con.cursor() as cur:
            cur.execute("DELETE FROM projects WHERE id=%s", (project_id,))
    return jsonify({"ok": True})

@app.route("/api/projects", methods=["GET", "POST"])
def api_projects():
    return list_projects() if request.method == "GET" else create_project()

@app.route("/api/projects/<int:project_id>", methods=["GET", "PUT", "DELETE"])
def api_project(project_id):
    if request.method == "GET":  return get_project(project_id)
    if request.method == "PUT":  return update_project(project_id)
    return delete_project(project_id)

# ── MOD API ───────────────────────────────────────────────────
MODS_DIR = Path(__file__).parent / "mods"

@app.route("/api/mods", methods=["GET"])
def list_mods():
    mods = []
    MODS_DIR.mkdir(exist_ok=True)
    for mod_dir in sorted(MODS_DIR.iterdir()):
        if not mod_dir.is_dir():
            continue
        manifest_path = mod_dir / "mod.json"
        if not manifest_path.exists():
            continue
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception as e:
            mods.append({"id": mod_dir.name, "enabled": False, "error": f"mod.json error: {e}"})
            continue
        manifest["enabled"]  = manifest.get("enabled", True)
        manifest["id"]       = manifest.get("id") or mod_dir.name
        manifest["base_url"] = f"/mods/{mod_dir.name}"
        manifest["scripts"]  = [f"/mods/{mod_dir.name}/{s}" for s in manifest.get("scripts", [])]
        manifest["styles"]   = [f"/mods/{mod_dir.name}/{s}" for s in manifest.get("styles", [])]
        mods.append(manifest)
    return jsonify(mods)

@app.route("/api/mods/<mod_id>/toggle", methods=["POST"])
def toggle_mod(mod_id):
    manifest_path = MODS_DIR / mod_id / "mod.json"
    if not manifest_path.exists():
        return jsonify({"ok": False, "error": "MODが見つかりません"}), 404
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["enabled"] = not manifest.get("enabled", True)
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        return jsonify({"ok": True, "id": mod_id, "enabled": manifest["enabled"]})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route("/mods/<path:filename>", methods=["GET"])
def serve_mod_file(filename):
    return send_from_directory(MODS_DIR, filename)

if __name__ == "__main__":
    app.run(debug=True, port=5000)
