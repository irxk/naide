# NAIDE

**Node AI Development Environment** — A programming language designed for AI-speed code generation that transpiles to Node.js.

NAIDE is built on three principles: one way to write everything (zero ambiguity), keyword-driven intent (the first token decides meaning), and minimal token count (fewer tokens = faster AI generation). It includes built-in declarations for servers, databases, authentication, file uploads, WebSockets, job queues, testing, and more — all with zero external dependencies.

Two syntax modes:

- **NAIDE** (`.naide`) — Human-readable, ~40% fewer tokens than JavaScript
- **NAIDE-X** (`.nx`) — AI-only readability, ~80% fewer tokens than JavaScript

## Install

```bash
npm install -g naidejs
```

## Quick Start

```bash
# Create a new project
naide init my-app
cd my-app
npm install
npm run dev
```

Or write a file directly:

```python
# app.naide
server app port 3000:
  get "/":
    ret {message: "Hello from NAIDE"}
```

```bash
naide app.naide
```

## CLI

```bash
naide <file>                  # Run a .naide or .nx file
naide                         # Start interactive REPL
naide repl                    # Start interactive REPL
naide init [dir]              # Scaffold a new project
naide build [dir] [outdir]    # Transpile all files to JavaScript
naide fmt <files...>          # Format NAIDE files
naide -w <file>               # Watch mode (auto-restart on changes)
naide --emit <file>           # Print generated JavaScript
naide -o <out.js> <file>      # Write JavaScript to file
naide --mid <file.nx>         # Show intermediate NAIDE v1 (debug X mode)
naide --ast <file>            # Print AST
naide --tokens <file>         # Print token stream
```

### REPL

```
$ naide
NAIDE REPL v1.5.0 — type NAIDE code, see JavaScript output
Type .exit to quit, .eval to toggle eval mode

>>> str name = "hello"
const name = "hello";

>>> fn add(int a, int b) -> int:
...   ret a + b
...
function add(a, b) {
  return (a + b);
}
```

Type `.eval` to switch to evaluation mode (runs the code instead of showing JS).

### Playground

Open `playground/index.html` in a browser (via a local server) for a live in-browser transpiler with examples and token count comparison.

### Benchmark

```bash
node benchmark/compare.js
```

```
  Language     Tokens    Chars    Lines    Savings
  JavaScript      330     2590     78    —
  NAIDE            66      517     19    -80%
  NAIDE-X          39      435     19    -88%
```

## Language Reference

### Variables

```python
str name = "hello"          # immutable (const)
int count = 42
num price = 9.99
bool active = true
list items = [1, 2, 3]
map config = {host: "localhost"}
any data = null

mut int counter = 0          # mutable (let)
mut str label = "init"
```

Types: `str`, `int`, `num`, `bool`, `list`, `map`, `any`, `json`, `void`

### String Interpolation

```python
str greeting = "Hello {name}, you have {count} items"
```

Double-quoted strings with `{expr}` are auto-interpolated.

### Functions

```python
fn add(int a, int b) -> int:
  ret a + b

fn greet(str name, str prefix = "Hello"):
  log "{prefix}, {name}!"

fn sum(...int nums) -> int:
  mut int total = 0
  each n in nums:
    total += n
  ret total

fn.async fetchUser(str id) -> map:
  any res = await fetch("/api/users/{id}")
  ret await res.json()
```

### Control Flow

```python
if count > 10:
  log "many"
elif count > 5:
  log "some"
else:
  log "few"

str size = if count > 10 then "big" else "small"
```

### Loops

```python
each item in items:
  log item

each key, val in config:
  log "{key}: {val}"

for i in 0..10:
  log i

while active:
  log "running"
  active = false
```

### Pattern Matching

```python
match status:
  "ok": log "success"
  "error": log "failed"
  _: log "unknown"
```

### Error Handling

```python
try:
  data = await fetchData(url)
fail e:
  log.error e.message
ensure:
  log "request completed"
```

`ensure:` is NAIDE's `finally` — the block always runs, whether the `try` succeeds or fails. `fail` is optional:

```python
try:
  conn = await openConnection()
  ret await conn.query("SELECT 1")
ensure:
  conn.close()
```

### Type Checking

```python
if typeof data == "string":
  log "is string"

if err instanceof TypeError:
  log "type error"
```

`typeof` returns the type as a string. `instanceof` checks if a value is an instance of a class/constructor.

### Classes

```python
model User:
  str name
  str email
  int age = 0

  fn greet() -> str:
    ret "Hi, I'm {self.name}"

model Admin extends User:
  str role = "admin"
  fn permissions() -> list:
    ret ["read", "write", "delete"]
```

### Pipe Operator

```python
list result = data
  |> filter((x) => x.active)
  |> map((x) => x.name)
  |> sort()
```

### Imports / Exports

```python
use express
use {readFile, writeFile} from "fs/promises"
use axios from "axios"

pub fn helper() -> str:
  ret "exported"
pub str VERSION = "1.0.0"
```

## Server & API Features

All features below are zero-dependency — the runtime is bundled with the package.

### server — Express App

```python
server app port 3000:
  get "/":
    ret {message: "hello"}
  post "/api/data" (req, res):
    ret req.body
  put "/api/data/:id" (req, res):
    ret {updated: true}
  del "/api/data/:id":
    ret {deleted: true}
  patch "/api/data/:id" (req, res):
    ret {patched: true}
```

### schema — Data Models

```python
schema User:
  id       auto
  name     str required min(2) max(50)
  email    str required email unique
  age      int optional min(0) max(150)
  role     enum("admin", "user") default("user")
  joined   timestamp auto
```

Types: `str`, `int`, `num`, `bool`, `auto` (UUID), `timestamp`, `enum(...)`
Modifiers: `required`, `optional`, `min(n)`, `max(n)`, `email`, `url`, `unique`, `auto`, `default(val)`

### db — Persistent Storage

```python
db "data/"
```

Schemas auto-persist to JSON files (`data/User.json`, etc.). Without `db`, data is in-memory only.

### crud — Auto-generated REST Endpoints

```python
server app port 3000:
  crud "/api/users" User
```

Generates GET (list + by-ID), POST, PUT, DELETE with validation. Built-in pagination, search, and sort:

```
GET /api/users?page=2&limit=10&q=john&sort=name&order=asc
```

Response: `{ data: [...], total, page, limit, pages }`

### validate — Request Validation

```python
server app port 3000:
  validate "/api/users" User
  post "/api/users" (req, res):
    user = UserStore.create(req.body)   # body is pre-validated
    ret user
```

Auto-validates POST/PUT/PATCH bodies against the schema. Returns `400` with error details if invalid. Validated data replaces `req.body`.

### auth — JWT Authentication

```python
server app port 3000:
  auth JWT_SECRET:
    protect "/api/*"
    public "/api/auth/*"

  post "/api/auth/login" (req, res):
    token = auth.sign({id: user.id})
    ret {token}
```

### cors / limit / cookie / session

```python
server app port 3000:
  cors "*"                    # CORS middleware
  limit "/api/*" 100 "1m"    # rate limiting (100 req/min)
  cookie                     # cookie parser → req.cookies
  session "my-secret"        # cookie sessions → req.session
```

### upload — File Uploads

```python
server app port 3000:
  upload "/api/upload" "avatar" (req, res):
    ret {filename: req.file.filename, size: req.file.size}
```

Zero-dependency multipart parser. `req.file` = `{filename, contentType, data, size}`.

### view — Template Rendering

```python
server app port 3000:
  view "./views"
  get "/":
    ret.render "home" {title: "Welcome", items: ["a", "b"]}
```

Reads `.html` files with `{{variable}}`, `{{if key}}...{{/if}}`, `{{each item in list}}...{{/each}}`.

### sse — Server-Sent Events

```python
server app port 3000:
  sse "/events"
  post "/api/notify" (req, res):
    sse.broadcast req.body
    ret {ok: true}
```

`sse.send(data)`, `sse.broadcast(data)`, `sse.count`.

### cache — Response Caching

```python
server app port 3000:
  cache "/api/*" "5m"
```

Caches GET responses in memory with TTL. Sets `X-Cache: HIT/MISS`.

### ws — WebSocket

```python
server app port 3000:
  ws "/chat":
    on "connect":
      send({type: "welcome"})
    on "message" (data):
      broadcast(data)
    on "close":
      log "client left"
```

Built-in `send(data)` and `broadcast(data)`. Requires `npm install ws`.

### group — Route Groups

```python
server app port 3000:
  group "/api/v1":
    get "/users":
      ret users
    post "/users" (req, res):
      ret req.body
```

### mid — Named Middleware

```python
fn logger(req, res, next):
  log req.method, req.url
  next()

server app port 3000:
  mid logger               # apply globally
  mid logger "/api"        # apply to path only
```

### Route-Level Middleware

Apply middleware to specific routes with bracket syntax:

```python
server app port 3000:
  get "/admin" [authCheck] (req, res):
    ret {admin: true}

  post "/api/data" [auth, logger, validator] (req, res):
    ret req.body
```

Compiles to `app.get("/admin", authCheck, (req, res) => { ... })`.

### static — Serve Files

```python
server app port 3000:
  static "/public"
```

### error — Error Handler

```python
server app port 3000:
  error (err, req, res):
    log.error err.message
    ret.status 500 {error: "Internal error"}
```

### openapi — Auto-Generated API Docs

```python
server app port 3000:
  openapi "/docs"
```

Generates an OpenAPI 3.1 JSON spec from your schemas, served at the specified path.

### Response Helpers

```python
ret {data: items}                        # JSON (default)
ret.status 404 {error: "nope"}          # status code
ret.redirect "/login"                    # redirect
ret.redirect 301 "/new-url"             # redirect with status
ret.html "<h1>Hello</h1>"               # HTML
ret.text "pong"                          # plain text
ret.file "/path/to/file"                # send file
ret.download "/path/to/file.zip"        # file download
ret.download "/file.zip" "custom.zip"   # download with filename
ret.render "template" {data}            # render template (requires view)
```

## Testing

Built-in test syntax using Node.js test runner:

```python
test "user creation":
  user = UserStore.create({name: "Alice", email: "alice@test.com"})
  assert user.name == "Alice"
  assert user.email == "alice@test.com"

test "math":
  assert 1 + 1 == 2
  assert 10 > 5
```

`assert a == b` generates `assert.strictEqual` for better error messages. Run with `node --test`.

## Job Queue

In-memory async job queue for background processing:

```python
queue jobs:
  job "sendEmail" (data):
    log "sending to {data.to}"
  job "resize" (data):
    log "resizing {data.path}"

server app port 3000:
  post "/api/notify" (req, res):
    jobs.add("sendEmail", {to: req.body.email})
    ret {queued: true}
```

## Scheduled Tasks & Events

```python
every "5m":
  log "cleanup running"

watch User.create (event):
  log "new user: {event.data.name}"
```

Intervals: `"30s"`, `"5m"`, `"1h"`, `"1d"`.
`watch` connects to `crud` events automatically.

## Environment Variables

```python
env:
  PORT       int default(3000)
  JWT_SECRET str required
  DB_URL     str default("data/")
```

Variables become constants. Missing `required` vars exit with an error.

## Built-in Functions

```python
str id = uuid()                          # UUID
str hashed = hash("password")            # scrypt hash
bool ok = verify("password", hashed)     # timing-safe verify
str token = sign({id: 1})                # JWT (uses auth secret)
str token = sign({id: 1}, "my-secret")   # JWT (explicit secret)
```

Auto-imported from the runtime when used.

## HTTP Client

```python
fn.async getUsers() -> any:
  any users = await api.get("https://api.example.com/users")
  ret users

fn.async createUser(map data) -> any:
  any result = await api.post("https://api.example.com/users", data)
  ret result
```

Methods: `api.get(url)`, `api.post(url, body)`, `api.put(url, body)`, `api.del(url)`, `api.raw(url, opts)`.

## Full Example

```python
db "data/"

env:
  PORT int default(3000)
  JWT_SECRET str required

schema User:
  id auto
  name str required min(2) max(50)
  email str required email
  password str required

queue jobs:
  job "welcome" (data):
    log "Welcome email to {data.email}"

server app port PORT:
  cors "*"
  cookie
  session JWT_SECRET
  auth JWT_SECRET:
    protect "/api/*"
    public "/api/auth/*"
  limit "/api/*" 100 "1m"
  static "/public"
  cache "/api/users" "1m"
  validate "/api/users" User
  crud "/api/users" User
  openapi "/docs"

  post "/api/auth/register" (req, res):
    try:
      str hashed = hash(req.body.password)
      user = UserStore.create({...req.body, password: hashed})
      token = auth.sign({id: user.id})
      jobs.add("welcome", {email: user.email})
      ret {token, user}
    fail e:
      ret.status 500 {error: e.message}
    ensure:
      log.info "register attempt handled"

  post "/api/auth/login" (req, res):
    user = UserStore.where({email: req.body.email})[0]
    if not user:
      ret.status 401 {error: "Invalid credentials"}
    if not verify(req.body.password, user.password):
      ret.status 401 {error: "Invalid credentials"}
    token = auth.sign({id: user.id})
    ret {token}

  get "/admin" [authCheck] (req, res):
    if typeof req.user == "undefined":
      ret.status 401 {error: "not authenticated"}
    ret {admin: true}

  get "/old-page":
    ret.redirect 301 "/new-page"

  get "/download":
    ret.download "/files/report.pdf" "report.pdf"

  ws "/chat":
    on "message" (data):
      broadcast(data)

  sse "/events"

  get "/":
    ret.html "<h1>Welcome</h1>"

  error (err, req, res):
    log.error err.message
    ret.status 500 {error: "Something went wrong"}

watch User.create (event):
  log "new user: {event.data.name}"

every "30m":
  log "cleanup"
```

This generates a complete production API — auth, password hashing, CORS, sessions, rate limiting, CRUD with pagination/search, WebSocket, SSE, file caching, request validation, background jobs, auto-generated API docs, route middleware, file downloads, redirects with status codes, type checking, error handling with ensure/finally, and event-driven hooks — from ~70 lines.

## NAIDE-X Syntax (.nx)

Every keyword is a single character. Line-start symbol = intent.

```
s:name="World"              -- str name = "World"
i:count=42                  -- int count = 42
~i:counter=0                -- mut int counter = 0

f greet(s:who)s             -- fn greet(str who) -> str:
  >"Hello, {who}!"          --   ret "Hello, {who}!"

~f fetchData(s:url)a        -- fn.async fetchData(str url) -> any:
  >~fetch(url)              --   ret await fetch(url)

?count>5                    -- if count > 5:
  log"many"                 --   log "many"
|count>2                    -- elif count > 2:
  log"some"                 --   log "some"
:                           -- else:
  log"few"                  --   log "few"

@item<items                 -- each item in items:
@i<0..10                    -- for i in 0..10:
*active                     -- while active:

$app:3000                   -- server app port 3000:
  G"/users"                 --   get "/users":
    >users                  --     ret users
  P"/users"(req,res)        --   post "/users" (req, res):
    >req.body               --     ret req.body
```

### NAIDE-X Cheat Sheet

| Symbol | Meaning | Symbol | Meaning |
|--------|---------|--------|---------|
| `>` | return | `?` | if |
| `\|` | elif | `:` | else |
| `@` | loop | `*` | while |
| `!` | try | `!!` | catch |
| `!!!` | ensure/finally | `>.d` | ret.download |
| `$` | server | `^` | model |
| `<` | import | `%` | match |
| `f` | function | `~f` | async function |
| `+` | export | `~` | await |
| `G` | GET | `P` | POST |
| `U` | PUT | `D` | DELETE |
| `X` | PATCH | `>.s` | ret.status |
| `>.r` | ret.redirect | `>.h` | ret.html |
| `>.t` | ret.text | `>.v` | ret.render |

Types: `s`=str `i`=int `n`=num `b`=bool `l`=list `m`=map `a`=any

High-level keywords work in both modes: `schema`, `crud`, `auth`, `cors`, `limit`, `env`, `every`, `watch`, `static`, `ws`, `db`, `group`, `cookie`, `error`, `session`, `upload`, `view`, `sse`, `cache`, `patch`, `validate`, `test`, `assert`, `queue`, `openapi`, `typeof`, `instanceof`, `ensure`.

NAIDE-X log shorthands: `log.e` = error, `log.w` = warn, `log.i` = info, `log.d` = debug.

## Why NAIDE?

AI code generation speed depends on:

1. **Token count** — fewer output tokens = faster generation
2. **Predictability** — one way to write everything = better next-token prediction
3. **Context window** — shorter code = more room for complex projects

NAIDE-X is designed as an **AI-internal representation** — the AI thinks in NAIDE-X, users receive standard JavaScript.

## License

MIT
