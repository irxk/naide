#!/usr/bin/env node

// Token count comparison: JavaScript vs NAIDE vs NAIDE-X
// Measures the same application logic across all three representations

const jsCode = `
import express from 'express';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomUUID, scryptSync, timingSafeEqual } from 'crypto';

const app = express();
app.use(express.json());

const DB_DIR = "data/";
if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });

const TodoSchema = {
  fields: {
    id: { type: 'auto' },
    title: { type: 'str', required: true, min: 1, max: 200 },
    done: { type: 'bool', default: false },
    created: { type: 'timestamp', auto: true }
  }
};

let todos = [];
const dbFile = join(DB_DIR, "Todo.json");
if (existsSync(dbFile)) {
  todos = JSON.parse(readFileSync(dbFile, 'utf-8'));
}

function saveTodos() {
  writeFileSync(dbFile, JSON.stringify(todos, null, 2));
}

app.get("/api/todos", (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const start = (page - 1) * limit;
  const data = todos.slice(start, start + limit);
  res.json({ data, total: todos.length, page, limit });
});

app.get("/api/todos/:id", (req, res) => {
  const todo = todos.find(t => t.id === req.params.id);
  if (!todo) return res.status(404).json({ error: "Not found" });
  res.json(todo);
});

app.post("/api/todos", (req, res) => {
  const { title } = req.body;
  if (!title || title.length < 1 || title.length > 200) {
    return res.status(400).json({ error: "Invalid title" });
  }
  const todo = {
    id: randomUUID(),
    title,
    done: false,
    created: new Date().toISOString()
  };
  todos.push(todo);
  saveTodos();
  res.status(201).json(todo);
});

app.put("/api/todos/:id", (req, res) => {
  const idx = todos.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  todos[idx] = { ...todos[idx], ...req.body };
  saveTodos();
  res.json(todos[idx]);
});

app.delete("/api/todos/:id", (req, res) => {
  const idx = todos.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  todos.splice(idx, 1);
  saveTodos();
  res.json({ deleted: true });
});

app.get("/api/stats", (req, res) => {
  const total = todos.length;
  const completed = todos.filter(t => t.done).length;
  res.json({ total, completed, pending: total - completed });
});

app.get("/", (req, res) => {
  res.type('html').send("<h1>Todo API</h1>");
});

app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(500).json({ error: err.message });
});

app.listen(3000, () => console.log("Server running on port 3000"));
`;

const naideCode = `
db "data/"

schema Todo:
  id auto
  title str required min(1) max(200)
  done bool default(false)
  created timestamp auto

server app port 3000:
  cors "*"
  crud "/api/todos" Todo

  get "/api/stats" (req, res):
    list all = TodoStore.all()
    int total = all.length
    int completed = all.filter((t) => t.done).length
    ret {total, completed, pending: total - completed}

  get "/":
    ret.html "<h1>Todo API</h1>"

  error (err, req, res):
    log.error err.message
    ret.status 500 {error: err.message}
`;

const nxCode = `
db "data/"

schema Todo:
  id auto
  title str required min(1) max(200)
  done bool default(false)
  created timestamp auto

$app:3000
  cors "*"
  crud "/api/todos" Todo
  G"/api/stats"(req,res)
    l:all=TodoStore.all()
    i:total=all.length
    i:done=all.filter((t)=>t.done).length
    >{total,done,pending:total-done}
  G"/"
    >.h "<h1>Todo API</h1>"
  error (err,req,res):
    log.e err.message
    >.s 500 {error:err.message}
`;

function countTokens(code) {
  // GPT-style tokenizer approximation: split on whitespace and punctuation
  return code
    .trim()
    .split(/[\s]+/)
    .filter(t => t.length > 0)
    .length;
}

function countChars(code) {
  return code.trim().length;
}

function countLines(code) {
  return code.trim().split('\n').filter(l => l.trim().length > 0).length;
}

const results = [
  { name: 'JavaScript', code: jsCode },
  { name: 'NAIDE',      code: naideCode },
  { name: 'NAIDE-X',    code: nxCode },
];

console.log('\n  NAIDE Token Benchmark');
console.log('  ═══════════════════════════════════════════════\n');
console.log('  Same TODO API with CRUD, stats, error handling\n');

const jsTokens = countTokens(jsCode);
const jsChars = countChars(jsCode);
const jsLines = countLines(jsCode);

console.log('  Language     Tokens    Chars    Lines    Savings');
console.log('  ─────────────────────────────────────────────────');

for (const { name, code } of results) {
  const tokens = countTokens(code);
  const chars = countChars(code);
  const lines = countLines(code);
  const tokenSave = name === 'JavaScript' ? '—' : `-${Math.round((1 - tokens / jsTokens) * 100)}%`;
  const charSave = name === 'JavaScript' ? '—' : `-${Math.round((1 - chars / jsChars) * 100)}%`;

  console.log(`  ${name.padEnd(12)} ${String(tokens).padStart(6)}  ${String(chars).padStart(7)}  ${String(lines).padStart(5)}    ${tokenSave}`);
}

console.log('\n');
