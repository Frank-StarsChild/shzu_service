# -*- coding: utf-8 -*-
"""任务/会话存储：SQLite。公开政策库与个人申请草稿分开存储（方案 14）。
个人草稿默认短期保留，提供删除入口；演示环境随库重建。"""
import json
import sqlite3
import time
import uuid

from ..config import DB_PATH

_SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    created_at REAL,
    slots TEXT DEFAULT '{}',
    last_query TEXT DEFAULT '',
    expires_at REAL
);
CREATE TABLE IF NOT EXISTS chat_turns (
    session_id TEXT,
    request_id TEXT,
    seq INTEGER,
    role TEXT,
    status TEXT DEFAULT 'done',
    text TEXT DEFAULT '',
    response TEXT DEFAULT 'null',
    slots TEXT DEFAULT '{}',
    created_at REAL,
    PRIMARY KEY (session_id, request_id, seq)
);
CREATE TABLE IF NOT EXISTS tasks (
    task_id TEXT PRIMARY KEY,
    session_id TEXT,
    flow_id TEXT,
    revision INTEGER DEFAULT 1,
    slots TEXT DEFAULT '{}',
    rule_results TEXT DEFAULT '[]',
    current_step INTEGER DEFAULT 1,
    kb_version TEXT,
    created_at REAL,
    updated_at REAL
);
CREATE TABLE IF NOT EXISTS artifacts (
    artifact_id TEXT PRIMARY KEY,
    task_id TEXT,
    task_revision INTEGER,
    template_version TEXT,
    format TEXT,
    path TEXT,
    filename TEXT,
    evidence_manifest TEXT DEFAULT '[]',
    created_at REAL,
    expires_at REAL
);
"""


def _conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_column(c, table, column, ddl):
    """轻量迁移：为旧库已存在的表补列（CREATE TABLE IF NOT EXISTS 不会改列）。"""
    cols = [r["name"] for r in c.execute(f"PRAGMA table_info({table})").fetchall()]
    if column not in cols:
        c.execute(f"ALTER TABLE {table} ADD COLUMN {ddl}")


def init_db():
    with _conn() as c:
        c.executescript(_SCHEMA)
        # 旧库（React 版）sessions 表缺少 v2 契约列，逐一补齐
        _ensure_column(c, "sessions", "slots", "slots TEXT DEFAULT '{}'")
        _ensure_column(c, "sessions", "last_query", "last_query TEXT DEFAULT ''")
        _ensure_column(c, "sessions", "expires_at", "expires_at REAL")
        # 索引依赖上述列，迁移完成后再建
        c.execute("CREATE INDEX IF NOT EXISTS idx_turns_seq ON chat_turns(session_id, seq)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)")


def now():
    return time.time()


def new_session(ttl_hours=24):
    """创建访客会话（方案 5.5：默认保留 24 小时）。"""
    sid = "ses-" + uuid.uuid4().hex[:12]
    ts = now()
    with _conn() as c:
        c.execute("INSERT INTO sessions(session_id, created_at, expires_at) VALUES(?,?,?)",
                  (sid, ts, ts + ttl_hours * 3600))
    return sid


def get_session(session_id):
    with _conn() as c:
        row = c.execute("SELECT * FROM sessions WHERE session_id=?", (session_id,)).fetchone()
    return dict(row) if row else None


def session_expired(session_row) -> bool:
    exp = session_row.get("expires_at")
    return bool(exp) and exp < now()


def delete_session(session_id):
    """清除会话与轮次记录（方案 5.5：删除会话时一并清理）。"""
    with _conn() as c:
        c.execute("DELETE FROM sessions WHERE session_id=?", (session_id,))
        c.execute("DELETE FROM chat_turns WHERE session_id=?", (session_id,))


def delete_turn(session_id, request_id):
    """删除一轮消息（技术错误轮重试前清除旧记录，使重试真正重新执行）。"""
    with _conn() as c:
        c.execute("DELETE FROM chat_turns WHERE session_id=? AND request_id=?",
                  (session_id, request_id))


def add_turn(session_id, request_id, role, text, response=None, slots=None, status="done", seq=None):
    """写入一轮消息。seq 缺省按会话内递增。"""
    with _conn() as c:
        if seq is None:
            row = c.execute("SELECT COALESCE(MAX(seq),0)+1 AS n FROM chat_turns WHERE session_id=?",
                            (session_id,)).fetchone()
            seq = row["n"]
        existing = c.execute(
            "SELECT seq, response FROM chat_turns WHERE session_id=? AND request_id=? AND role=?",
            (session_id, request_id, role)).fetchone()
        if existing:
            # 幂等：相同 request_id 且内容一致，复用已完成结果
            return existing["seq"]
        c.execute(
            "INSERT INTO chat_turns(session_id, request_id, seq, role, status, text, response, slots, created_at)"
            " VALUES(?,?,?,?,?,?,?,?,?)",
            (session_id, request_id, seq, role, status, text,
             json.dumps(response, ensure_ascii=False) if response is not None else None,
             json.dumps(slots, ensure_ascii=False) if slots is not None else None, now()))
        return seq


def find_turn(session_id, request_id):
    """查该 request_id 的既有轮次（幂等重试/409 判断）。"""
    with _conn() as c:
        rows = c.execute("SELECT * FROM chat_turns WHERE session_id=? AND request_id=? ORDER BY seq",
                         (session_id, request_id)).fetchall()
    return [_parse_row(dict(r)) for r in rows]


def list_messages(session_id):
    with _conn() as c:
        rows = c.execute("SELECT * FROM chat_turns WHERE session_id=? ORDER BY seq", (session_id,)).fetchall()
    return [_parse_row(dict(r)) for r in rows]


def create_task(session_id, flow_id, slots, rule_results, kb_version):
    task_id = "task-" + uuid.uuid4().hex[:12]
    ts = now()
    with _conn() as c:
        c.execute(
            "INSERT INTO tasks(task_id, session_id, flow_id, revision, slots, rule_results, current_step, kb_version, created_at, updated_at)"
            " VALUES(?,?,?,?,?,?,?,?,?,?)",
            (task_id, session_id, flow_id, 1, json.dumps(slots, ensure_ascii=False),
             json.dumps(rule_results, ensure_ascii=False), 1, kb_version, ts, ts))
    return task_id


def get_task(task_id):
    with _conn() as c:
        row = c.execute("SELECT * FROM tasks WHERE task_id=?", (task_id,)).fetchone()
    return _parse_row(dict(row)) if row else None


def _parse_row(row):
    """把数据库中的 JSON 文本字段解析为对象，避免前端拿到字符串。"""
    for key in ("slots", "rule_results", "response"):
        v = row.get(key)
        if isinstance(v, str):
            try:
                row[key] = json.loads(v)
            except (ValueError, TypeError):
                pass
    return row


def list_tasks(session_id):
    with _conn() as c:
        rows = c.execute("SELECT * FROM tasks WHERE session_id=? ORDER BY updated_at DESC", (session_id,)).fetchall()
    return [_parse_row(dict(r)) for r in rows]


def update_task(task_id, slots=None, rule_results=None, current_step=None, bump_revision=False):
    with _conn() as c:
        row = c.execute("SELECT * FROM tasks WHERE task_id=?", (task_id,)).fetchone()
        if not row:
            return None
        rev = row["revision"] + (1 if bump_revision else 0)
        c.execute(
            "UPDATE tasks SET slots=COALESCE(?, slots), rule_results=COALESCE(?, rule_results),"
            " current_step=COALESCE(?, current_step), revision=?, updated_at=? WHERE task_id=?",
            (json.dumps(slots, ensure_ascii=False) if slots is not None else None,
             json.dumps(rule_results, ensure_ascii=False) if rule_results is not None else None,
             current_step, rev, now(), task_id))
    return get_task(task_id)


def delete_task(task_id):
    """个人草稿删除入口（方案 14：提供删除入口）。"""
    with _conn() as c:
        c.execute("DELETE FROM tasks WHERE task_id=?", (task_id,))


def save_artifact(task_id, task_revision, template_version, fmt, path, filename, evidence_manifest, ttl_hours=72):
    artifact_id = "art-" + uuid.uuid4().hex[:12]
    ts = now()
    with _conn() as c:
        c.execute(
            "INSERT INTO artifacts(artifact_id, task_id, task_revision, template_version, format, path, filename, evidence_manifest, created_at, expires_at)"
            " VALUES(?,?,?,?,?,?,?,?,?,?)",
            (artifact_id, task_id, task_revision, template_version, fmt, path, filename,
             json.dumps(evidence_manifest, ensure_ascii=False), ts, ts + ttl_hours * 3600))
    return artifact_id


def get_artifact(artifact_id):
    with _conn() as c:
        row = c.execute("SELECT * FROM artifacts WHERE artifact_id=?", (artifact_id,)).fetchone()
    return dict(row) if row else None


def list_artifacts(task_id):
    with _conn() as c:
        rows = c.execute("SELECT * FROM artifacts WHERE task_id=? ORDER BY created_at DESC", (task_id,)).fetchall()
    return [dict(r) for r in rows]
