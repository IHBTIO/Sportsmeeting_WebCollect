# -*- coding: utf-8 -*-
"""database.py v4.9 - 增加密码持久化"""
import os, sys, sqlite3
from datetime import datetime

DEPARTMENTS = ["小学部", "初中部", "高中部"]
DEFAULT_GRADES = [
    ("小学部", "一年级", 8, 1), ("小学部", "二年级", 8, 2), ("小学部", "三年级", 8, 3),
    ("小学部", "四年级", 8, 4), ("小学部", "五年级", 8, 5), ("小学部", "六年级", 8, 6),
    ("初中部", "初一", 8, 1), ("初中部", "初二", 8, 2), ("初中部", "初三", 8, 3),
    ("高中部", "高一", 8, 1), ("高中部", "高二", 8, 2), ("高中部", "高三", 8, 3),
]
DEFAULT_PROJECTS = [
    "50米", "100米", "200米", "400米", "800米", "1500米", "3000米", "4x100米接力",
    "跳高", "跳远", "立定跳远", "铅球", "实心球", "垒球"
]
DEFAULT_SETTINGS = {
    "registration_open": "1",
    "registration_start": "",
    "registration_deadline": "",
    "registration_notice": "",
    "max_events": "2",
    "admin_password": "admin123"  # 默认密码
}

def get_app_dir():
    if getattr(sys, "frozen", False):
        return os.path.dirname(os.path.abspath(sys.executable))
    return os.path.dirname(os.path.abspath(__file__))

DB_PATH = os.path.join(get_app_dir(), "sports_meet.db")

def _connect():
    conn = sqlite3.connect(DB_PATH, timeout=15, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout = 15000")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn

def _col_exists(conn, table, col):
    return any(r["name"] == col for r in conn.execute(f"PRAGMA table_info({table})").fetchall())

def init_db():
    db_dir = os.path.dirname(DB_PATH)
    if db_dir and not os.path.isdir(db_dir):
        os.makedirs(db_dir, exist_ok=True)
    conn = _connect()
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS registrations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                department TEXT NOT NULL DEFAULT '',
                class_name TEXT NOT NULL,
                name TEXT NOT NULL,
                gender TEXT NOT NULL,
                events TEXT NOT NULL,
                event_count INTEGER NOT NULL,
                ip TEXT DEFAULT '',
                created_at TEXT NOT NULL
            )""")
        if not _col_exists(conn, "registrations", "department"):
            conn.execute("ALTER TABLE registrations ADD COLUMN department TEXT NOT NULL DEFAULT ''")
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_person ON registrations(class_name, name)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_class ON registrations(class_name)")

        conn.execute("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        for k, v in DEFAULT_SETTINGS.items():
            conn.execute("INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)", (k, v))

        conn.execute("""
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                sort_order INTEGER DEFAULT 0,
                created_at TEXT NOT NULL
            )""")
        if not _col_exists(conn, "projects", "created_at"):
            conn.execute("ALTER TABLE projects ADD COLUMN created_at TEXT DEFAULT ''")
            now_fix = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            conn.execute("UPDATE projects SET created_at = ? WHERE created_at = '' OR created_at IS NULL", (now_fix,))

        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        for i, p in enumerate(DEFAULT_PROJECTS, 1):
            conn.execute("INSERT OR IGNORE INTO projects(name,sort_order,created_at) VALUES(?,?,?)", (p, i, now))
                
        conn.execute("""
            CREATE TABLE IF NOT EXISTS grade_config (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                department TEXT NOT NULL, grade_name TEXT NOT NULL,
                class_count INTEGER NOT NULL DEFAULT 8, sort_order INTEGER DEFAULT 0,
                UNIQUE(department, grade_name)
            )""")
        if conn.execute("SELECT COUNT(*) AS c FROM grade_config").fetchone()["c"] == 0:
            for dept, grade, cnt, order in DEFAULT_GRADES:
                conn.execute("INSERT INTO grade_config(department,grade_name,class_count,sort_order) VALUES(?,?,?,?)", (dept, grade, cnt, order))

        conn.execute("""
            CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                action TEXT NOT NULL, detail TEXT DEFAULT '', created_at TEXT NOT NULL
            )""")
    finally:
        conn.close()

def get_setting(key, default=None):
    conn = _connect()
    try:
        r = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return r["value"] if r else default
    finally:
        conn.close()

def set_setting(key, value):
    conn = _connect()
    try:
        conn.execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, str(value)))
    finally:
        conn.close()

def _parse_dt(s):
    s = (s or "").strip()
    if not s: return None
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M", "%Y-%m-%d"):
        try:
            dt = datetime.strptime(s, fmt)
            return dt.replace(hour=23, minute=59) if fmt == "%Y-%m-%d" else dt
        except ValueError: continue
    return None

def is_registration_open():
    if get_setting("registration_open", "1") != "1": return False
    now = datetime.now()
    start = _parse_dt(get_setting("registration_start", ""))
    deadline = _parse_dt(get_setting("registration_deadline", ""))
    if start and now < start: return False
    if deadline and now > deadline: return False
    return True

def get_grade_config():
    conn = _connect()
    try:
        return [dict(r) for r in conn.execute("SELECT department, grade_name, class_count FROM grade_config ORDER BY department, sort_order, id").fetchall()]
    finally:
        conn.close()

def get_departments():
    cfg = get_grade_config()
    return list(dict.fromkeys([g["department"] for g in cfg if g["class_count"] > 0]))

def get_classes_by_department(dept):
    result = []
    for g in get_grade_config():
        if g["department"] == dept and g["class_count"] > 0:
            for i in range(1, g["class_count"] + 1):
                result.append(f"{g['grade_name']}{i}班")
    return result

def is_valid_class(dept, class_name):
    return class_name in get_classes_by_department(dept)

def save_grade(department, grade_name, class_count):
    try: cnt = int(class_count)
    except: return False, "班级数必须是整数"
    if cnt < 0 or cnt > 50: return False, "必须在0-50之间"
    conn = _connect()
    try:
        row = conn.execute("SELECT id FROM grade_config WHERE department=? AND grade_name=?", (department, grade_name)).fetchone()
        if row: conn.execute("UPDATE grade_config SET class_count=? WHERE id=?", (cnt, row["id"]))
        else:
            mo = conn.execute("SELECT COALESCE(MAX(sort_order),0) AS m FROM grade_config WHERE department=?", (department,)).fetchone()["m"]
            conn.execute("INSERT INTO grade_config(department,grade_name,class_count,sort_order) VALUES(?,?,?,?)", (department, grade_name, cnt, mo + 1))
        return True, "已保存"
    finally: conn.close()

def delete_grade(department, grade_name):
    conn = _connect()
    try:
        row = conn.execute("SELECT id, class_count FROM grade_config WHERE department=? AND grade_name=?", (department, grade_name)).fetchone()
        if not row: return False, "年级不存在"
        classes = [f"{grade_name}{i}班" for i in range(1, row["class_count"] + 1)]
        if classes:
            ph = ",".join("?" * len(classes))
            used = conn.execute(f"SELECT COUNT(*) AS c FROM registrations WHERE class_name IN ({ph})", classes).fetchone()["c"]
            if used > 0: return False, "该年级已有报名记录，请先清空数据或改班级数为0隐藏"
        conn.execute("DELETE FROM grade_config WHERE id=?", (row["id"],))
        return True, "已删除"
    finally: conn.close()

def get_projects():
    conn = _connect()
    try:
        return [r["name"] for r in conn.execute("SELECT name FROM projects ORDER BY sort_order, id").fetchall()]
    finally:
        conn.close()

def add_project(name):
    name = (name or "").strip()
    if not name: return False, "不能为空"
    conn = _connect()
    try:
        mo = conn.execute("SELECT COALESCE(MAX(sort_order),0) AS m FROM projects").fetchone()["m"]
        conn.execute("INSERT INTO projects(name,sort_order,created_at) VALUES(?,?,?)", (name, mo + 1, datetime.now().strftime("%Y-%m-%d %H:%M:%S")))
        return True, "已添加"
    except sqlite3.IntegrityError:
        return False, "项目已存在"
    finally: conn.close()

def delete_project(name):
    conn = _connect()
    try:
        used = conn.execute("SELECT COUNT(*) AS c FROM registrations WHERE ',' || events || ',' LIKE ?", (f"%,{name},%",)).fetchone()["c"]
        if used > 0: return False, f"已有 {used} 条报名记录，无法删除"
        conn.execute("DELETE FROM projects WHERE name=?", (name,))
        return True, "删除成功"
    finally: conn.close()

def reorder_projects(names):
    conn = _connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        for i, n in enumerate(names, 1): conn.execute("UPDATE projects SET sort_order=? WHERE name=?", (i, n))
        conn.execute("COMMIT")
        return True, "已排序"
    except: return False, "排序失败"
    finally: conn.close()

def add_registration(department, class_name, name, gender, events, ip=""):
    max_ev = int(get_setting("max_events", "2"))
    if len(events) > max_ev: return False, f"最多只能报 {max_ev} 项", None
    conn = _connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        if get_setting("registration_open", "1") != "1": return False, "报名已截止", None
        if conn.execute("SELECT id FROM registrations WHERE class_name=? AND name=?", (class_name, name)).fetchone():
            return False, f"{class_name}的「{name}」已经报过名了", None
        cur = conn.execute("INSERT INTO registrations(department,class_name,name,gender,events,event_count,ip,created_at) VALUES(?,?,?,?,?,?,?,?)",
                           (department, class_name, name, gender, ",".join(events), len(events), ip, datetime.now().strftime("%Y-%m-%d %H:%M:%S")))
        conn.execute("COMMIT")
        return True, "报名成功", cur.lastrowid
    except sqlite3.Error as e:
        try: conn.execute("ROLLBACK")
        except: pass
        return False, f"写入失败: {e}", None
    finally: conn.close()

def revoke_registration(reg_id, class_name, name):
    conn = _connect()
    try:
        row = conn.execute("SELECT id FROM registrations WHERE id=? AND class_name=? AND name=?", (reg_id, class_name, name)).fetchone()
        if not row: return False, "未找到"
        conn.execute("DELETE FROM registrations WHERE id=?", (reg_id,))
        return True, "已撤回"
    finally: conn.close()

def find_registration(class_name, name):
    conn = _connect()
    try:
        r = conn.execute("SELECT * FROM registrations WHERE class_name=? AND name=?", (class_name, name)).fetchone()
        return dict(r) if r else None
    finally: conn.close()

def get_all_registrations(filters=None):
    sql = "SELECT * FROM registrations WHERE 1=1 "
    params = []
    f = filters or {}
    if f.get("department"): sql += "AND department=? "; params.append(f["department"])
    if f.get("class_name"): sql += "AND class_name=? "; params.append(f["class_name"])
    if f.get("gender"): sql += "AND gender=? "; params.append(f["gender"])
    if f.get("project"): sql += "AND (',' || events || ',') LIKE ? "; params.append(f"%,{f['project']},%")
    if f.get("keyword"): sql += "AND (name LIKE ? OR class_name LIKE ?) "; params.extend([f"%{f['keyword']}%"]*2)
    sql += "ORDER BY class_name, id"
    conn = _connect()
    try:
        return [dict(r) for r in conn.execute(sql, params).fetchall()]
    finally: conn.close()

def get_statistics(filters=None):
    rows = get_all_registrations(filters)
    c_s, d_s, e_s, g_s = {}, {}, {}, {"男":0, "女":0}
    for r in rows:
        c_s[r["class_name"]] = c_s.get(r["class_name"], 0) + 1
        if r["department"]: d_s[r["department"]] = d_s.get(r["department"], 0) + 1
        if r["gender"] in g_s: g_s[r["gender"]] += 1
        for ev in r["events"].split(","):
            if ev.strip(): e_s[ev.strip()] = e_s.get(ev.strip(), 0) + 1
    projs = get_projects()
    ev_sorted = sorted([(p, e_s.get(p, 0)) for p in projs], key=lambda x: -x[1])
    return {"total": len(rows), "by_class": c_s, "by_department": d_s, "by_event_sorted": ev_sorted, "by_gender": g_s}

def delete_record(rid):
    conn = _connect()
    try:
        conn.execute("DELETE FROM registrations WHERE id=?", (rid,))
        return True, "已删除"
    finally: conn.close()

def clear_all_records():
    conn = _connect()
    try:
        conn.execute("DELETE FROM registrations")
        return True, "已清空"
    finally: conn.close()

def log_action(action, detail=""):
    conn = _connect()
    try:
        conn.execute("INSERT INTO audit_log(action,detail,created_at) VALUES(?,?,?)", (action, detail, datetime.now().strftime("%Y-%m-%d %H:%M:%S")))
    finally: conn.close()

def get_logs(limit=300):
    conn = _connect()
    try:
        return [dict(r) for r in conn.execute("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?", (limit,)).fetchall()]
    finally: conn.close()