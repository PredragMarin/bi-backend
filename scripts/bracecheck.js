// scripts/bracecheck.js
const fs = require("fs");

const file = process.argv[2] || "src/core/epr/compute.js";
const s = fs.readFileSync(file, "utf8");

let line = 1, col = 0;
let st = { sq: 0, dq: 0, tq: 0, lc: 0, bc: 0, esc: 0 };

const stackC = []; // {
const stackP = []; // (

function push(stack, ch) { stack.push({ line, col, ch }); }
function pop(stack, ch) {
  if (stack.length === 0) {
    console.log(`EXTRA ${ch} at ${line}:${col}`);
    return;
  }
  stack.pop();
}

for (let i = 0; i < s.length; i++) {
  const ch = s[i];
  col++;

  if (ch === "\n") { line++; col = 0; st.lc = 0; continue; }

  if (st.lc) continue;

  if (st.bc) {
    if (ch === "*" && s[i + 1] === "/") { st.bc = 0; i++; col++; }
    continue;
  }

  if (st.tq) {
    if (st.esc) { st.esc = 0; continue; }
    if (ch === "\\") { st.esc = 1; continue; }
    if (ch === "`") { st.tq = 0; continue; }
    continue;
  }

  if (st.sq) {
    if (st.esc) { st.esc = 0; continue; }
    if (ch === "\\") { st.esc = 1; continue; }
    if (ch === "'") { st.sq = 0; continue; }
    continue;
  }

  if (st.dq) {
    if (st.esc) { st.esc = 0; continue; }
    if (ch === "\\") { st.esc = 1; continue; }
    if (ch === '"') { st.dq = 0; continue; }
    continue;
  }

  // start comments
  if (ch === "/" && s[i + 1] === "/") { st.lc = 1; i++; col++; continue; }
  if (ch === "/" && s[i + 1] === "*") { st.bc = 1; i++; col++; continue; }

  // start strings
  if (ch === "`") { st.tq = 1; continue; }
  if (ch === "'") { st.sq = 1; continue; }
  if (ch === '"') { st.dq = 1; continue; }

  // braces/parens
  if (ch === "{") push(stackC, "{");
  else if (ch === "}") pop(stackC, "}");
  else if (ch === "(") push(stackP, "(");
  else if (ch === ")") pop(stackP, ")");
}

console.log("UNCLOSED { count =", stackC.length, "last =", stackC.slice(-10));
console.log("UNCLOSED ( count =", stackP.length, "last =", stackP.slice(-10));
console.log("END STATE:", st);
console.log("bracecheck end");
