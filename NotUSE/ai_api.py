# -*- coding: utf-8 -*-
# ══════════════════════════════════════════════════════════════
# Magic Paint AI Framework v2 - バックエンド
#
#  - Python 3.7 対応（match / := / list[str] / removeprefix 等は不使用）
#  - OpenAI / Gemini / Claude / Grok に urllib.request で直接送信（SDK不使用）
#  - Vision対応（画像添付: キャンバスのスクリーンショット等）
#  - 会話履歴のDB保存 / 使用統計ログ / 接続テスト / AI生成MODインストール
#  - APIキーはMySQLに保存し、ログ・エラーには絶対に出さない
#
#  app.py から:
#      from ai_api import init_ai
#      init_ai(app, get_db)
# ══════════════════════════════════════════════════════════════
import json
import re
import time
import base64
import urllib.request
import urllib.error
from pathlib import Path

from flask import request, jsonify

# ── プロバイダー定義 ──────────────────────────────────────────
PROVIDERS = {
    "openai": {
        "label": "OpenAI",
        "default_model": "gpt-4o-mini",
        "models": ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"],
        "vision": True,
    },
    "gemini": {
        "label": "Gemini",
        "default_model": "gemini-2.0-flash",
        "models": ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"],
        "vision": True,
    },
    "claude": {
        "label": "Claude",
        "default_model": "claude-sonnet-4-5",
        "models": ["claude-sonnet-4-5", "claude-haiku-4-5", "claude-opus-4-1"],
        "vision": True,
    },
    "grok": {
        "label": "Grok",
        "default_model": "grok-3-mini",
        "models": ["grok-3-mini", "grok-3", "grok-2-vision"],
        "vision": True,
    },
}

HTTP_TIMEOUT = 90       # 秒
MAX_TOKENS = 4096
MAX_IMAGE_BYTES = 4 * 1024 * 1024   # 添付画像1枚あたり4MB
MAX_MOD_FILE_BYTES = 300 * 1024     # MODファイル1つあたり300KB
MOD_ID_RE = re.compile(r"^[a-z0-9_]{1,40}$")

# ── AIへ渡すシステムプロンプト ────────────────────────────────
SYSTEM_PROMPT = """あなたは「Magic Paint」というブラウザ製2D/3Dアニメーションツールに組み込まれたAIアシスタントです。
ユーザーの指示に従い、Canvas API / Three.js / Magic Paint内部API のコードを生成します。
ユーザーがキャンバスの画像を添付した場合は、その内容を分析して感想・改善案・コードを提案してください。

## 実行環境
生成した JavaScript は以下の引数を持つ関数の中身として実行されます。
  ctx    : CanvasRenderingContext2D（メインキャンバスの2Dコンテキスト）
  canvas : HTMLCanvasElement
  width  : キャンバス幅(px)
  height : キャンバス高さ(px)
  api    : window.AnimationApp（Magic Paint MOD API）
  t      : アニメーション時刻(秒)。コードは毎フレーム呼ばれるので t を使うと動きが作れる

## Magic Paint API（api = window.AnimationApp）
- api.addShape(shape)         図形を追加 { type:'rect', x,y,w,h } / { type:'circle', cx,cy,rx,ry } など
- api.addObject(obj)          Three.js等のオブジェクト追加 { type, engine:'threejs', ... }
- api.createLayer({name})     レイヤー追加
- api.getSelected()           選択中図形を取得
- api.setSelectedPatch(patch) 選択中図形を変更
- api.getSceneSnapshot()      シーン全体 { width, height, bg, fps, shapes } を取得
- api.registerShapeType(type, {draw(ctx,s), getBounds(s)})  カスタム図形登録
- api.registerBrush({id,name,icon,onStart,onMove,onEnd})    カスタムブラシ登録
- api.registerTool({id,name,icon}) / api.registerUI({id,position,title,html,onMount})
- api.redraw() / api.toast(icon,msg) / api.setStatus(msg)

## 図形フォーマット例
rect:     { type:'rect', x, y, w, h, color:'#3B8AE6', sw:2, fill:true, opa:100 }
circle:   { type:'circle', cx, cy, rx, ry, color, sw, fill }
triangle: { type:'triangle', cx, cy, r, rot:0 }
polygon:  { type:'polygon', cx, cy, r, sides:6 }
line:     { type:'line', x1, y1, x2, y2 }
pen:      { type:'pen', pts:[{x,y},...], closed:false }

## MOD生成を頼まれた場合
main.js のコードを1つのコードブロックで出力してください。先頭で必ず
  const api = window.AnimationApp;
  api.registerMod({ id:"...", name:"...", version:"1.0.0", description:"..." });
を呼び、その後に registerBrush / registerTool / registerShapeType 等を書きます。

## 回答ルール
1. 回答は日本語で簡潔に。
2. コードは必ず ```javascript フェンスで囲んだ1つのコードブロックにまとめる。
3. 描画コードは ctx に直接描く（毎フレーム呼ばれる前提。requestAnimationFrame や無限ループは書かない）。
4. fetch / XMLHttpRequest / localStorage / sessionStorage / document.cookie / eval / import は使用しない。
5. DOM操作は避け、描画は ctx / api 経由で行う（MOD生成時のUI登録は除く）。
6. ユーザーから「シーン情報」「選択図形」のJSONが渡された場合は、それを踏まえて座標や色を決める。
"""


# ══════════════════════════════════════════════════════════════
# ユーティリティ
# ══════════════════════════════════════════════════════════════
def mask_key(key):
    """APIキーをマスク表示用に変換する"""
    if not key:
        return ""
    if len(key) <= 8:
        return "*" * len(key)
    return key[:4] + "*" * 8 + key[-4:]


def sanitize_error(text, api_key):
    """エラーメッセージにAPIキーが含まれないよう除去する"""
    if not text:
        return ""
    text = str(text)
    if api_key:
        text = text.replace(api_key, "***")
    if len(text) > 600:
        text = text[:600] + "..."
    return text


def now_str():
    return time.strftime("%Y-%m-%d %H:%M:%S")


def parse_data_url(data_url):
    """'data:image/png;base64,xxx' → (mime, base64str) / 不正なら (None, None)"""
    if not isinstance(data_url, str) or not data_url.startswith("data:"):
        return None, None
    try:
        head, b64 = data_url.split(",", 1)
        mime = head[5:].split(";")[0] or "image/png"
        if not mime.startswith("image/"):
            return None, None
        # サイズチェック（base64は約4/3倍）
        if len(b64) > MAX_IMAGE_BYTES * 4 // 3:
            return None, None
        base64.b64decode(b64[:64])  # ざっくり妥当性確認
        return mime, b64
    except Exception:
        return None, None


def http_post_json(url, payload, headers):
    """urllib で JSON を POST し、(status, dict) を返す"""
    data = json.dumps(payload).encode("utf-8")
    req_headers = {"Content-Type": "application/json"}
    req_headers.update(headers)
    req = urllib.request.Request(url, data=data, headers=req_headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as res:
            body = res.read().decode("utf-8", "replace")
            return res.getcode(), json.loads(body)
    except urllib.error.HTTPError as e:
        try:
            body = e.read().decode("utf-8", "replace")
            parsed = json.loads(body)
        except Exception:
            parsed = {"error": {"message": "HTTP %d" % e.code}}
        return e.code, parsed
    except urllib.error.URLError as e:
        return 0, {"error": {"message": "接続エラー: %s" % getattr(e, "reason", "unknown")}}
    except Exception as e:
        return 0, {"error": {"message": "通信エラー: %s" % e.__class__.__name__}}


def extract_error_message(parsed):
    if not isinstance(parsed, dict):
        return "unknown error"
    err = parsed.get("error")
    if isinstance(err, dict):
        return err.get("message") or json.dumps(err, ensure_ascii=False)
    if isinstance(err, str):
        return err
    return json.dumps(parsed, ensure_ascii=False)[:300]


# ══════════════════════════════════════════════════════════════
# 各プロバイダー呼び出し（Vision対応）
#   messages: [{ role, content, images:[dataURL] }]  ※imagesは省略可
# ══════════════════════════════════════════════════════════════
def _openai_messages(messages):
    out = [{"role": "system", "content": SYSTEM_PROMPT}]
    for m in messages:
        images = m.get("images") or []
        if images and m["role"] == "user":
            parts = [{"type": "text", "text": m["content"]}]
            for img in images:
                mime, b64 = parse_data_url(img)
                if mime:
                    parts.append({
                        "type": "image_url",
                        "image_url": {"url": "data:%s;base64,%s" % (mime, b64)},
                    })
            out.append({"role": "user", "content": parts})
        else:
            out.append({"role": m["role"], "content": m["content"]})
    return out


def call_openai_compat(base_url, api_key, model, messages, temperature):
    payload = {
        "model": model,
        "max_tokens": MAX_TOKENS,
        "messages": _openai_messages(messages),
    }
    if temperature is not None:
        payload["temperature"] = temperature
    headers = {"Authorization": "Bearer " + api_key}
    status, parsed = http_post_json(base_url, payload, headers)
    if status != 200:
        return None, extract_error_message(parsed)
    try:
        return parsed["choices"][0]["message"]["content"], None
    except (KeyError, IndexError, TypeError):
        return None, "レスポンス解析に失敗しました"


def call_gemini(api_key, model, messages, temperature):
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        + model + ":generateContent?key=" + api_key
    )
    contents = []
    for m in messages:
        role = "model" if m.get("role") == "assistant" else "user"
        parts = [{"text": m.get("content", "")}]
        for img in (m.get("images") or []):
            mime, b64 = parse_data_url(img)
            if mime:
                parts.append({"inline_data": {"mime_type": mime, "data": b64}})
        contents.append({"role": role, "parts": parts})
    gen_cfg = {"maxOutputTokens": MAX_TOKENS}
    if temperature is not None:
        gen_cfg["temperature"] = temperature
    payload = {
        "system_instruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": contents,
        "generationConfig": gen_cfg,
    }
    status, parsed = http_post_json(url, payload, {})
    if status != 200:
        return None, extract_error_message(parsed)
    try:
        parts = parsed["candidates"][0]["content"]["parts"]
        return "".join(p.get("text", "") for p in parts), None
    except (KeyError, IndexError, TypeError):
        return None, "レスポンス解析に失敗しました"


def call_claude(api_key, model, messages, temperature):
    url = "https://api.anthropic.com/v1/messages"
    msgs = []
    for m in messages:
        images = m.get("images") or []
        if images and m["role"] == "user":
            parts = []
            for img in images:
                mime, b64 = parse_data_url(img)
                if mime:
                    parts.append({
                        "type": "image",
                        "source": {"type": "base64", "media_type": mime, "data": b64},
                    })
            parts.append({"type": "text", "text": m["content"]})
            msgs.append({"role": "user", "content": parts})
        else:
            msgs.append({"role": m["role"], "content": m["content"]})
    payload = {
        "model": model,
        "max_tokens": MAX_TOKENS,
        "system": SYSTEM_PROMPT,
        "messages": msgs,
    }
    if temperature is not None:
        payload["temperature"] = min(max(temperature, 0.0), 1.0)
    headers = {"x-api-key": api_key, "anthropic-version": "2023-06-01"}
    status, parsed = http_post_json(url, payload, headers)
    if status != 200:
        return None, extract_error_message(parsed)
    try:
        blocks = parsed.get("content", [])
        return "".join(b.get("text", "") for b in blocks if b.get("type") == "text"), None
    except (KeyError, TypeError):
        return None, "レスポンス解析に失敗しました"


def call_provider(provider, api_key, model, messages, temperature=None):
    """(text, error_message) を返す"""
    if provider == "openai":
        return call_openai_compat("https://api.openai.com/v1/chat/completions",
                                  api_key, model, messages, temperature)
    if provider == "grok":
        return call_openai_compat("https://api.x.ai/v1/chat/completions",
                                  api_key, model, messages, temperature)
    if provider == "gemini":
        return call_gemini(api_key, model, messages, temperature)
    if provider == "claude":
        return call_claude(api_key, model, messages, temperature)
    return None, "未対応のプロバイダーです"


# ══════════════════════════════════════════════════════════════
# Flask ルート登録
# ══════════════════════════════════════════════════════════════
def init_ai(app, get_db):

    mods_dir = Path(__file__).parent / "mods"

    # ── テーブル ──────────────────────────────────────────────
    def init_tables():
        try:
            with get_db() as con:
                with con.cursor() as cur:
                    cur.execute("""
                    CREATE TABLE IF NOT EXISTS ai_settings (
                        provider   VARCHAR(32) PRIMARY KEY,
                        api_key    TEXT NOT NULL,
                        model      VARCHAR(128),
                        updated_at DATETIME NOT NULL
                    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
                    """)
                    cur.execute("""
                    CREATE TABLE IF NOT EXISTS ai_conversations (
                        id         INT AUTO_INCREMENT PRIMARY KEY,
                        title      VARCHAR(255) NOT NULL,
                        provider   VARCHAR(32),
                        created_at DATETIME NOT NULL,
                        updated_at DATETIME NOT NULL
                    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
                    """)
                    cur.execute("""
                    CREATE TABLE IF NOT EXISTS ai_messages (
                        id              INT AUTO_INCREMENT PRIMARY KEY,
                        conversation_id INT NOT NULL,
                        role            VARCHAR(16) NOT NULL,
                        content         LONGTEXT NOT NULL,
                        images          LONGTEXT,
                        created_at      DATETIME NOT NULL,
                        INDEX idx_conv (conversation_id)
                    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
                    """)
                    cur.execute("""
                    CREATE TABLE IF NOT EXISTS ai_logs (
                        id             INT AUTO_INCREMENT PRIMARY KEY,
                        provider       VARCHAR(32) NOT NULL,
                        model          VARCHAR(128),
                        prompt_chars   INT DEFAULT 0,
                        response_chars INT DEFAULT 0,
                        image_count    INT DEFAULT 0,
                        duration_ms    INT DEFAULT 0,
                        ok             TINYINT DEFAULT 1,
                        created_at     DATETIME NOT NULL
                    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
                    """)
        except Exception:
            # DB未接続時でも import は失敗させない（リクエスト時に再試行）
            pass

    init_tables()

    def load_setting(provider):
        with get_db() as con:
            with con.cursor() as cur:
                cur.execute(
                    "SELECT provider, api_key, model FROM ai_settings WHERE provider=%s",
                    (provider,)
                )
                return cur.fetchone()

    # ══════════════════════════════════════════════════════════
    # APIキー管理
    # ══════════════════════════════════════════════════════════
    @app.route("/api/ai/keys", methods=["GET"])
    def ai_list_keys():
        init_tables()
        rows = {}
        with get_db() as con:
            with con.cursor() as cur:
                cur.execute("SELECT provider, api_key, model FROM ai_settings")
                for r in cur.fetchall():
                    rows[r["provider"]] = r
        result = []
        for pid in PROVIDERS:
            info = PROVIDERS[pid]
            row = rows.get(pid)
            result.append({
                "provider": pid,
                "label": info["label"],
                "models": info["models"],
                "default_model": info["default_model"],
                "vision": info.get("vision", False),
                "has_key": bool(row),
                "masked_key": mask_key(row["api_key"]) if row else "",
                "model": (row.get("model") if row else None) or info["default_model"],
            })
        return jsonify(result)

    @app.route("/api/ai/keys", methods=["POST"])
    def ai_save_key():
        init_tables()
        body = request.get_json(force=True, silent=True) or {}
        provider = (body.get("provider") or "").strip().lower()
        api_key = (body.get("api_key") or "").strip()
        model = (body.get("model") or "").strip() or None

        if provider not in PROVIDERS:
            return jsonify({"ok": False, "error": "不明なプロバイダーです"}), 400
        if not api_key:
            return jsonify({"ok": False, "error": "APIキーが空です"}), 400
        if len(api_key) > 512:
            return jsonify({"ok": False, "error": "APIキーが長すぎます"}), 400

        with get_db() as con:
            with con.cursor() as cur:
                cur.execute("""
                    INSERT INTO ai_settings(provider, api_key, model, updated_at)
                    VALUES(%s,%s,%s,%s)
                    ON DUPLICATE KEY UPDATE
                        api_key=VALUES(api_key),
                        model=VALUES(model),
                        updated_at=VALUES(updated_at)
                """, (provider, api_key, model, now_str()))
        return jsonify({"ok": True, "provider": provider, "masked_key": mask_key(api_key)})

    @app.route("/api/ai/keys/<provider>/model", methods=["POST"])
    def ai_save_model(provider):
        body = request.get_json(force=True, silent=True) or {}
        model = (body.get("model") or "").strip()
        if provider not in PROVIDERS or not model or len(model) > 128:
            return jsonify({"ok": False, "error": "パラメータが不正です"}), 400
        with get_db() as con:
            with con.cursor() as cur:
                cur.execute(
                    "UPDATE ai_settings SET model=%s WHERE provider=%s",
                    (model, provider)
                )
        return jsonify({"ok": True})

    @app.route("/api/ai/keys/<provider>", methods=["DELETE"])
    def ai_delete_key(provider):
        with get_db() as con:
            with con.cursor() as cur:
                cur.execute("DELETE FROM ai_settings WHERE provider=%s", (provider,))
        return jsonify({"ok": True})

    # ── 接続テスト ─────────────────────────────────────────────
    @app.route("/api/ai/test", methods=["POST"])
    def ai_test():
        body = request.get_json(force=True, silent=True) or {}
        provider = (body.get("provider") or "").strip().lower()
        if provider not in PROVIDERS:
            return jsonify({"ok": False, "error": "不明なプロバイダーです"}), 400
        row = load_setting(provider)
        if not row:
            return jsonify({"ok": False, "error": "APIキーが未登録です"}), 400
        model = (body.get("model") or "").strip() or row.get("model") \
            or PROVIDERS[provider]["default_model"]
        start = time.time()
        text, err = call_provider(
            provider, row["api_key"], model,
            [{"role": "user", "content": "接続テストです。「OK」とだけ返してください。"}],
        )
        ms = int((time.time() - start) * 1000)
        if err is not None:
            return jsonify({
                "ok": False,
                "error": sanitize_error(err, row["api_key"]),
                "duration_ms": ms,
            }), 502
        return jsonify({"ok": True, "model": model, "duration_ms": ms,
                        "reply": (text or "")[:100]})

    # ══════════════════════════════════════════════════════════
    # 会話履歴
    # ══════════════════════════════════════════════════════════
    @app.route("/api/ai/conversations", methods=["GET"])
    def ai_list_conversations():
        init_tables()
        with get_db() as con:
            with con.cursor() as cur:
                cur.execute("""
                    SELECT c.id, c.title, c.provider, c.updated_at,
                           (SELECT COUNT(*) FROM ai_messages m
                             WHERE m.conversation_id = c.id) AS message_count
                    FROM ai_conversations c
                    ORDER BY c.updated_at DESC
                    LIMIT 100
                """)
                rows = cur.fetchall()
        return jsonify(rows)

    @app.route("/api/ai/conversations/<int:conv_id>", methods=["GET"])
    def ai_get_conversation(conv_id):
        with get_db() as con:
            with con.cursor() as cur:
                cur.execute("SELECT id, title, provider FROM ai_conversations WHERE id=%s",
                            (conv_id,))
                conv = cur.fetchone()
                if not conv:
                    return jsonify({"error": "not found"}), 404
                cur.execute("""
                    SELECT role, content, images, created_at FROM ai_messages
                    WHERE conversation_id=%s ORDER BY id ASC
                """, (conv_id,))
                msgs = cur.fetchall()
        for m in msgs:
            if m.get("images"):
                try:
                    m["images"] = json.loads(m["images"])
                except Exception:
                    m["images"] = []
            else:
                m["images"] = []
        conv["messages"] = msgs
        return jsonify(conv)

    @app.route("/api/ai/conversations/<int:conv_id>", methods=["PUT"])
    def ai_rename_conversation(conv_id):
        body = request.get_json(force=True, silent=True) or {}
        title = (body.get("title") or "").strip()[:255]
        if not title:
            return jsonify({"ok": False, "error": "タイトルが空です"}), 400
        with get_db() as con:
            with con.cursor() as cur:
                cur.execute("UPDATE ai_conversations SET title=%s, updated_at=%s WHERE id=%s",
                            (title, now_str(), conv_id))
        return jsonify({"ok": True})

    @app.route("/api/ai/conversations/<int:conv_id>", methods=["DELETE"])
    def ai_delete_conversation(conv_id):
        with get_db() as con:
            with con.cursor() as cur:
                cur.execute("DELETE FROM ai_messages WHERE conversation_id=%s", (conv_id,))
                cur.execute("DELETE FROM ai_conversations WHERE id=%s", (conv_id,))
        return jsonify({"ok": True})

    def _save_message(cur, conv_id, role, content, images):
        cur.execute("""
            INSERT INTO ai_messages(conversation_id, role, content, images, created_at)
            VALUES(%s,%s,%s,%s,%s)
        """, (conv_id, role, content,
              json.dumps(images) if images else None, now_str()))

    # ══════════════════════════════════════════════════════════
    # 使用統計
    # ══════════════════════════════════════════════════════════
    @app.route("/api/ai/stats", methods=["GET"])
    def ai_stats():
        init_tables()
        with get_db() as con:
            with con.cursor() as cur:
                cur.execute("""
                    SELECT provider,
                           COUNT(*)                AS calls,
                           SUM(ok)                 AS success,
                           SUM(prompt_chars)       AS prompt_chars,
                           SUM(response_chars)     AS response_chars,
                           SUM(image_count)        AS images,
                           AVG(duration_ms)        AS avg_ms
                    FROM ai_logs
                    WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                    GROUP BY provider
                """)
                rows = cur.fetchall()
        for r in rows:
            if r.get("avg_ms") is not None:
                r["avg_ms"] = int(r["avg_ms"])
        return jsonify(rows)

    # ══════════════════════════════════════════════════════════
    # チャット本体
    # ══════════════════════════════════════════════════════════
    @app.route("/api/ai", methods=["POST"])
    def ai_chat():
        init_tables()
        body = request.get_json(force=True, silent=True) or {}
        provider = (body.get("provider") or "").strip().lower()
        messages = body.get("messages") or []
        conv_id = body.get("conversation_id")
        save = body.get("save", True)

        temperature = body.get("temperature")
        try:
            temperature = None if temperature is None else min(max(float(temperature), 0.0), 2.0)
        except (TypeError, ValueError):
            temperature = None

        if provider not in PROVIDERS:
            return jsonify({"ok": False, "error": "不明なプロバイダーです"}), 400
        if not isinstance(messages, list) or not messages:
            return jsonify({"ok": False, "error": "メッセージがありません"}), 400

        # 履歴を正規化
        clean = []
        for m in messages[-20:]:
            role = m.get("role")
            content = m.get("content")
            if role not in ("user", "assistant") or not isinstance(content, str):
                continue
            if not content.strip():
                continue
            entry = {"role": role, "content": content[:12000]}
            imgs = m.get("images")
            if isinstance(imgs, list) and imgs:
                entry["images"] = imgs[:3]
            clean.append(entry)
        if not clean:
            return jsonify({"ok": False, "error": "メッセージが不正です"}), 400

        # トークン節約: 画像は最後のユーザーメッセージのみ残す
        last_user_idx = -1
        for i in range(len(clean) - 1, -1, -1):
            if clean[i]["role"] == "user":
                last_user_idx = i
                break
        for i, m in enumerate(clean):
            if i != last_user_idx and "images" in m:
                del m["images"]

        row = load_setting(provider)
        if not row:
            return jsonify({
                "ok": False,
                "error": "%s のAPIキーが登録されていません" % PROVIDERS[provider]["label"],
                "need_key": True,
            }), 400

        api_key = row["api_key"]
        model = (body.get("model") or "").strip() or row.get("model") \
            or PROVIDERS[provider]["default_model"]

        last_user = clean[last_user_idx] if last_user_idx >= 0 else None
        image_count = len(last_user.get("images", [])) if last_user else 0
        prompt_chars = sum(len(m["content"]) for m in clean)

        start = time.time()
        text, err = call_provider(provider, api_key, model, clean, temperature)
        ms = int((time.time() - start) * 1000)

        # 使用ログ（キーは記録しない）
        try:
            with get_db() as con:
                with con.cursor() as cur:
                    cur.execute("""
                        INSERT INTO ai_logs(provider, model, prompt_chars, response_chars,
                                            image_count, duration_ms, ok, created_at)
                        VALUES(%s,%s,%s,%s,%s,%s,%s,%s)
                    """, (provider, model, prompt_chars, len(text or ""),
                          image_count, ms, 0 if err else 1, now_str()))
        except Exception:
            pass

        if err is not None:
            return jsonify({
                "ok": False,
                "error": sanitize_error(err, api_key),
            }), 502

        # 会話保存
        if save:
            try:
                with get_db() as con:
                    with con.cursor() as cur:
                        if not conv_id:
                            title = (last_user["content"] if last_user else "新しい会話")
                            title = title.strip().replace("\n", " ")[:60] or "新しい会話"
                            cur.execute("""
                                INSERT INTO ai_conversations(title, provider, created_at, updated_at)
                                VALUES(%s,%s,%s,%s)
                            """, (title, provider, now_str(), now_str()))
                            conv_id = cur.lastrowid
                        else:
                            cur.execute(
                                "UPDATE ai_conversations SET updated_at=%s, provider=%s WHERE id=%s",
                                (now_str(), provider, conv_id))
                        if last_user:
                            _save_message(cur, conv_id, "user",
                                          last_user["content"], last_user.get("images"))
                        _save_message(cur, conv_id, "assistant", text or "", None)
            except Exception:
                conv_id = None

        return jsonify({
            "ok": True,
            "provider": provider,
            "model": model,
            "content": text or "",
            "conversation_id": conv_id,
            "duration_ms": ms,
        })

    # ══════════════════════════════════════════════════════════
    # AI生成MODのインストール
    # ══════════════════════════════════════════════════════════
    @app.route("/api/ai/mods", methods=["POST"])
    def ai_install_mod():
        body = request.get_json(force=True, silent=True) or {}
        mod_id = (body.get("mod_id") or "").strip().lower()
        name = (body.get("name") or mod_id or "AI MOD").strip()[:80]
        description = (body.get("description") or "AIが生成したMOD").strip()[:300]
        main_js = body.get("main_js") or ""
        style_css = body.get("style_css") or ""
        overwrite = bool(body.get("overwrite"))

        if not MOD_ID_RE.match(mod_id):
            return jsonify({"ok": False,
                            "error": "MOD IDは英小文字・数字・アンダースコア(40文字以内)にしてください"}), 400
        if not main_js.strip():
            return jsonify({"ok": False, "error": "main.js が空です"}), 400
        if len(main_js.encode("utf-8")) > MAX_MOD_FILE_BYTES \
                or len(style_css.encode("utf-8")) > MAX_MOD_FILE_BYTES:
            return jsonify({"ok": False, "error": "ファイルサイズが大きすぎます(300KBまで)"}), 400

        mod_dir = mods_dir / mod_id
        # パス検証（固定ファイル名のみ書き込むが念のため）
        try:
            mod_dir.resolve().relative_to(mods_dir.resolve())
        except Exception:
            return jsonify({"ok": False, "error": "不正なMOD IDです"}), 400

        if mod_dir.exists() and not overwrite:
            return jsonify({"ok": False, "error": "同名のMODが既に存在します",
                            "exists": True}), 409

        manifest = {
            "id": mod_id,
            "name": name,
            "version": "1.0.0",
            "description": description,
            "author": "Magic Paint AI",
            "enabled": True,
            "scripts": ["main.js"],
        }
        if style_css.strip():
            manifest["styles"] = ["style.css"]

        try:
            mod_dir.mkdir(parents=True, exist_ok=True)
            (mod_dir / "mod.json").write_text(
                json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
            (mod_dir / "main.js").write_text(main_js, encoding="utf-8")
            if style_css.strip():
                (mod_dir / "style.css").write_text(style_css, encoding="utf-8")
        except Exception as e:
            return jsonify({"ok": False,
                            "error": "書き込みに失敗しました: %s" % e.__class__.__name__}), 500

        return jsonify({"ok": True, "id": mod_id, "name": name})
