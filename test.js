// test.js — end-to-end tests against a scratch server (temp DB, test port).
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = 3217;
const BASE = `http://localhost:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qp-test-"));
const DB = path.join(tmp, "test.db");
let passed = 0, failed = 0;
function ok(name, cond, extra = "") { if (cond) { passed++; console.log(`  ✅ ${name}`); } else { failed++; console.log(`  ❌ ${name} ${extra}`); } }
async function call(method, url, body, token) {
  const r = await fetch(BASE + url, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  return { status: r.status, d };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const srv = spawn(process.execPath, ["server.js"], { cwd: __dirname, env: { ...process.env, PORT: String(PORT), DB_PATH: DB }, stdio: "pipe" });
  let srvLog = "";
  srv.stdout.on("data", d => srvLog += d); srv.stderr.on("data", d => srvLog += d);
  try {
    for (let i = 0; i < 50; i++) { try { const r = await fetch(BASE + "/api/meta"); if (r.ok) break; } catch {} await sleep(200); }
    console.log("Quiz Portal tests");

    const tl = await call("POST", "/api/auth/teacher-login", { username: "samad", password: "QuizPortal@2026" });
    ok("teacher login", tl.status === 200 && !!tl.d.token, JSON.stringify(tl.d));
    const T = tl.d.token;

    const reg = await call("POST", "/api/auth/register", { name: "Test Student", level: "Bidaya", class_section: "S1", adm_no: "TST001", pin: "1234" });
    ok("student register", reg.status === 200 && !!reg.d.token, JSON.stringify(reg.d));
    const S = reg.d.token;
    const sl = await call("POST", "/api/auth/student-login", { adm_no: "TST001", pin: "1234" });
    ok("student login", sl.status === 200 && !!sl.d.token);
    const badPin = await call("POST", "/api/auth/student-login", { adm_no: "TST001", pin: "9999" });
    ok("wrong PIN rejected", badPin.status === 401);
    const dup = await call("POST", "/api/auth/register", { name: "Dup", level: "Ula", adm_no: "TST001", pin: "5555" });
    ok("duplicate adm_no rejected", dup.status === 409);

    const blocked = await call("GET", "/api/teacher/stats", null, S);
    ok("student blocked from teacher API (403)", blocked.status === 403, "got " + blocked.status);
    const blocked2 = await call("POST", "/api/teacher/quizzes", { title: "x" }, S);
    ok("student cannot create quiz (403)", blocked2.status === 403);

    const stats = await call("GET", "/api/teacher/stats", null, T);
    ok("bank seeded > 0", stats.d.bank > 250, "bank=" + stats.d.bank);
    ok("stats students >= 1", stats.d.students >= 1);

    const bank = await call("GET", "/api/teacher/bank?source=GK", null, T);
    ok("bank GK questions present", bank.d.questions.length > 0 && bank.d.total > 250);

    // Create quiz via teacher API (2 questions)
    const questions = [
      { question: "Capital of India?", options: ["New Delhi", "Mumbai", "Chennai", "Kolkata"], correct_index: 0 },
      { question: "First Surah?", options: ["Al-Baqarah", "Al-Fatiha", "Ya-Sin", "Al-Mulk"], correct_index: 1 },
    ];
    const cq = await call("POST", "/api/teacher/quizzes", { title: "Test Quiz", level: "Bidaya", programme: "BNS30", category: "General Knowledge", modes: "both", time_minutes: 10, published: true, questions }, T);
    ok("teacher creates quiz", cq.status === 200 && !!cq.d.id, JSON.stringify(cq.d));
    const qid = cq.d.id;

    const list = await call("GET", "/api/quizzes", null, S);
    ok("student sees published quiz", list.d.quizzes.some(q => q.id === qid));
    const getq = await call("GET", "/api/quizzes/" + qid, null, S);
    ok("quiz questions hide answers", getq.d.questions.length === 2 && getq.d.questions[0].correct_index === undefined);

    // Practice: check endpoint gives instant feedback
    const firstQ = getq.d.questions[0];
    const chk = await call("POST", `/api/quizzes/${qid}/check`, { question_id: firstQ.id, selected: 0 }, S);
    ok("practice instant check (correct)", chk.status === 200 && chk.d.correct === true && chk.d.correct_index === 0);
    const chkBad = await call("POST", `/api/quizzes/${qid}/check`, { question_id: firstQ.id, selected: 2 }, S);
    ok("practice instant check (wrong shows correct)", chkBad.d.correct === false && chkBad.d.correct_index === 0);

    const answers = {}; getq.d.questions.forEach((q, i) => answers[q.id] = i === 0 ? 0 : 1); // both correct by construction? q2 correct=1
    // q1 correct 0, q2 correct 1 -> answers above give 2/2
    const prac = await call("POST", `/api/quizzes/${qid}/submit`, { mode: "practice", answers }, S);
    ok("practice submit scores", prac.status === 200 && prac.d.score === 2 && prac.d.total === 2, JSON.stringify(prac.d));
    const prac2 = await call("POST", `/api/quizzes/${qid}/submit`, { mode: "practice", answers }, S);
    ok("practice unlimited attempts", prac2.status === 200);

    const exam = await call("POST", `/api/quizzes/${qid}/submit`, { mode: "exam", answers }, S);
    ok("exam submit scores", exam.status === 200 && exam.d.score === 2, JSON.stringify(exam.d));
    const exam2 = await call("POST", `/api/quizzes/${qid}/submit`, { mode: "exam", answers }, S);
    ok("second exam attempt rejected", exam2.status === 403, "got " + exam2.status);

    const lb = await call("GET", "/api/leaderboard", null, S);
    ok("leaderboard contains exam points", lb.d.leaderboard.some(r => r.adm_no === "TST001" && r.points === 2), JSON.stringify(lb.d.leaderboard));
    const lbPracticeOnly = lb.d.leaderboard.find(r => r.adm_no === "TST001");
    ok("leaderboard counts exam only (attempts=1)", lbPracticeOnly && lbPracticeOnly.attempts === 1);

    const mine = await call("GET", "/api/my-results", null, S);
    ok("my results has 3 attempts (2 practice + 1 exam)", mine.d.results.length === 3, "got " + mine.d.results.length);

    // Sample quizzes exist
    const tq = await call("GET", "/api/teacher/quizzes", null, T);
    const titles = tq.d.quizzes.map(q => q.title);
    ok("sample quiz: GK Practice Set 1", titles.includes("SIBAQ GK Quiz — Practice Set 1"), titles.join(" | "));
    ok("sample quiz: Seerah", titles.includes("Islamic History — Seerah"));
    ok("sample quiz: Rashidun", titles.includes("Islamic History — Rashidun Caliphs"));

    // Import endpoint
    const imp = await call("POST", "/api/teacher/import", { text: "What is 2+2?,3,4,5,6,1" }, T);
    ok("CSV bulk import parses", imp.status === 200 && imp.d.questions.length === 1 && imp.d.questions[0].correct_index === 1, JSON.stringify(imp.d));

    // From-bank creation
    const fb = await call("POST", "/api/teacher/quizzes/from-bank", { title: "Bank Test Quiz", level: "Bidaya", source: "IslamicHistory", section: "Seerah", count: 10, modes: "both", time_minutes: 10 }, T);
    ok("create quiz from bank (10 Qs)", fb.status === 200 && fb.d.count === 10, JSON.stringify(fb.d));

    // Results + CSV
    const res1 = await call("GET", `/api/teacher/quizzes/${qid}/results`, null, T);
    ok("teacher results per quiz", res1.d.results.length >= 1 && res1.d.results[0].name === "Test Student");
    const csvR = await fetch(BASE + `/api/teacher/quizzes/${qid}/results.csv`, { headers: { Authorization: "Bearer " + T } });
    const csv = await csvR.text();
    ok("results CSV export", csvR.status === 200 && csv.includes("Test Student") && csv.includes("Name,Level"));

    // Change password flow
    const cp = await call("POST", "/api/teacher/change-password", { old_password: "QuizPortal@2026", new_password: "NewPass@2026" }, T);
    ok("teacher change password", cp.status === 200);
    const tl2 = await call("POST", "/api/auth/teacher-login", { username: "samad", password: "NewPass@2026" });
    ok("teacher login with new password", tl2.status === 200);

    // ── write2 (written translation) ──────────────────────────────
    const w2questions = [
      { prompt_lang: "en", prompt: "Head", answers: [
        { lang: "ur", label: "Urdu", accept: ["\u0633\u0631"] },
        { lang: "ar", label: "Arabic", accept: ["\u0631\u064E\u0623\u0652\u0633"] } ] },   // رأس with harakat
      { prompt_lang: "en", prompt: "Book", answers: [
        { lang: "ur", label: "Urdu", accept: ["\u06A9\u062A\u0627\u0628"] },
        { lang: "ar", label: "Arabic", accept: ["\u0643\u0650\u062A\u064E\u0627\u0628"] } ] }, // كِتَاب with harakat
      { prompt_lang: "ur", prompt: "\u0633\u0631", answers: [
        { lang: "en", label: "English", accept: ["Head"] },
        { lang: "ar", label: "Arabic", accept: ["\u0631\u064E\u0623\u0652\u0633"] } ] },   // rotating prompt: Urdu prompt -> English + Arabic
    ];
    const w2create = await call("POST", "/api/teacher/quizzes", { title: "Vocab write2 Test", type: "write2", points_per_box: 1, level: "Ula", programme: "UNO17", category: "Arabic & Grammar", modes: "both", time_minutes: 30, published: true, questions: w2questions }, T);
    ok("teacher creates write2 quiz (UNO17)", w2create.status === 200 && !!w2create.d.id, JSON.stringify(w2create.d));
    const w2id = w2create.d.id;
    const w2get = await call("GET", "/api/quizzes/" + w2id, null, S);
    ok("write2 student view: prompts + boxes, NO accept lists leaked",
      w2get.d.questions.length === 3 && w2get.d.questions[0].prompt === "Head" &&
      w2get.d.questions[0].boxes.length === 2 && w2get.d.questions[0].boxes[0].label === "Urdu" &&
      JSON.stringify(w2get.d.questions).indexOf("\u0631\u064E\u0623") === -1 && w2get.d.questions[0].boxes[0].accept === undefined,
      JSON.stringify(w2get.d.questions).slice(0, 300));
    ok("write2 rotating prompt_lang preserved (Q3 prompt is Urdu)", w2get.d.questions[2].prompt_lang === "ur" && w2get.d.questions[2].boxes[0].lang === "en");
    const wq = w2get.d.questions;
    // Practice check Q1: Arabic WITHOUT harakat vs accept WITH harakat -> correct; Urdu correct
    const wchk = await call("POST", `/api/quizzes/${w2id}/check`, { question_id: wq[0].id, answers: ["\u0633\u0631", "\u0631\u0627\u0633"] }, S);
    ok("write2 practice check: harakat-less Arabic marked correct", wchk.status === 200 && wchk.d.boxes[1].correct === true, JSON.stringify(wchk.d));
    ok("write2 practice check: Urdu box correct", wchk.d.boxes[0].correct === true);
    // Exam submit: Q1 both correct (2), Q2 Urdu WRONG + Arabic harakat-less correct (1), Q3 English case-insensitive + Arabic correct (2) => 5/6 boxes
    const wAnswers = {};
    wAnswers[wq[0].id] = ["\u0633\u0631", "\u0631\u0627\u0633"];
    wAnswers[wq[1].id] = ["\u067E\u0627\u0646\u06CC", "\u0643\u062A\u0627\u0628"]; // پانی wrong for Book-Urdu; كتاب correct Arabic
    wAnswers[wq[2].id] = ["head", "\u0631\u0627\u0633"];
    const wexam = await call("POST", `/api/quizzes/${w2id}/submit`, { mode: "exam", answers: wAnswers }, S);
    ok("write2 exam: points = correct boxes (5/6)", wexam.status === 200 && wexam.d.score === 5 && wexam.d.total === 6, JSON.stringify(wexam.d).slice(0, 400));
    ok("write2 exam: wrong box marked wrong, correct answer shown", wexam.d.detail[1].boxes[0].correct === false && wexam.d.detail[1].boxes[0].correct_answers.length === 1);
    ok("write2 exam: per-box review present", wexam.d.detail.every(x => Array.isArray(x.boxes) && x.boxes.length === 2));
    const wexam2 = await call("POST", `/api/quizzes/${w2id}/submit`, { mode: "exam", answers: wAnswers }, S);
    ok("write2 second exam attempt rejected", wexam2.status === 403);
    // write2 bulk import format
    const wimp = await call("POST", "/api/teacher/import", { text: JSON.stringify({ type: "write2", questions: [{ prompt_lang: "ar", prompt: "\u0643\u062A\u0627\u0628", answers: [{ lang: "en", label: "English", accept: ["Book"] }, { lang: "ur", label: "Urdu", accept: ["\u06A9\u062A\u0627\u0628"] }] }] }) }, T);
    ok("write2 bulk JSON import parses", wimp.status === 200 && wimp.d.type === "write2" && wimp.d.questions.length === 1 && wimp.d.questions[0].prompt_lang === "ar", JSON.stringify(wimp.d).slice(0, 300));

    // ── UNO17 Vocabulary seeded quizzes ─────────────────────────
    const loadVocabFile = n => JSON.parse(fs.readFileSync(path.join(__dirname, "vocab-tests", n), "utf8"));
    const vp1 = loadVocabFile("test_part1_70.json"), vp2 = loadVocabFile("test_part2_70.json"), vp3 = loadVocabFile("test_part3_70.json");
    const vmBody = loadVocabFile("practice_mcq_body_105.json"), vmAnimals = loadVocabFile("practice_mcq_animals_birds_105.json");
    const vocabTitles = [vp1.title, vp2.title, vp3.title, vmBody.title, vmAnimals.title];
    let vocabJson = null;
    try { vocabJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vocab-uno17", "vocab.json"), "utf8")); } catch {}
    const vEntry = n => vocabJson ? vocabJson.find(v => v.global_no === n) : null;

    const tq2 = await call("GET", "/api/teacher/quizzes", null, T);
    const vQuizzes = tq2.d.quizzes.filter(q => vocabTitles.includes(q.title));
    ok("(a) all 5 UNO17 vocab quizzes seeded", vQuizzes.length === 5, "got " + vQuizzes.length + " of: " + tq2.d.quizzes.map(q => q.title).join(" | "));
    const vByTitle = Object.fromEntries(vQuizzes.map(q => [q.title, q]));
    ok("(a) written parts have 70 questions each (write2, Ula, practice+exam, 40 min)",
      [vp1, vp2, vp3].every(p => vByTitle[p.title] && vByTitle[p.title].question_count === 70 && vByTitle[p.title].type === "write2" && vByTitle[p.title].level === "Ula" && vByTitle[p.title].modes === "both" && vByTitle[p.title].time_minutes === 40),
      JSON.stringify([vp1, vp2, vp3].map(p => vByTitle[p.title])));
    ok("(a) MCQ practice sets have 105 questions each (mcq, practice only)",
      [vmBody, vmAnimals].every(p => vByTitle[p.title] && vByTitle[p.title].question_count === 105 && vByTitle[p.title].type === "mcq" && vByTitle[p.title].modes === "practice"),
      JSON.stringify([vmBody, vmAnimals].map(p => vByTitle[p.title])));

    const regU = await call("POST", "/api/auth/register", { name: "Ula Vocab Tester", level: "Ula", class_section: "S2", adm_no: "ULA001", pin: "4321" });
    ok("Ula student registers for vocab tests", regU.status === 200 && !!regU.d.token, JSON.stringify(regU.d));
    const U = regU.d.token;

    // (b) Part 1 — English prompt, write Urdu + Arabic (vocab.json entry 1: Head)
    const e1 = vEntry(1);
    ok("vocab entry 1 cross-check (file accepts contain سر and رأس)",
      vp1.questions[0].answers[0].accept.includes("\u0633\u0631") && vp1.questions[0].answers[1].accept.some(a => a === (e1 ? e1.arabic : "رأس") || a === (e1 ? e1.arabic_plain : "رأس")),
      JSON.stringify(vp1.questions[0]));
    const p1get = await call("GET", "/api/quizzes/" + vByTitle[vp1.title].id, null, U);
    ok("Ula student opens Part 1 (70 write2 questions, accept lists not leaked)",
      p1get.d.questions.length === 70 && p1get.d.questions[0].prompt_lang === "en" && p1get.d.questions[0].boxes.length === 2 && p1get.d.questions[0].boxes[0].accept === undefined,
      JSON.stringify(p1get.d.questions[0]).slice(0, 300));
    const p1q1 = p1get.d.questions[0];
    const chk1 = await call("POST", `/api/quizzes/${vByTitle[vp1.title].id}/check`, { question_id: p1q1.id, answers: ["\u0633\u0631", "\u0631\u0627\u0633"] }, U); // سر + راس (harakat-less, plain alef)
    ok("(b) Part 1 Q1 practice check: Urdu box correct", chk1.status === 200 && chk1.d.boxes[0].correct === true, JSON.stringify(chk1.d));
    ok("(b) Part 1 Q1 practice check: harakat-less Arabic راس correct (2/2 boxes)", chk1.d.boxes[1].correct === true && chk1.d.correct_boxes === 2, JSON.stringify(chk1.d));
    const p1answers = {}; p1answers[p1q1.id] = ["\u0633\u0631", "\u0631\u0627\u0633"];
    const p1sub = await call("POST", `/api/quizzes/${vByTitle[vp1.title].id}/submit`, { mode: "practice", answers: p1answers }, U);
    ok("(b) Part 1 practice submit: Q1 earns full points for the question (2 pts)",
      p1sub.status === 200 && p1sub.d.score === 2 && p1sub.d.detail[0].boxes.every(b => b.correct), JSON.stringify(p1sub.d).slice(0, 300));

    // (d) Part 2 — Urdu prompt; a wrong English answer must be marked wrong
    const p2get = await call("GET", "/api/quizzes/" + vByTitle[vp2.title].id, null, U);
    const p2q1 = p2get.d.questions[0];
    ok("Part 2 Q1 is an Urdu prompt with English + Arabic boxes",
      p2q1.prompt_lang === "ur" && p2q1.boxes.map(b => b.lang).join(",") === "en,ar", JSON.stringify(p2q1).slice(0, 300));
    const chk2 = await call("POST", `/api/quizzes/${vByTitle[vp2.title].id}/check`, { question_id: p2q1.id, answers: ["Banana", "\u0642\u062F\u0645"] }, U); // wrong EN, correct قدم
    ok("(d) Part 2 Q1: wrong English answer marked wrong", chk2.status === 200 && chk2.d.boxes[0].correct === false, JSON.stringify(chk2.d));
    ok("Part 2 Q1: correct Arabic answer still marked correct", chk2.d.boxes[1].correct === true, JSON.stringify(chk2.d));

    // (c) Part 3 — Arabic prompt (vocab.json global 141: Crocodile)
    const e141 = vEntry(141);
    const en141 = e141 ? e141.english : vp3.questions[0].answers[0].accept[0];
    const ur141 = e141 ? e141.urdu : vp3.questions[0].answers[1].accept[0];
    const p3get = await call("GET", "/api/quizzes/" + vByTitle[vp3.title].id, null, U);
    const p3q1 = p3get.d.questions[0];
    ok("Part 3 Q1 is an Arabic prompt with English + Urdu boxes",
      p3q1.prompt_lang === "ar" && p3q1.boxes.map(b => b.lang).join(",") === "en,ur", JSON.stringify(p3q1).slice(0, 300));
    const chk3 = await call("POST", `/api/quizzes/${vByTitle[vp3.title].id}/check`, { question_id: p3q1.id, answers: [en141, ur141] }, U);
    ok("(c) Part 3 Q1: English answer (from vocab global 141) correct", chk3.status === 200 && chk3.d.boxes[0].correct === true, JSON.stringify(chk3.d) + " sent: " + en141);
    ok("(c) Part 3 Q1: Urdu answer (from vocab global 141) correct (2/2 boxes)", chk3.d.boxes[1].correct === true && chk3.d.correct_boxes === 2, JSON.stringify(chk3.d) + " sent: " + ur141);

    // (e) Re-running the vocab seeding must not duplicate the quizzes
    const { DatabaseSync } = require("node:sqlite");
    const { seedVocabQuizzes } = require("./seed");
    const db2 = new DatabaseSync(DB);
    const again1 = seedVocabQuizzes(db2);
    const again2 = seedVocabQuizzes(db2);
    const titleRows = db2.prepare("SELECT title, COUNT(*) c FROM quizzes WHERE title IN (?,?,?,?,?) GROUP BY title").all(...vocabTitles);
    db2.close();
    ok("(e) re-running vocab seeding adds 0 and keeps the 5 titles exactly once each",
      again1.added === 0 && again2.added === 0 && titleRows.length === 5 && titleRows.every(r => r.c === 1),
      JSON.stringify({ again1, again2, titleRows }));

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed) { console.log("Server log:\n" + srvLog); process.exitCode = 1; }
  } finally {
    srv.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
