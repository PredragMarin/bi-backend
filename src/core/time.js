// src/core/time.js
function pad2(n) {
  return String(n).padStart(2, "0");
}

function parseDateDMY(s) {
  // "DD/MM/YYYY"
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const dd = Number(m[1]), mm = Number(m[2]), yy = Number(m[3]);
  const d = new Date(yy, mm - 1, dd);
  if (d.getFullYear() !== yy || (d.getMonth() + 1) !== mm || d.getDate() !== dd) return null;
  return d;
}

function parseDateTimeDMYHM(s) {
  // "DD/MM/YYYY HH:mm" (sekunde opcionalno)
  const m = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s.trim());
  if (!m) return null;
  const dd = Number(m[1]), mm = Number(m[2]), yy = Number(m[3]);
  const hh = Number(m[4]), mi = Number(m[5]), ss = m[6] ? Number(m[6]) : 0;
  const d = new Date(yy, mm - 1, dd, hh, mi, ss, 0);
  // minimalna konzistentnost
  if (d.getFullYear() !== yy || (d.getMonth() + 1) !== mm || d.getDate() !== dd) return null;
  return d;
}

function toISODate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function toDMYHM(d) {
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function nowIsoWithOffset() {
  // lokalni ISO s offsetom OS-a; u praksi dovoljno za store. (Ako želite striktno tz=Europe/Zagreb
  // kroz ICU tz conversion, dodamo kasnije.)
  const d = new Date();
  const tzOffsetMin = -d.getTimezoneOffset();
  const sign = tzOffsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(tzOffsetMin);
  const hh = pad2(Math.floor(abs / 60));
  const mm = pad2(abs % 60);
  const iso = d.toISOString().replace("Z", "");
  return `${iso}${sign}${hh}:${mm}`;
}

module.exports = {
  parseDateDMY,
  parseDateTimeDMYHM,
  toISODate,
  toDMYHM,
  nowIsoWithOffset
};
