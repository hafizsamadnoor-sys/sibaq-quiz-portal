// seed.js — loads seed-data.json (built by tools/build-seed-data.py from
// Samad's own PDFs) into the question bank on first start, and creates
// 3 ready-to-play sample quizzes. Runs only when the bank is empty.
const fs = require("fs");
const path = require("path");

function seedIfEmpty(db) {
  const c = db.prepare("SELECT COUNT(*) c FROM bank_questions").get().c;
  if (c > 0) return { seeded: 0, skipped: 0, samples: 0 };
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, "seed-data.json"), "utf8"));
  const ins = db.prepare(
    "INSERT INTO bank_questions (source, section, category, level, question, options_json, correct_index, orig_number) VALUES (?,?,?,?,?,?,?,?)"
  );
  for (const b of data.bank) {
    ins.run(b.source, b.section, b.category, b.level, b.question, JSON.stringify(b.options), b.correct_index, b.number);
  }
  // Sample quizzes
  const bank = db.prepare("SELECT * FROM bank_questions ORDER BY id").all();
  const pick = (fn, n) => bank.filter(fn).slice(0, n);
  const mkQuiz = (title, level, programme, category, modes, mins, questions) => {
    const q = db.prepare(
      "INSERT INTO quizzes (title, level, programme, category, modes, time_minutes, published) VALUES (?,?,?,?,?,?,1)"
    ).run(title, level, programme, category, modes, mins);
    const qi = db.prepare(
      "INSERT INTO quiz_questions (quiz_id, bank_id, question, options_json, correct_index, sort_order) VALUES (?,?,?,?,?,?)"
    );
    questions.forEach((b, i) => qi.run(q.lastInsertRowid, b.id, b.question, b.options_json, b.correct_index, i));
    return q.lastInsertRowid;
  };
  let samples = 0;
  const gk = pick(b => b.source === "GK", 20);
  if (gk.length) { mkQuiz("SIBAQ GK Quiz — Practice Set 1", "Bidaya", "BNS30", "General Knowledge", "both", 20, gk); samples++; }
  const seerah = pick(b => b.source === "IslamicHistory" && b.section === "Seerah", 20);
  if (seerah.length) { mkQuiz("Islamic History — Seerah", "Bidaya", "BNS30", "Islamic History", "both", 20, seerah); samples++; }
  const rashidun = pick(b => b.source === "IslamicHistory" && b.section === "Rashidun Caliphs", 15);
  if (rashidun.length) { mkQuiz("Islamic History — Rashidun Caliphs", "Ula", "UNO26", "Islamic History", "practice", 15, rashidun); samples++; }
  return { seeded: data.bank.length, skipped: (data.skipped || []).length, samples };
}

// ── UNO17 Vocabulary quizzes ─────────────────────────────────────────
// The 5 finished UNO17 quizzes ship as JSON files in vocab-tests/ (built
// by the vocab workstream from the National Vocabulary Olympiad guide,
// pp.2–7: 210 words). They are seeded on EVERY start, each exactly once —
// existence is checked by title, so restarts and DBs that predate this
// feature pick the quizzes up without ever duplicating them.
const VOCAB_FILES = [
  "test_part1_70.json",
  "test_part2_70.json",
  "test_part3_70.json",
  "practice_mcq_body_105.json",
  "practice_mcq_animals_birds_105.json",
];
function programmeCode(p) {
  const m = String(p || "").trim().match(/^([A-Z]{2,}\d+)/);
  return m ? m[1] : (String(p || "CUSTOM").trim() || "CUSTOM");
}
function seedVocabQuizzes(db) {
  const dir = path.join(__dirname, "vocab-tests");
  let added = 0, present = 0;
  const insQuiz = db.prepare(
    "INSERT INTO quizzes (title, level, programme, category, modes, time_minutes, published, type, points_per_box) VALUES (?,?,?,?,?,?,1,?,?)"
  );
  const insQ = db.prepare(
    "INSERT INTO quiz_questions (quiz_id, bank_id, question, options_json, correct_index, sort_order, qtype, prompt_lang, boxes_json, accept_json) VALUES (?,?,?,?,?,?,?,?,?,?)"
  );
  for (const file of VOCAB_FILES) {
    let data;
    try { data = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")); }
    catch (e) { console.error(`[seed] vocab-tests/${file}: ${e.message} — skipped`); continue; }
    const title = String(data.title || "").trim();
    if (!title || !Array.isArray(data.questions) || !data.questions.length) {
      console.error(`[seed] vocab-tests/${file}: missing title/questions — skipped`); continue;
    }
    if (db.prepare("SELECT id FROM quizzes WHERE title=?").get(title)) { present++; continue; }
    const type = data.type === "write2" ? "write2" : "mcq";
    const modes = data.modes || data.mode || (type === "write2" ? "both" : "practice");
    const mins = Math.max(1, Number(data.time_minutes) || (type === "write2" ? 40 : 30));
    const ppb = Math.max(1, Number(data.points_per_correct) || 1);
    const r = insQuiz.run(title, data.level || "Ula", programmeCode(data.programme),
      data.category || "Vocabulary", modes, mins, type, ppb);
    const quizId = r.lastInsertRowid;
    data.questions.forEach((q, i) => {
      if (type === "write2") {
        // Only schema keys are read; extra keys (ref, global_no) are ignored.
        const boxes = (q.answers || []).map(bx => ({
          lang: String(bx.lang), label: String(bx.label),
          accept: (bx.accept || []).map(a => String(a).trim()),
        }));
        insQ.run(quizId, null, String(q.prompt ?? q.question ?? "").trim(), "[]", -1, i,
          "write2", String(q.prompt_lang || "en"),
          JSON.stringify(boxes.map(({ lang, label }) => ({ lang, label }))), JSON.stringify(boxes));
      } else {
        insQ.run(quizId, null, String(q.question ?? "").trim(),
          JSON.stringify((q.options || []).map(o => String(o).trim())), Number(q.correct_index), i,
          "mcq", "", null, null);
      }
    });
    added++;
  }
  return { added, present };
}
module.exports = { seedIfEmpty, seedVocabQuizzes };
