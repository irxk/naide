# NAIDE

**Node AI Development Environment** — A programming language designed for AI-speed code generation that transpiles to Node.js.

NAIDE is built on three principles: one way to write everything (zero ambiguity), keyword-driven intent (the first token decides meaning), and minimal token count (fewer tokens = faster AI generation). It includes built-in declarations for servers, databases, authentication, file uploads, WebSockets, bots (Discord/Slack/Telegram/LINE), CLI apps, HTML pages, email, GraphQL, desktop apps, mobile screens, cron jobs, job queues, testing, and more — all with zero external dependencies.

Two syntax modes:

- **NAIDE** (`.naide`) — Human-readable, ~40% fewer tokens than JavaScript
- **NAIDE-X** (`.nx`) — AI-only readability, ~80% fewer tokens than JavaScript

## Install

```bash
npm install -g naider
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
naide check <files...>        # Type-check without running
naide fmt <files...>          # Format NAIDE files
naide lsp                     # Start Language Server (LSP)
naide vscode                  # Install VS Code extension
naide deploy [dir]            # Generate Dockerfile for deployment
naide convert <files...>      # Convert .nx ↔ .naide (bidirectional)
naide pkg init                # Create naide.pkg.json manifest
naide pkg install <name>      # Install a NAIDE package
naide pkg publish             # Publish package to npm
naide -w <file>               # Watch mode (auto-restart on changes)
naide -d <file>               # Debug mode (Node.js inspector)
naide --emit <file>           # Print generated JavaScript
naide -o <out.js> <file>      # Write JavaScript to file
naide --mid <file.nx>         # Show intermediate NAIDE v1 (debug X mode)
naide --ast <file>            # Print AST
naide --tokens <file>         # Print token stream
```

### REPL

```
$ naide
NAIDE REPL v1.11.0 — type NAIDE code, see JavaScript output
Type .exit to quit, .eval to toggle eval mode

>>> str name = "hello"
const name = "hello";

>>> fn add(int a, int b) -> int:
...   ret a + b
...
function add(a, b) {
  return a + b;
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

### Mock / Spy (Test Utilities)

```python
fn.async main():
  # Create a mock function
  any mock = createMock()
  mock(1, 2)
  mock("hello")
  log mock.callCount()        # 2
  log mock.calledWith(1, 2)   # true

  # Mock with return value
  mock.returns(42)
  log mock()                  # 42

  # Spy on an existing method
  any spy = createSpy(obj, "method")
  obj.method("arg")
  log spy.callCount()         # 1
  spy.restore()               # restores original method
```

`createMock(fn?)` — create a mock function with `.calls`, `.callCount()`, `.calledWith(...)`, `.returns(val)`, `.impl(fn)`, `.reset()`.
`createSpy(obj, method)` — wraps an existing method with a mock. `.restore()` reverts it.

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

## Bots (Discord / Slack / Telegram / LINE)

Built-in `bot` syntax with multi-platform support — events, message handling, and slash commands with zero boilerplate:

```python
# Discord (default)
bot myBot token DISCORD_TOKEN:
  on "ready":
    log "Bot is online!"
  on "message" (msg):
    if msg.content == "!ping":
      msg.reply("Pong!")
  slash "hello" "Says hello":
    interaction.reply("Hello!")

# Slack
bot slackBot type "slack" token SLACK_TOKEN:
  on "message" (msg):
    msg.reply("Hi from Slack!")

# Telegram
bot tgBot type "telegram" token TG_TOKEN:
  on "message" (msg):
    msg.reply("Hi from Telegram!")

# LINE
bot lineBot type "line" token LINE_TOKEN:
  on "message" (event):
    log event
```

Compiles to the right SDK per platform and per target:

| Platform | Node.js / Bun | Python |
|----------|---------------|--------|
| Discord  | discord.js    | discord.py |
| Slack    | @slack/bolt   | slack_bolt |
| Telegram | node-telegram-bot-api | python-telegram-bot |
| LINE     | @line/bot-sdk | linebot |

## Page Generation (HTML)

```python
page "index.html":
  title "My App"
  style "styles.css"
  div "container":
    h1 "Hello World"
    p "Welcome"
    a "https://example.com" "Click here"
  script "app.js"
```

Generates a complete HTML file with proper head/body structure.

## CLI Apps

```python
cli myTool "A useful tool":
  arg "name" str "Your name"
  arg "count" int "How many times"
  flag "v" "verbose" "Verbose output"
  run (args):
    log "Hello {args.name}"
```

Compiles to `process.argv` parser (Node.js/Bun) or `argparse` (Python).

## Email

```python
mail "smtp.gmail.com" 587:
  user env.MAIL_USER
  pass env.MAIL_PASS
# Usage: mail.send("to@email.com", "Subject", "Body")
```

Compiles to `nodemailer` (Node.js/Bun) or `smtplib` (Python).

## GraphQL

Add GraphQL inside any server block — auto-generates schema from `schema` declarations:

```python
server app port 3000:
  schema User:
    id auto
    name str
    email str
  graphql "/graphql"
```

## Desktop Apps

```python
desktop myApp:
  title "My Desktop App"
  size 1024 768
  load "index.html"
```

Compiles to Electron (Node.js/Bun) or pywebview (Python).

## Mobile Screens

```python
screen Home:
  text "Hello World"
  button "Click Me"
  input "Enter your name"
  image "logo.png"
```

Compiles to React Native (Node.js/Bun) or Kivy (Python).

## Scheduled Tasks & Events

```python
every "5m":
  log "cleanup running"

every "*/5 * * * *":
  log "cron every 5 minutes"

watch User.create (event):
  log "new user: {event.data.name}"
```

Intervals: `"30s"`, `"5m"`, `"1h"`, `"1d"`. Cron expressions auto-detected.
`watch` connects to `crud` events automatically.

## OAuth (Social Login)

```python
oauth "google" env.CLIENT_ID env.CLIENT_SECRET:
  callback "/auth/callback"
  scope "email profile"
```

Supports Google, GitHub. Compiles to passport.js (Node.js) or authlib (Python).

## Payment (Stripe)

```python
pay "stripe" env.STRIPE_KEY:
  webhook "/webhook"
```

Usage: `pay.checkout([{name: "Item", price: 1000, qty: 1}])`. Compiles to Stripe SDK.

## Cloud Storage (S3/GCS)

```python
storage "s3" env.BUCKET env.AWS_KEY env.AWS_SECRET:
  region "ap-northeast-1"
```

Usage: `storage.upload("key", data)`, `storage.download("key")`, `storage.remove("key")`. Compiles to AWS SDK (Node.js) or boto3 (Python).

## PDF Generation

```python
pdf "report.pdf":
  title "Monthly Report"
  h1 "Summary"
  text "This is the content."
  image "chart.png"
```

Compiles to pdfkit (Node.js) or FPDF (Python).

## i18n (Internationalization)

```python
i18n "locales/":
  default "en"
  lang "en" "en.json"
  lang "ja" "ja.json"
```

Usage: `i18n.t("greeting.hello")`, `i18n.setLang("ja")`.

## Push Notifications

```python
push env.VAPID_PUBLIC env.VAPID_PRIVATE:
  endpoint "/subscribe"
```

Usage: `push.send(subscription, "Title", "Body")`. Compiles to web-push (Node.js) or pywebpush (Python).

## Full-Text Search

```python
search "meilisearch" "http://localhost:7700" env.MEILI_KEY:
  index "products"
```

Usage: `search.query("keyword")`, `search.add(docs)`. Supports Meilisearch and Elasticsearch.

## Image Processing

```python
image "photo.jpg" -> "output.jpg":
  resize 800 600
  grayscale
  watermark "logo.png"
```

Operations: `resize`, `crop`, `rotate`, `blur`, `grayscale`, `flip`, `watermark`, `format`. Compiles to sharp (Node.js) or Pillow (Python).

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

## AI / LLM Integration

Built-in AI client — zero dependencies, auto-detects provider from API key:

```python
fn.async main():
  # Simple prompt
  str answer = await ai.ask("Explain NAIDE in one sentence")

  # Structured JSON output
  map result = await ai.json("List 3 colors", {colors: ["string"]})

  # Multi-turn chat
  list msgs = [{role: "user", content: "Hi"}, {role: "assistant", content: "Hello!"}, {role: "user", content: "What is 2+2?"}]
  str reply = await ai.chat(msgs)

  # With options
  str answer2 = await ai.ask("hello", {model: "gpt-4o", maxTokens: 100})
```

Set `AI_KEY`, `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY` env var. Provider auto-detected: `sk-ant-*` → Anthropic, otherwise OpenAI-compatible.

### AI Streaming

```python
fn.async main():
  each chunk in await ai.stream("Write a poem"):
    log chunk
```

Returns an async iterator of text chunks — works with SSE for real-time chat UIs.

### Embeddings & Vector Search (RAG)

```python
fn.async main():
  # Generate embeddings
  list vec = await ai.embed("hello world")
  list vecs = await ai.embed(["hello", "world"])

  # Cosine similarity
  num score = ai.similarity(vec1, vec2)
```

Built-in vector store for RAG:

```python
fn.async search(str query):
  list qVec = await ai.embed(query)
  list results = vectors.search(qVec, 5)
  ret results
```

`createVectorStore()` — in-memory vector store with `add(id, embedding, metadata)`, `search(queryEmbedding, topK)`, `remove(id)`, `clear()`.

### Prompt Templates

Reusable prompt declarations with default variables:

```python
prompt summarize {lang: "en"}:
  "Summarize the following text in {lang}:"
  "{text}"

fn.async main():
  str p = summarize({text: "hello world"})
  str answer = await ai.ask(p)
```

Multi-line templates are joined with newlines. Variables use `{name}` syntax.

### AI in Server Routes

```python
server app port 3000:
  post "/api/ask" (req, res):
    str answer = await ai.ask(req.body.prompt)
    ret {answer}
```

## SQL Database

SQLite and PostgreSQL support with the same store API:

```python
db.sql "sqlite" "app.db"

schema User:
  id    auto
  name  str required
  email str required email

server app port 3000:
  crud "/api/users" User
```

Schemas with `db.sql` auto-use SQL storage instead of JSON files. Same API: `getAll`, `getById`, `create`, `update`, `delete`, `where`, `count`, `clear`.

Schema migration is automatic — when you add new fields to a schema, `ALTER TABLE ADD COLUMN` runs at startup. No manual migration needed.

PostgreSQL:

```python
db.sql "postgres" "postgresql://localhost/mydb"
```

## Language Server (LSP)

Built-in LSP for editor integration — diagnostics, completions, and hover docs:

```bash
naide lsp
```

### VS Code

```bash
naide vscode
```

One command installs the extension — syntax highlighting, LSP diagnostics, autocomplete, and hover docs for `.naide` and `.nx` files. Restart VS Code after install.

## Deploy

Generate deployment files with one command:

```bash
naide deploy
```

Creates `Dockerfile` and `.dockerignore`. Then:

```bash
docker build -t naide-app .
docker run -p 3000:3000 naide-app
```

## Multi-File Projects

Import between NAIDE files — extensions are auto-rewritten to `.mjs` in output:

```python
# routes.naide
pub fn.async handleUser(req, res):
  ret {user: req.params.id}
```

```python
# app.naide
use {handleUser} from "./routes.naide"

server app port 3000:
  get "/user/:id" [handleUser] (req, res):
    ret {ok: true}
```

Build all files with `naide build`, which compiles every `.naide`/`.nx` file to `.mjs`.

## Full Example

```python
db.sql "sqlite" "app.db"

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

  post "/api/ask" (req, res):
    str answer = await ai.ask(req.body.prompt)
    ret {answer}

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

This generates a complete production API — SQLite database, AI/LLM integration, auth, password hashing, CORS, sessions, rate limiting, CRUD with pagination/search, WebSocket, SSE, file caching, request validation, background jobs, auto-generated API docs, route middleware, file downloads, redirects with status codes, type checking, error handling with ensure/finally, and event-driven hooks — from ~75 lines.

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

High-level keywords work in both modes: `schema`, `crud`, `auth`, `cors`, `limit`, `env`, `every`, `watch`, `static`, `ws`, `db`, `db.sql`, `group`, `cookie`, `error`, `session`, `upload`, `view`, `sse`, `cache`, `patch`, `validate`, `test`, `assert`, `queue`, `openapi`, `typeof`, `instanceof`, `ensure`, `ai`, `prompt`, `bot`, `slash`.

NAIDE-X log shorthands: `log.e` = error, `log.w` = warn, `log.i` = info, `log.d` = debug.

## Plugin System

Register and use plugins for extensibility:

```python
registerPlugin("logger", (opts) =>
  ret {log: (msg) => log "[{opts.prefix}] {msg}"}
)

any logger = usePlugin("logger", {prefix: "APP"})
logger.log("started")

list names = listPlugins()
```

`registerPlugin(name, setup)` — registers a plugin factory. `usePlugin(name, opts?)` — initializes on first call, returns cached exports. `listPlugins()` — returns registered plugin names.

## Convert (NX ↔ NAIDE)

Bidirectional conversion between `.nx` and `.naide`:

```bash
naide convert file.nx         # → file.naide (expand to readable syntax)
naide convert file.naide      # → file.nx (compress to NX syntax)
```

## Source Maps & Error Remapping

Runtime errors are automatically remapped to source file line numbers:

```
Error in app.naide:12
  10 |   user = UserStore.getById(id)
  11 |   if not user:
>>12 |     throw "not found"
```

The CLI tracks source-to-output line mappings and shows context from your `.naide`/`.nx` file, not the generated JavaScript.

## Native Dependency Detection

When you run a `.naide` file, the CLI scans generated JavaScript for missing dependencies (`express`, `better-sqlite3`, `pg`, `ws`) and prints install hints:

```
[NAIDE] Missing: express — run: npm install express
```

## Type Checker

Compile-time type checking without running the code:

```bash
naide check app.naide
```

Catches type mismatches at compile time:

```
  app.naide:3 ERROR: Type mismatch: cannot assign str to int
  app.naide:7 WARN: Type warning: reassigning int variable 'count' with str
```

The type checker understands NAIDE's type annotations (`str`, `int`, `num`, `bool`, `list`, `map`), infers types from expressions and function return values, and checks assignments for compatibility. `num` accepts `int` values. `any` and `json` accept all types.

Also available as a flag: `naide --check app.naide` or programmatically via `compile(source, { typeCheck: true })`.

## Async Error Handling

Async route handlers are automatically wrapped with try/catch to prevent unhandled rejections:

```python
server app port 3000:
  post "/api/data" (req, res):
    any data = await fetchData()    # if this throws...
    ret data                        # ...a 500 JSON error is returned automatically
```

Generated code includes `try { ... } catch (__err) { res.status(500).json({ error: __err.message }) }` around async handlers. Routes with explicit `try/fail` blocks are left as-is.

A global `process.on('unhandledRejection')` handler is also added to server code to catch any remaining async errors.

## Debugger

Debug NAIDE programs with the Node.js inspector:

```bash
naide -d app.naide              # starts with --inspect-brk
```

Then open `chrome://inspect` in Chrome to connect. The program pauses at the first line so you can set breakpoints before execution.

## Package Ecosystem

Manage NAIDE packages via npm:

```bash
naide pkg init                  # create naide.pkg.json manifest
naide pkg install my-plugin     # install from npm + add to manifest
naide pkg publish               # publish to npm with naide-plugin keyword
naide pkg list                  # list installed NAIDE packages
```

The `naide.pkg.json` manifest tracks NAIDE-specific metadata (main entry, exports, dependencies) while using npm as the underlying registry.

## Why NAIDE?

AI code generation speed depends on:

1. **Token count** — fewer output tokens = faster generation
2. **Predictability** — one way to write everything = better next-token prediction
3. **Context window** — shorter code = more room for complex projects

NAIDE-X is designed as an **AI-internal representation** — the AI thinks in NAIDE-X, users receive standard JavaScript.

## License

MIT
