# SIBAQ '26 Quiz Portal — Noorul Huda Islamic Academy

Standalone quiz portal for **SIBAQ '26 / the whole school**, organised by SIBAQ levels
(Bidaya, Ula, Thanawiyya, Aliyah, Kulliyya) and quiz programmes from the NIICS concept note.
Institution: **Noorul Huda Centre for Excellence · Noorul Huda Islamic Academy**.

Stack: Node.js (≥22) + Express (only dependency) + SQLite via built-in `node:sqlite`.
Plain HTML/CSS/JS in `public/` — no build step.

## Run locally

```bash
npm install
npm start          # http://localhost:3000  (PORT env to change)
npm test           # end-to-end tests on a scratch DB / test port
```

The SQLite database lives in `data/quiz.db` (override with `DB_PATH`).
On first start the server automatically:
1. Creates one teacher account (see below).
2. Seeds the question bank from `seed-data.json` and creates 3 sample quizzes.
3. Seeds the 5 UNO17 Vocabulary quizzes from `vocab-tests/` (see below) —
   checked by title on every start, so they are added once and never duplicated,
   including on databases created before this feature existed.

## Logins

- **Students** self-register: full name, level, class/section, admission/chest number
  (unique), and their own **4-digit PIN** (stored hashed, never in plain text).
  Login = admission number + PIN.
- **Teacher (temporary — CHANGE IT after first login):**
  - Username: `samad`
  - Temporary password: `QuizPortal@2026`
  - Change it in Teacher Panel → 🔐 Account. This password is temporary and public
    in this README by design so the first login works — change it immediately.

## Question types

### 1. MCQ (default)
4 options, tap the correct one. Practice mode = instant right/wrong per question,
unlimited attempts. Exam mode = **1 attempt only** (enforced on the server),
points = correct answers, full review after submit. Timer with auto-submit.

Bulk import (Teacher Panel → Create Quiz):
- JSON: `[{"question":"…","opt1":"…","opt2":"…","opt3":"…","opt4":"…","correct_index":0}]`
- CSV, one per line: `question,opt1,opt2,opt3,opt4,correct_index` (correct_index 0–3)

### 2. ✍️ write2 — Written translation (UNO17 Vocabulary)
Each question shows a **prompt word in one language** and **2 typed answer boxes**
in the other two languages. The prompt language **rotates by test part**
(e.g. Part 1: English prompt → write Urdu + Arabic · Part 2: Urdu prompt →
write English + Arabic · Part 3: Arabic prompt → write English + Urdu).
The UI renders the prompt and each answer box LTR or RTL from the data
(`prompt_lang` / box `lang`), with a larger script-friendly font for Arabic/Urdu.

Scoring: each box is auto-marked separately, **points per box** (default 1,
configurable per quiz in the editor). Practice = instant per-box ✓/✗ with the
correct answer; exam = 1 attempt, review after submit.

Marking normalisation (applied to stored answers and student input alike):
trim, collapse spaces, lowercase Latin; Arabic: strip harakat/diacritics
(U+064B–U+0652, U+0670) and tatweel, أ إ آ → ا, ى → ي; Urdu: ي → ی, ك → ک.
An answer is correct if it matches **any** accepted variant after normalisation.

Bulk import for write2 (Teacher Panel → Create Quiz → Bulk Import):
```json
{"type":"write2","questions":[
  {"prompt_lang":"en","prompt":"Head",
   "answers":[{"lang":"ur","label":"Urdu","accept":["سر"]},
              {"lang":"ar","label":"Arabic","accept":["رأس"]}]}
]}
```

## UNO17 Vocabulary tests (seeded from `vocab-tests/`)

Built from the *National Vocabulary Olympiad Masterclass Guide*, pages 2–7 —
**210 words**: Human Body (105) + Animals & Birds (105), transcribed from the
guide's page images (Arabic/Urdu included; Malayalam is the practice direction).
All five quizzes are published, level **Ula**, programme **UNO17**:

| Quiz | Type | Format | Questions | Time | Points |
|---|---|---|---|---|---|
| Part 1 · English → Urdu + Arabic (Words 1–70) | write2 | practice + exam | 70 | 40 min | 140 (1 pt per language box) |
| Part 2 · Urdu → English + Arabic (Words 71–140) | write2 | practice + exam | 70 | 40 min | 140 |
| Part 3 · Arabic → English + Urdu (Words 141–210) | write2 | practice + exam | 70 | 40 min | 140 |
| PRACTICE (MCQ) · Human Body — English → Malayalam | MCQ | practice only | 105 | 45 min | 105 |
| PRACTICE (MCQ) · Animals & Birds — English → Malayalam | MCQ | practice only | 105 | 45 min | 105 |

The written parts use the **rotating prompt format**: the prompt language
changes per part and the student **writes** the other two languages — no MCQ,
no Malayalam answers in the written tests (Malayalam stays on the printed
vocabulary sheet as learning support). Marking is automatic per language box
with the normalisation described under *write2* above, so a total of
**420 points** is available across the 3 written parts.

## Question bank (seeded from Samad's own sheets only)

`tools/build-seed-data.py` regenerates `seed-data.json` from the source PDFs
(requires `pdftotext`):
- `~/workspace/user/files/SIBAQ26_BNS30_GK_Quiz_Sheet.pdf` — GK 100
  (General Knowledge / Islamic History / World History / Current Affairs)
- `~/workspace/your_files/islamic-history-200-questions/islamic-history-200-questions.pdf`
  — Islamic History 210 (7 sections)

Short answers are converted to MCQ deterministically: correct answer + 3
distractors sampled from the same section (seeded RNG, reproducible builds).
Answers that are too long (>90 chars) or multi-name lists are skipped and
recorded in `seed-data.json` under `skipped`.

Sample quizzes created on first run:
1. **SIBAQ GK Quiz — Practice Set 1** (Bidaya, BNS30, 20 Qs, practice+exam, 20 min)
2. **Islamic History — Seerah** (Bidaya, 20 Qs, practice+exam)
3. **Islamic History — Rashidun Caliphs** (Ula, 15 Qs, practice)

Teachers can also build any quiz from the bank: Teacher Panel → 📚 Question Bank →
“Create Quiz from Bank” (filter by source/section/category, choose count).

## SIBAQ programmes seeded as metadata

Bidaya: BNS30 GK Quiz, BNS31 Map Study, BNO16 Numerical Aptitude ·
Ula: UNO26 GK Talent, UNO24 Grammar Quiz, UNS37 Geo Giant, UNO20 Math Talent ·
Thanawiyya: TNS32 Multilingual Quiz, TNS35 Quantitative Aptitude ·
Aliyah: ANO15 Biz Quiz, ANO16 Civic Quest, ANO12 Logical Reasoning · plus Custom.

## Deploy

- **Render:** `render.yaml` is included (web service, `npm install` / `npm start`).
  ⚠️ Free Render disks are ephemeral — attach a persistent disk mounted at
  `./data` (or set `DB_PATH` to a persistent volume) or the database
  (students, quizzes, results) will reset on redeploy.
- **Replit:** import the folder/zip, it runs `npm start`; keep the `data/`
  folder backed up before republishing (same lesson as Little Hands).
- **Docker:** `docker build -t quiz-portal . && docker run -p 3000:3000 -v qp-data:/app/data quiz-portal`

## Files

```
server.js            API + auth + auto-marking (MCQ & write2)
seed.js              first-run bank + sample-quiz seeding, plus UNO17
                     vocab-quiz seeding (by title, every start, no duplicates)
vocab-tests/         the 5 UNO17 Vocabulary quiz JSONs (3 written parts +
                     2 MCQ practice sets) seeded automatically
seed-data.json       generated bank (308 questions — see counts in test/report)
tools/build-seed-data.py   regenerates seed-data.json from the source PDFs
public/              index (login/register), dashboard, quiz, results,
                     leaderboard, teacher panel
test.js              end-to-end tests (scratch server, temp DB)
data/                SQLite DB at runtime (git-ignored)
```
