// SIBAQ '26 Quiz Portal — Noorul Huda Islamic Academy
// Node + Express (only dependency) + SQLite via node:sqlite. No build step.
const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { seedIfEmpty, seedVocabQuizzes } = require("./seed");

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "quiz.db");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);

const LEVELS = ["Bidaya", "Ula", "Thanawiyya", "Aliyah", "Kulliyya"];
const PROGRAMMES = [
  { level: "Bidaya", code: "BNS30", name: "GK Quiz" },
  { level: "Bidaya", code: "BNS31", name: "Map Study" },
  { level: "Bidaya", code: "BNO16", name: "Numerical Aptitude" },
  { level: "Ula", code: "UNO26", name: "GK Talent" },
  { level: "Ula", code: "UNO17", name: "Vocabulary Olympiad" },
  { level: "Ula", code: "UNO24", name: "Grammar Quiz" },
  { level: "Ula", code: "UNS37", name: "Geo Giant" },
  { level: "Ula", code: "UNO20", name: "Math Talent" },
  { level: "Thanawiyya", code: "TNS32", name: "Multilingual Quiz" },
  { level: "Thanawiyya", code: "TNS35", name: "Quantitative Aptitude" },
  { level: "Aliyah", code: "ANO15", name: "Biz Quiz" },
  { level: "Aliyah", code: "ANO16", name: "Civic Quest" },
  { level: "Aliyah", code: "ANO12", name: "Logical Reasoning" },
  { level: "Kulliyya", code: "CUSTOM", name: "Custom / Other" },
  { level: "All", code: "CUSTOM", name: "Custom / Other" },
];
const CATEGORIES = ["General Knowledge", "Islamic History", "World History", "Current Affairs",
  "Qur'an & Seerah", "Arabic & Grammar", "English", "Maths", "Science", "Geography", "Business & Civics", "Other"];

db.exec(`
CREATE TABLE IF NOT EXISTS teachers (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, pass_hash TEXT NOT NULL, salt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS students (id INTEGER PRIMARY KEY, name TEXT NOT NULL, level TEXT NOT NULL, class_section TEXT DEFAULT '', adm_no TEXT UNIQUE NOT NULL, pin_hash TEXT NOT NULL, salt TEXT NOT NULL, active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, role TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS bank_questions (id INTEGER PRIMARY KEY, source TEXT, section TEXT, category TEXT, level TEXT, question TEXT NOT NULL, options_json TEXT NOT NULL, correct_index INTEGER NOT NULL, orig_number INTEGER);
CREATE TABLE IF NOT EXISTS quizzes (id INTEGER PRIMARY KEY, title TEXT NOT NULL, level TEXT NOT NULL DEFAULT 'Bidaya', programme TEXT DEFAULT 'CUSTOM', category TEXT DEFAULT 'General Knowledge', modes TEXT DEFAULT 'both', time_minutes INTEGER DEFAULT 20, published INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), type TEXT DEFAULT 'mcq', points_per_box INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS quiz_questions (id INTEGER PRIMARY KEY, quiz_id INTEGER NOT NULL, bank_id INTEGER, question TEXT NOT NULL, options_json TEXT NOT NULL, correct_index INTEGER NOT NULL, sort_order INTEGER DEFAULT 0, qtype TEXT DEFAULT 'mcq', prompt_lang TEXT DEFAULT '', boxes_json TEXT, accept_json TEXT);
CREATE TABLE IF NOT EXISTS attempts (id INTEGER PRIMARY KEY, quiz_id INTEGER NOT NULL, student_id INTEGER NOT NULL, mode TEXT NOT NULL, score INTEGER NOT NULL, total INTEGER NOT NULL, answers_json TEXT, created_at TEXT DEFAULT (datetime('now')));
`);
// Migrations for DBs created before the write2 type existed
for (const sql of [
  "ALTER TABLE quizzes ADD COLUMN type TEXT DEFAULT 'mcq'",
  "ALTER TABLE quizzes ADD COLUMN points_per_box INTEGER DEFAULT 1",
  "ALTER TABLE quiz_questions ADD COLUMN qtype TEXT DEFAULT 'mcq'",
  "ALTER TABLE quiz_questions ADD COLUMN prompt_lang TEXT DEFAULT ''",
  "ALTER TABLE quiz_questions ADD COLUMN boxes_json TEXT",
  "ALTER TABLE quiz_questions ADD COLUMN accept_json TEXT",
]) { try { db.exec(sql); } catch {} }

// ── write2 auto-marking normalisation ────────────────────────────────
// Applied to BOTH stored accept answers and student input.
function normalizeAnswer(input, lang) {
  let s = String(input ?? "").normalize("NFC");
  s = s.trim().replace(/\s+/g, " ").toLowerCase();
  const l = String(lang || "").toLowerCase();
  if (l === "ar" || l === "arabic") {
    s = s.replace(/[\u064B-\u0652\u0670]/g, "") // harakat/diacritics U+064B-U+0652, U+0670
         .replace(/ـ/g, "")               // tatweel U+0640
         .replace(/[أإآ]/g, "ا") // hamza/madda alefs -> alef
         .replace(/ى/g, "ي");       // alef maksura -> yeh
  } else if (l === "ur" || l === "urdu") {
    s = s.replace(/[\u064B-\u0652\u0670]/g, "")
         .replace(/ـ/g, "")
         .replace(/ي/g, "ی")  // Arabic yeh U+064A -> Farsi yeh U+06CC
         .replace(/ك/g, "ک"); // Arabic kaf U+0643 -> Urdu kaf U+06A9
  }
  return s.trim().replace(/\s+/g, " ");
}
function boxIsCorrect(given, box) {
  const g = normalizeAnswer(given, box.lang);
  if (!g) return false;
  return (box.accept || []).some(a => normalizeAnswer(a, box.lang) === g);
}

// Seed teacher (first run only) — TEMPORARY password, change in Teacher Panel.
if (db.prepare("SELECT COUNT(*) c FROM teachers").get().c === 0) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync("QuizPortal@2026", salt, 64).toString("hex");
  db.prepare("INSERT INTO teachers (username, pass_hash, salt) VALUES (?,?,?)").run("samad", hash, salt);
  console.log("[seed] Teacher 'samad' created with TEMPORARY password — change it in the Teacher Panel.");
}
const seedResult = seedIfEmpty(db);
if (seedResult.seeded) console.log(`[seed] Bank: ${seedResult.seeded} questions, ${seedResult.skipped} skipped, ${seedResult.samples} sample quizzes.`);
const vocabResult = seedVocabQuizzes(db);
if (vocabResult.added) console.log(`[seed] UNO17 Vocabulary: ${vocabResult.added} quizzes added (${vocabResult.present} already present).`);

function hashSecret(secret, salt) { return crypto.scryptSync(String(secret), salt, 64).toString("hex"); }
function newSalt() { return crypto.randomBytes(16).toString("hex"); }
function makeSession(userId, role) {
  const token = crypto.randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions (token, user_id, role) VALUES (?,?,?)").run(token, userId, role);
  return token;
}
function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not logged in." });
  const s = db.prepare("SELECT * FROM sessions WHERE token=?").get(token);
  if (!s) return res.status(401).json({ error: "Session expired. Log in again." });
  req.session = s; req.userId = s.user_id; req.role = s.role;
  next();
}
function requireTeacher(req, res, next) { if (req.role !== "teacher") return res.status(403).json({ error: "Teacher access only." }); next(); }
function requireStudent(req, res, next) { if (req.role !== "student") return res.status(403).json({ error: "Student access only." }); next(); }

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/meta", (req, res) => res.json({ levels: LEVELS, programmes: PROGRAMMES, categories: CATEGORIES }));

// ── Auth ─────────────────────────────────────────────────────────────
app.post("/api/auth/register", (req, res) => {
  const { name, level, class_section, adm_no, pin } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: "Full name is required." });
  if (!LEVELS.includes(level)) return res.status(400).json({ error: "Choose a valid level." });
  if (!adm_no || !String(adm_no).trim()) return res.status(400).json({ error: "Admission / chest number is required." });
  if (!/^\d{4}$/.test(String(pin || ""))) return res.status(400).json({ error: "PIN must be exactly 4 digits." });
  // Students can never create teacher accounts: this endpoint only writes to students.
  const adm = String(adm_no).trim();
  if (db.prepare("SELECT id FROM students WHERE adm_no=?").get(adm)) return res.status(409).json({ error: "This admission number is already registered. Log in instead." });
  const salt = newSalt();
  const r = db.prepare("INSERT INTO students (name, level, class_section, adm_no, pin_hash, salt) VALUES (?,?,?,?,?,?)")
    .run(String(name).trim(), level, String(class_section || "").trim(), adm, hashSecret(pin, salt), salt);
  const token = makeSession(r.lastInsertRowid, "student");
  res.json({ token, role: "student", user: { id: r.lastInsertRowid, name: String(name).trim(), level, adm_no: adm } });
});
app.post("/api/auth/student-login", (req, res) => {
  const { adm_no, pin } = req.body || {};
  const st = db.prepare("SELECT * FROM students WHERE adm_no=?").get(String(adm_no || "").trim());
  if (!st || !st.active) return res.status(401).json({ error: "Invalid admission number or PIN." });
  if (hashSecret(pin || "", st.salt) !== st.pin_hash) return res.status(401).json({ error: "Invalid admission number or PIN." });
  res.json({ token: makeSession(st.id, "student"), role: "student", user: { id: st.id, name: st.name, level: st.level, adm_no: st.adm_no } });
});
app.post("/api/auth/teacher-login", (req, res) => {
  const { username, password } = req.body || {};
  const t = db.prepare("SELECT * FROM teachers WHERE username=?").get(String(username || "").trim());
  if (!t || hashSecret(password || "", t.salt) !== t.pass_hash) return res.status(401).json({ error: "Invalid username or password." });
  res.json({ token: makeSession(t.id, "teacher"), role: "teacher", user: { id: t.id, username: t.username } });
});
app.post("/api/auth/logout", auth, (req, res) => { db.prepare("DELETE FROM sessions WHERE token=?").run(req.headers.authorization.slice(7)); res.json({ ok: true }); });
app.get("/api/me", auth, (req, res) => {
  if (req.role === "teacher") { const t = db.prepare("SELECT id, username FROM teachers WHERE id=?").get(req.userId); return res.json({ role: "teacher", user: t }); }
  const s = db.prepare("SELECT id, name, level, class_section, adm_no FROM students WHERE id=?").get(req.userId);
  res.json({ role: "student", user: s });
});
app.post("/api/teacher/change-password", auth, requireTeacher, (req, res) => {
  const { old_password, new_password } = req.body || {};
  const t = db.prepare("SELECT * FROM teachers WHERE id=?").get(req.userId);
  if (hashSecret(old_password || "", t.salt) !== t.pass_hash) return res.status(400).json({ error: "Old password is wrong." });
  if (!new_password || String(new_password).length < 8) return res.status(400).json({ error: "New password must be at least 8 characters." });
  const salt = newSalt();
  db.prepare("UPDATE teachers SET pass_hash=?, salt=? WHERE id=?").run(hashSecret(new_password, salt), salt, t.id);
  res.json({ ok: true });
});

// ── Student: quizzes ─────────────────────────────────────────────────
function quizRow(q) {
  const n = db.prepare("SELECT COUNT(*) c FROM quiz_questions WHERE quiz_id=?").get(q.id).c;
  return { ...q, published: !!q.published, question_count: n };
}
app.get("/api/quizzes", auth, requireStudent, (req, res) => {
  const rows = db.prepare("SELECT * FROM quizzes WHERE published=1 ORDER BY level, category, id").all().map(quizRow);
  const done = db.prepare("SELECT quiz_id, mode FROM attempts WHERE student_id=? AND mode='exam'").all(req.userId);
  const examDone = new Set(done.map(d => d.quiz_id));
  rows.forEach(r => r.exam_done = examDone.has(r.id));
  res.json({ quizzes: rows });
});
app.get("/api/quizzes/:id", auth, requireStudent, (req, res) => {
  const q = db.prepare("SELECT * FROM quizzes WHERE id=? AND published=1").get(req.params.id);
  if (!q) return res.status(404).json({ error: "Quiz not found." });
  const isW2 = q.type === "write2";
  const qs = db.prepare("SELECT * FROM quiz_questions WHERE quiz_id=? ORDER BY sort_order, id").all(q.id)
    .map(x => isW2
      ? { id: x.id, type: "write2", question: x.question, prompt: x.question, prompt_lang: x.prompt_lang || "en",
          // boxes are student-safe: lang + label only, NEVER the accept lists
          boxes: (JSON.parse(x.boxes_json || "[]")).map(b => ({ lang: b.lang, label: b.label })) }
      : { id: x.id, type: "mcq", question: x.question, options: JSON.parse(x.options_json || "[]") });
  const examAttempt = db.prepare("SELECT id FROM attempts WHERE quiz_id=? AND student_id=? AND mode='exam'").get(q.id, req.userId);
  res.json({ quiz: quizRow(q), questions: qs, exam_done: !!examAttempt });
});
app.post("/api/quizzes/:id/check", auth, requireStudent, (req, res) => {
  const q = db.prepare("SELECT * FROM quizzes WHERE id=? AND published=1").get(req.params.id);
  if (!q) return res.status(404).json({ error: "Quiz not found." });
  if (q.modes === "exam") return res.status(400).json({ error: "Practice check is not available for exam-only quizzes." });
  if (req.body.mode === "exam") return res.status(400).json({ error: "No instant check in exam mode." });
  const qq = db.prepare("SELECT * FROM quiz_questions WHERE id=? AND quiz_id=?").get(req.body.question_id, q.id);
  if (!qq) return res.status(404).json({ error: "Question not found." });
  if (q.type === "write2") {
    const boxes = JSON.parse(qq.accept_json || qq.boxes_json || "[]");
    const givenArr = Array.isArray(req.body.answers) ? req.body.answers : [];
    const boxResults = boxes.map((b, i) => ({ lang: b.lang, label: b.label, given: givenArr[i] ?? "", correct: boxIsCorrect(givenArr[i], b), correct_answers: b.accept }));
    return res.json({ type: "write2", boxes: boxResults, correct_boxes: boxResults.filter(b => b.correct).length });
  }
  const sel = Number(req.body.selected);
  res.json({ correct: sel === qq.correct_index, correct_index: qq.correct_index });
});
app.post("/api/quizzes/:id/submit", auth, requireStudent, (req, res) => {
  const q = db.prepare("SELECT * FROM quizzes WHERE id=? AND published=1").get(req.params.id);
  if (!q) return res.status(404).json({ error: "Quiz not found." });
  const mode = req.body.mode === "exam" ? "exam" : "practice";
  if (mode === "exam" && q.modes === "practice") return res.status(400).json({ error: "This quiz is practice only." });
  if (mode === "practice" && q.modes === "exam") return res.status(400).json({ error: "This quiz is exam only." });
  if (mode === "exam") {
    const ex = db.prepare("SELECT id FROM attempts WHERE quiz_id=? AND student_id=? AND mode='exam'").get(q.id, req.userId);
    if (ex) return res.status(403).json({ error: "You have already taken this exam. Only 1 attempt is allowed." });
  }
  const qs = db.prepare("SELECT * FROM quiz_questions WHERE quiz_id=? ORDER BY sort_order, id").all(q.id);
  const answers = req.body.answers || {};
  const rawFor = qq => answers[qq.id] !== undefined ? answers[qq.id] : answers[String(qq.id)];
  let score = 0, total = qs.length;
  if (q.type === "write2") {
    const ppb = Math.max(1, Number(q.points_per_box) || 1);
    total = 0;
    const detail = qs.map(qq => {
      const boxes = JSON.parse(qq.accept_json || qq.boxes_json || "[]");
      const givenArr = Array.isArray(rawFor(qq)) ? rawFor(qq) : [];
      const boxResults = boxes.map((b, i) => {
        const correct = boxIsCorrect(givenArr[i], b);
        total += ppb; if (correct) score += ppb;
        return { lang: b.lang, label: b.label, given: givenArr[i] ?? "", correct, correct_answers: b.accept };
      });
      return { question_id: qq.id, question: qq.question, prompt: qq.question, prompt_lang: qq.prompt_lang || "en", boxes: boxResults, correct_boxes: boxResults.filter(b => b.correct).length };
    });
    const r = db.prepare("INSERT INTO attempts (quiz_id, student_id, mode, score, total, answers_json) VALUES (?,?,?,?,?,?)")
      .run(q.id, req.userId, mode, score, total, JSON.stringify(answers));
    return res.json({ attempt_id: r.lastInsertRowid, score, total, mode, type: "write2", detail });
  }
  const detail = qs.map(qq => {
    const given = rawFor(qq) !== undefined ? Number(rawFor(qq)) : -1;
    const correct = given === qq.correct_index; if (correct) score++;
    return { question_id: qq.id, question: qq.question, options: JSON.parse(qq.options_json || "[]"), given, correct_index: qq.correct_index, correct };
  });
  const r = db.prepare("INSERT INTO attempts (quiz_id, student_id, mode, score, total, answers_json) VALUES (?,?,?,?,?,?)")
    .run(q.id, req.userId, mode, score, total, JSON.stringify(answers));
  res.json({ attempt_id: r.lastInsertRowid, score, total, mode, type: "mcq", detail });
});
app.get("/api/my-results", auth, requireStudent, (req, res) => {
  const rows = db.prepare(`SELECT a.*, q.title, q.level, q.category FROM attempts a JOIN quizzes q ON q.id=a.quiz_id WHERE a.student_id=? ORDER BY a.id DESC`).all(req.userId);
  res.json({ results: rows });
});
app.get("/api/leaderboard", auth, (req, res) => {
  const level = req.query.level;
  let sql = `SELECT s.name, s.level, s.adm_no, SUM(a.score) points, COUNT(a.id) attempts FROM attempts a JOIN students s ON s.id=a.student_id WHERE a.mode='exam'`;
  const args = [];
  if (level && LEVELS.includes(level)) { sql += " AND s.level=?"; args.push(level); }
  sql += " GROUP BY s.id ORDER BY points DESC, attempts ASC LIMIT 100";
  res.json({ leaderboard: db.prepare(sql).all(...args) });
});

// ── Teacher ──────────────────────────────────────────────────────────
app.get("/api/teacher/stats", auth, requireTeacher, (req, res) => {
  const one = sql => db.prepare(sql).get().c;
  const perLevel = db.prepare("SELECT level, COUNT(*) c FROM students WHERE active=1 GROUP BY level").all();
  res.json({
    students: one("SELECT COUNT(*) c FROM students WHERE active=1"),
    quizzes: one("SELECT COUNT(*) c FROM quizzes"),
    published: one("SELECT COUNT(*) c FROM quizzes WHERE published=1"),
    attempts: one("SELECT COUNT(*) c FROM attempts"),
    exam_attempts: one("SELECT COUNT(*) c FROM attempts WHERE mode='exam'"),
    bank: one("SELECT COUNT(*) c FROM bank_questions"),
    per_level: perLevel,
  });
});
function validateQuizBody(b) {
  if (!b.title || !String(b.title).trim()) return "Title is required.";
  if (!LEVELS.includes(b.level) && b.level !== "All") return "Invalid level.";
  if (!["practice", "exam", "both"].includes(b.modes || "both")) return "Invalid mode.";
  if (!["mcq", "write2"].includes(b.type || "mcq")) return "Invalid quiz type.";
  if (!Array.isArray(b.questions) || b.questions.length === 0) return "Add at least 1 question.";
  if ((b.type || "mcq") === "write2") {
    for (const q of b.questions) {
      const prompt = q.prompt !== undefined ? q.prompt : q.question;
      if (!prompt || !String(prompt).trim()) return "Every write2 question needs a prompt.";
      if (!Array.isArray(q.answers) || q.answers.length !== 2) return "Every write2 question needs exactly 2 answer boxes.";
      for (const box of q.answers) {
        if (!box.lang || !box.label) return "Every answer box needs a lang and a label.";
        if (!Array.isArray(box.accept) || box.accept.length === 0 || box.accept.some(a => !String(a).trim())) return "Every answer box needs at least 1 accepted answer.";
      }
    }
    return null;
  }
  for (const q of b.questions) {
    if (!q.question || !String(q.question).trim()) return "Every question needs text.";
    if (!Array.isArray(q.options) || q.options.length !== 4 || q.options.some(o => !String(o).trim())) return "Every question needs 4 options.";
    if (!(Number(q.correct_index) >= 0 && Number(q.correct_index) <= 3)) return "Choose the correct option for every question.";
  }
  return null;
}
function saveQuestions(quizId, questions, quizType) {
  db.prepare("DELETE FROM quiz_questions WHERE quiz_id=?").run(quizId);
  const ins = db.prepare("INSERT INTO quiz_questions (quiz_id, bank_id, question, options_json, correct_index, sort_order, qtype, prompt_lang, boxes_json, accept_json) VALUES (?,?,?,?,?,?,?,?,?,?)");
  questions.forEach((q, i) => {
    if ((quizType || q.type) === "write2") {
      const prompt = q.prompt !== undefined ? q.prompt : q.question;
      const boxes = q.answers.map(bx => ({ lang: String(bx.lang), label: String(bx.label), accept: bx.accept.map(a => String(a).trim()) }));
      ins.run(quizId, null, String(prompt).trim(), "[]", -1, i, "write2", String(q.prompt_lang || "en"), JSON.stringify(boxes.map(({ lang, label }) => ({ lang, label }))), JSON.stringify(boxes));
    } else {
      ins.run(quizId, q.bank_id || null, String(q.question).trim(), JSON.stringify(q.options.map(o => String(o).trim())), Number(q.correct_index), i, "mcq", "", null, null);
    }
  });
}
app.get("/api/teacher/quizzes", auth, requireTeacher, (req, res) => {
  res.json({ quizzes: db.prepare("SELECT * FROM quizzes ORDER BY id DESC").all().map(quizRow) });
});
app.get("/api/teacher/quizzes/:id", auth, requireTeacher, (req, res) => {
  const q = db.prepare("SELECT * FROM quizzes WHERE id=?").get(req.params.id);
  if (!q) return res.status(404).json({ error: "Quiz not found." });
  const qs = db.prepare("SELECT * FROM quiz_questions WHERE quiz_id=? ORDER BY sort_order, id").all(q.id)
    .map(x => x.qtype === "write2"
      ? { id: x.id, type: "write2", prompt: x.question, prompt_lang: x.prompt_lang || "en", answers: JSON.parse(x.accept_json || "[]") }
      : { id: x.id, bank_id: x.bank_id, question: x.question, options: JSON.parse(x.options_json || "[]"), correct_index: x.correct_index });
  res.json({ quiz: quizRow(q), questions: qs });
});
app.post("/api/teacher/quizzes", auth, requireTeacher, (req, res) => {
  const err = validateQuizBody(req.body || {}); if (err) return res.status(400).json({ error: err });
  const b = req.body;
  const r = db.prepare("INSERT INTO quizzes (title, level, programme, category, modes, time_minutes, published, type, points_per_box) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(String(b.title).trim(), b.level, b.programme || "CUSTOM", b.category || "General Knowledge", b.modes || "both", Math.max(1, Number(b.time_minutes) || 20), b.published ? 1 : 0, b.type || "mcq", Math.max(1, Number(b.points_per_box) || 1));
  saveQuestions(r.lastInsertRowid, b.questions, b.type || "mcq");
  res.json({ id: r.lastInsertRowid });
});
app.put("/api/teacher/quizzes/:id", auth, requireTeacher, (req, res) => {
  const q = db.prepare("SELECT * FROM quizzes WHERE id=?").get(req.params.id);
  if (!q) return res.status(404).json({ error: "Quiz not found." });
  const err = validateQuizBody(req.body || {}); if (err) return res.status(400).json({ error: err });
  const b = req.body;
  db.prepare("UPDATE quizzes SET title=?, level=?, programme=?, category=?, modes=?, time_minutes=?, published=?, type=?, points_per_box=? WHERE id=?")
    .run(String(b.title).trim(), b.level, b.programme || "CUSTOM", b.category || "General Knowledge", b.modes || "both", Math.max(1, Number(b.time_minutes) || 20), b.published ? 1 : 0, b.type || "mcq", Math.max(1, Number(b.points_per_box) || 1), q.id);
  saveQuestions(q.id, b.questions, b.type || "mcq");
  res.json({ ok: true });
});
app.delete("/api/teacher/quizzes/:id", auth, requireTeacher, (req, res) => {
  db.prepare("DELETE FROM quiz_questions WHERE quiz_id=?").run(req.params.id);
  db.prepare("DELETE FROM attempts WHERE quiz_id=?").run(req.params.id);
  db.prepare("DELETE FROM quizzes WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});
// Bulk import: JSON array OR CSV text -> parsed questions
app.post("/api/teacher/import", auth, requireTeacher, (req, res) => {
  const text = String((req.body || {}).text || "").trim();
  if (!text) return res.status(400).json({ error: "Paste JSON or CSV first." });
  try {
    if (text.startsWith("{")) {
      const obj = JSON.parse(text);
      if (obj.type === "write2" && Array.isArray(obj.questions)) {
        const questions = obj.questions.map(x => ({ prompt: x.prompt, prompt_lang: x.prompt_lang || "en", answers: x.answers }));
        const err = validateQuizBody({ title: "x", level: "Bidaya", type: "write2", questions });
        if (err) return res.status(400).json({ error: err });
        return res.json({ type: "write2", questions });
      }
      return res.status(400).json({ error: 'JSON object must be {"type":"write2","questions":[…]} — or paste a JSON array / CSV for MCQ.' });
    }
    if (text.startsWith("[")) {
      const arr = JSON.parse(text);
      if (arr.length && (arr[0].prompt !== undefined || arr[0].answers)) {
        const questions = arr.map(x => ({ prompt: x.prompt, prompt_lang: x.prompt_lang || "en", answers: x.answers }));
        const err = validateQuizBody({ title: "x", level: "Bidaya", type: "write2", questions });
        if (err) return res.status(400).json({ error: err });
        return res.json({ type: "write2", questions });
      }
      const questions = arr.map(x => ({
        question: x.question, options: x.options || [x.opt1, x.opt2, x.opt3, x.opt4],
        correct_index: Number(x.correct_index !== undefined ? x.correct_index : x.correct),
      }));
      const err = validateQuizBody({ title: "x", level: "Bidaya", questions }); if (err) return res.status(400).json({ error: err });
      return res.json({ type: "mcq", questions });
    }
    // Simple CSV: question,opt1,opt2,opt3,opt4,correct_index (quotes supported)
    const rows = [];
    let row = [], field = "", inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) { if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += ch; }
      else if (ch === '"') inQ = true;
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\n" || ch === "\r") { if (field !== "" || row.length) { row.push(field); field = ""; rows.push(row); row = []; } if (ch === "\r" && text[i + 1] === "\n") i++; }
      else field += ch;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    const questions = rows.filter(r => r.length >= 6 && r[0].toLowerCase() !== "question")
      .map(r => ({ question: r[0], options: [r[1], r[2], r[3], r[4]], correct_index: Number(r[5]) }));
    const err = validateQuizBody({ title: "x", level: "Bidaya", questions }); if (err) return res.status(400).json({ error: "CSV parse failed: " + err });
    res.json({ questions });
  } catch (e) { res.status(400).json({ error: "Could not parse import: " + e.message }); }
});
app.get("/api/teacher/bank", auth, requireTeacher, (req, res) => {
  const { search = "", category = "", source = "", section = "" } = req.query;
  let sql = "SELECT * FROM bank_questions WHERE 1=1"; const args = [];
  if (search) { sql += " AND question LIKE ?"; args.push("%" + search + "%"); }
  if (category) { sql += " AND category=?"; args.push(category); }
  if (source) { sql += " AND source=?"; args.push(source); }
  if (section) { sql += " AND section=?"; args.push(section); }
  sql += " ORDER BY source, section, orig_number LIMIT 500";
  const rows = db.prepare(sql).all(...args).map(r => ({ ...r, options: JSON.parse(r.options_json) }));
  const facets = db.prepare("SELECT source, section, category, level, COUNT(*) c FROM bank_questions GROUP BY source, section, category, level ORDER BY source, section").all();
  res.json({ total: db.prepare("SELECT COUNT(*) c FROM bank_questions").get().c, questions: rows, facets });
});
app.post("/api/teacher/quizzes/from-bank", auth, requireTeacher, (req, res) => {
  const b = req.body || {};
  if (!b.title || !String(b.title).trim()) return res.status(400).json({ error: "Title is required." });
  if (!LEVELS.includes(b.level) && b.level !== "All") return res.status(400).json({ error: "Invalid level." });
  let sql = "SELECT * FROM bank_questions WHERE 1=1"; const args = [];
  if (b.source) { sql += " AND source=?"; args.push(b.source); }
  if (b.category) { sql += " AND category=?"; args.push(b.category); }
  if (b.section) { sql += " AND section=?"; args.push(b.section); }
  sql += " ORDER BY orig_number";
  let pool = db.prepare(sql).all(...args);
  if (!pool.length) return res.status(400).json({ error: "No bank questions match those filters." });
  // Deterministic pseudo-random pick: stride selection seeded by title length
  const count = Math.min(Math.max(1, Number(b.count) || 10), pool.length);
  const seedN = [...String(b.title)].reduce((a, c) => a + c.charCodeAt(0), 0);
  const picked = []; const used = new Set();
  let idx = seedN % pool.length;
  while (picked.length < count) { if (!used.has(idx)) { used.add(idx); picked.push(pool[idx]); } idx = (idx + 7) % pool.length; if (used.size >= pool.length) break; }
  const r = db.prepare("INSERT INTO quizzes (title, level, programme, category, modes, time_minutes, published) VALUES (?,?,?,?,?,?,1)")
    .run(String(b.title).trim(), b.level, b.programme || "CUSTOM", b.category || picked[0].category, b.modes || "both", Math.max(1, Number(b.time_minutes) || 20));
  const ins = db.prepare("INSERT INTO quiz_questions (quiz_id, bank_id, question, options_json, correct_index, sort_order) VALUES (?,?,?,?,?,?)");
  picked.forEach((p, i) => ins.run(r.lastInsertRowid, p.id, p.question, p.options_json, p.correct_index, i));
  res.json({ id: r.lastInsertRowid, count: picked.length });
});
app.get("/api/teacher/quizzes/:id/results", auth, requireTeacher, (req, res) => {
  const rows = db.prepare(`SELECT a.*, s.name, s.level, s.adm_no, s.class_section FROM attempts a JOIN students s ON s.id=a.student_id WHERE a.quiz_id=? ORDER BY a.score DESC, a.id`).all(req.params.id);
  res.json({ results: rows });
});
app.get("/api/teacher/quizzes/:id/results.csv", auth, requireTeacher, (req, res) => {
  const q = db.prepare("SELECT title FROM quizzes WHERE id=?").get(req.params.id);
  if (!q) return res.status(404).json({ error: "Quiz not found." });
  const rows = db.prepare(`SELECT s.name, s.level, s.adm_no, s.class_section, a.mode, a.score, a.total, a.created_at FROM attempts a JOIN students s ON s.id=a.student_id WHERE a.quiz_id=? ORDER BY a.id`).all(req.params.id);
  const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = ["Name,Level,Adm No,Class,Mode,Score,Total,Percent,Date",
    ...rows.map(r => [r.name, r.level, r.adm_no, r.class_section, r.mode, r.score, r.total, r.total ? Math.round(100 * r.score / r.total) : 0, r.created_at].map(esc).join(","))].join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="quiz-${req.params.id}-results.csv"`);
  res.send(csv);
});
app.get("/api/teacher/students", auth, requireTeacher, (req, res) => {
  res.json({ students: db.prepare("SELECT id, name, level, class_section, adm_no, active, created_at FROM students ORDER BY level, name").all() });
});
app.patch("/api/teacher/students/:id", auth, requireTeacher, (req, res) => {
  const s = db.prepare("SELECT * FROM students WHERE id=?").get(req.params.id);
  if (!s) return res.status(404).json({ error: "Student not found." });
  db.prepare("UPDATE students SET active=? WHERE id=?").run(req.body.active ? 1 : 0, s.id);
  res.json({ ok: true });
});
app.delete("/api/teacher/students/:id", auth, requireTeacher, (req, res) => {
  db.prepare("DELETE FROM attempts WHERE student_id=?").run(req.params.id);
  db.prepare("DELETE FROM sessions WHERE user_id=? AND role='student'").run(req.params.id);
  db.prepare("DELETE FROM students WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`SIBAQ Quiz Portal listening on http://localhost:${PORT} (DB: ${DB_PATH})`));
