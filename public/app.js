// Shared helpers — SIBAQ Quiz Portal
function token() { return localStorage.getItem("qp_token"); }
function role() { return localStorage.getItem("qp_role"); }
async function api(method, url, body) {
  const r = await fetch(url, {
    method, headers: { "Content-Type": "application/json", ...(token() ? { Authorization: "Bearer " + token() } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || ("Error " + r.status));
  return d;
}
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function toast(msg, ok = true) {
  let t = document.querySelector(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.appendChild(t); }
  t.textContent = msg; t.className = "toast show" + (ok ? "" : " err");
  setTimeout(() => t.classList.remove("show"), 2800);
}
function header(active) {
  const isT = role() === "teacher";
  const links = isT
    ? [["teacher.html", "Teacher Panel"]]
    : [["dashboard.html", "Quizzes"], ["results.html", "My Results"], ["leaderboard.html", "Leaderboard"]];
  return `<header class="top"><div class="top-in">
    <div class="brand-logo">🎓</div>
    <div class="brand">SIBAQ '26 Quiz Portal<small>Noorul Huda Centre for Excellence</small>
    <div class="inst">Noorul Huda Islamic Academy</div></div>
    <div class="top-actions"><button class="btn ghost small" onclick="logout()">Logout</button></div></div>
    <nav class="main">${links.map(([h, l]) => `<a href="${h}" class="${active === h ? "on" : ""}">${l}</a>`).join("")}</nav></header>`;
}
function footer() { return `<div class="footer"><div class="finst">NOORUL HUDA CENTRE FOR EXCELLENCE</div>SIBAQ '26 Quiz Portal · Noorul Huda Islamic Academy</div>`; }
async function guard(want) {
  if (!token()) { location.href = "index.html"; return null; }
  try {
    const me = await api("GET", "/api/me");
    if (want && me.role !== want) { location.href = me.role === "teacher" ? "teacher.html" : "dashboard.html"; return null; }
    return me;
  } catch { localStorage.removeItem("qp_token"); localStorage.removeItem("qp_role"); location.href = "index.html"; return null; }
}
async function logout() { try { await api("POST", "/api/auth/logout", {}); } catch {} localStorage.removeItem("qp_token"); localStorage.removeItem("qp_role"); location.href = "index.html"; }
