# NAIDE

**Node AI Development Environment** — A language designed for AI-speed code generation that transpiles to Node.js.

Two modes:
- **NAIDE** (`.naide`) — ~40% fewer tokens than JavaScript
- **NAIDE-X** (`.nx`) — ~80% fewer tokens than JavaScript, AI-only readability

## Install

```bash
npm install -g naidejs
```

## Usage

```bash
# Create a new project
naide init
naide init my-app

# Run a file
naide app.naide
naide app.nx

# Watch mode (auto-restart on changes)
naide -w app.naide

# Output generated JavaScript
naide --emit app.nx

# Write JS to file
naide -o app.js app.nx

# Show intermediate NAIDE v1 (X mode debug)
naide --mid app.nx
```

## High-Level Features

NAIDE includes built-in declarations for common backend patterns. Zero dependencies — the runtime is bundled with the package.

### schema — Data models with validation

```python
schema User:
  id     auto
  name   str required min(2) max(50)
  email  str required email unique
  age    int optional min(0) max(150)
  role   enum("admin", "user") default("user")
  joined timestamp auto
```

Types: `str`, `int`, `num`, `bool`, `auto` (UUID), `timestamp`, `enum(...)`
Modifiers: `required`, `optional`, `min(n)`, `max(n)`, `email`, `url`, `unique`, `auto`, `default(val)`

### db — Persistent file storage

```python
db "data/"
```

When declared, all schema stores persist to JSON files automatically (`data/User.json`, `data/Todo.json`, etc.). Without `db`, data is in-memory only.

### crud — Auto-generate REST endpoints

```python
server app port 3000:
  crud "/api/users" User
```

Generates GET (list + by ID), POST, PUT, DELETE routes with validation.

**Built-in pagination, search, and sort:**
```
GET /api/users                     # paginated (default 20 per page)
GET /api/users?page=2&limit=10     # page 2, 10 items
GET /api/users?q=john              # search all string fields
GET /api/users?sort=name&order=asc # sort by field
```

Response format: `{ data: [...], total, page, limit, pages }`

### auth — JWT authentication

```python
server app port 3000:
  auth JWT_SECRET:
    protect "/api/*"
    public "/api/auth/*"
```

Built-in JWT sign/verify with no external dependencies.

**Signing tokens in routes:**
```python
post "/api/auth/login" (req, res):
  token = auth.sign({id: user.id})    # uses auth secret automatically
  ret {token}
```

Also available as `sign(payload)` (same auto-secret) or `sign(payload, secret)` (explicit).

### Password hashing

```python
str hashed = hash("mypassword")       # scrypt-based, returns salt:hash
bool ok = verify("mypassword", hashed) # timing-safe comparison
```

Zero-dependency — uses Node.js built-in `crypto.scryptSync`.

### cors — CORS middleware

```python
server app port 3000:
  cors "*"
  # or: cors ["localhost:3000", "myapp.com"]
```

### limit — Rate limiting

```python
server app port 3000:
  limit "/api/*" 100 "1m"
```

### static — Serve static files

```python
server app port 3000:
  static "/public"
```

Serves files from the `public/` directory.

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

Built-in `send(data)` and `broadcast(data)` helpers. Requires `npm install ws`.

### group — Route groups

```python
server app port 3000:
  group "/api/v1":
    get "/users":
      ret users
    post "/users" (req, res):
      ret req.body
```

Generates an Express Router mounted at the prefix. Groups can be nested.

### cookie — Cookie parsing

```python
server app port 3000:
  cookie
  get "/" (req, res):
    str theme = req.cookies.theme
    ret {theme}
```

Parses `Cookie` headers into `req.cookies`. Zero-dependency.

### error — Error handler

```python
server app port 3000:
  get "/":
    ret {ok: true}
  error (err, req, res):
    log.error err.message
    ret.status 500 {error: "Internal error"}
```

Express error middleware. Catches unhandled errors in routes.

### patch — HTTP PATCH method

```python
server app port 3000:
  patch "/api/users/:id" (req, res):
    user = UserStore.update(req.params.id, req.body)
    ret user
```

### session — Session management

```python
server app port 3000:
  session "my-secret"
  get "/" (req, res):
    req.session.views = (req.session.views ?? 0) + 1
    ret {views: req.session.views}
```

Cookie-based sessions with `req.session` object. Zero-dependency. Sessions support `req.session.destroy()`.

### upload — File upload

```python
server app port 3000:
  upload "/api/upload" "avatar" (req, res):
    ret {filename: req.file.filename, size: req.file.size}
```

Zero-dependency multipart parser. `req.file` contains `{filename, contentType, data, size}`. `req.files` has all files by field name.

### view — Template rendering

```python
server app port 3000:
  view "./views"
  get "/":
    ret.render "home" {title: "Welcome", items: ["a", "b"]}
```

Simple template engine reading `.html` files. Supports `{{variable}}`, `{{if condition}}...{{/if}}`, `{{each item in list}}...{{/each}}`.

### sse — Server-Sent Events

```python
server app port 3000:
  sse "/events"
  post "/api/notify" (req, res):
    sse.broadcast req.body
    ret {ok: true}
```

Creates an SSE endpoint. `sse.send(data)` and `sse.broadcast(data)` push to all connected clients. `sse.count` returns active connections.

### cache — Response caching

```python
server app port 3000:
  cache "/api/*" "5m"
```

Caches GET responses in memory. Auto-invalidates after TTL. Sets `X-Cache: HIT/MISS` header.

### mid — Named middleware

```python
fn logger(req, res, next):
  log req.method, req.url
  next()

server app port 3000:
  mid logger           # apply globally
  mid logger "/api"    # apply to path only
```

Define middleware as a function, apply with `mid name` inside server blocks.

### api — HTTP client

```python
fn.async getUsers() -> any:
  any users = await api.get("https://api.example.com/users")
  ret users

fn.async createUser(map data) -> any:
  any result = await api.post("https://api.example.com/users", data)
  ret result
```

Methods: `api.get(url)`, `api.post(url, body)`, `api.put(url, body)`, `api.del(url)`, `api.raw(url, opts)`.
Zero-dependency — uses Node.js 18+ built-in `fetch`. Auto-imported when used.

### env — Environment variables with validation

```python
env:
  PORT       int default(3000)
  JWT_SECRET str required
  DB_URL     str default("sqlite:data.db")
```

Variables become constants available throughout the file.

### every — Scheduled tasks

```python
every "5m":
  log "cleanup running"
```

Intervals: `"30s"`, `"5m"`, `"1h"`, `"1d"`

### watch — React to events

```python
watch User.create (event):
  log "new user: {event.data.name}"
```

Automatically connected to `crud` events.

### Response helpers

```python
ret {data: items}              # JSON response (default)
ret.status 404 {error: "nope"} # custom status code
ret.redirect "/login"           # HTTP redirect
ret.html "<h1>Hello</h1>"      # HTML response
ret.text "pong"                 # plain text response
ret.file "/path/to/file"       # send file
ret.render "template" {data}   # render template (requires view)
```

### Built-in functions

```python
str id = uuid()                         # generate UUID
str hashed = hash("password")           # hash password
bool ok = verify("password", hashed)    # verify password
str token = sign({id: 1})               # sign JWT (uses auth secret)
str token = sign({id: 1}, "my-secret")  # sign JWT (explicit secret)
```

These are auto-imported from the runtime when used.

### Full example

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

server app port PORT:
  cors "*"
  cookie
  auth JWT_SECRET:
    protect "/api/*"
    public "/api/auth/*"
  limit "/api/*" 100 "1m"
  static "/public"
  crud "/api/users" User

  group "/api/v1":
    get "/status":
      ret {version: "1.0"}

  post "/api/auth/register" (req, res):
    str hashed = hash(req.body.password)
    user = UserStore.create({...req.body, password: hashed})
    token = auth.sign({id: user.id})
    ret {token, user}

  post "/api/auth/login" (req, res):
    user = UserStore.where({email: req.body.email})[0]
    if not user:
      ret.status 401 {error: "Invalid credentials"}
    if not verify(req.body.password, user.password):
      ret.status 401 {error: "Invalid credentials"}
    token = auth.sign({id: user.id})
    ret {token}

  ws "/chat":
    on "message" (data):
      broadcast(data)

  get "/":
    ret.html "<h1>Welcome</h1>"

  error (err, req, res):
    log.error err.message
    ret.status 500 {error: "Something went wrong"}

watch User.create (event):
  log "new user: {event.data.name}"
```

This generates a complete production API with persistent storage, auth, password hashing, CORS, cookies, rate limiting, CRUD with pagination/search, WebSocket, route groups, error handling, and static files — from ~45 lines.

## NAIDE syntax (.naide)

```python
# Variables with types
str name = "World"
int count = 3
mut int counter = 0

# Functions
fn greet(str who) -> str:
  ret "Hello, {who}!"

# Async
fn.async fetchData(str url) -> any:
  ret await fetch(url)

# Control flow
if count > 5:
  log "many"
elif count > 2:
  log "some"
else:
  log "few"

# Loops
each item in items:
  log item

for i in 0..10:
  log i

# Server (Express built-in)
server app port 3000:
  get "/users":
    ret users
  post "/users" (req, res):
    ret req.body

# Error handling
try:
  data = await fetchData(url)
fail e:
  log.error e.message

# Classes
model User:
  str name
  int age = 0
  fn greet() -> str:
    ret "Hi {self.name}"

# Pipe operator
list result = data
  |> filter((x) => x.active)
  |> map((x) => x.name)
```

## NAIDE-X syntax (.nx)

Every keyword is a single character. Line-start symbol = intent.

```
-- Variables
s:name="World"
i:count=3
~i:counter=0

-- Function
f greet(s:who)s
  >"Hello, {who}!"

-- Async
~f fetchData(s:url)a
  >~fetch(url)

-- Control flow
?count>5
  log"many"
|count>2
  log"some"
:
  log"few"

-- Loops
@item<items
  log item
@i<0..10
  log i

-- Server with high-level features
$app:3000
  cors "*"
  auth SECRET:
    protect "/api/*"
  static "/public"
  crud "/api/users" User
  G"/users"
    >users
  P"/users"(req,res)
    >req.body
  G"/old"
    >.r "/new"
  G"/"
    >.h "<h1>Hello</h1>"

-- Error handling
!
  data=~fetchData(url)
!!e
  log.e e.message

-- Model
^User
  s:name
  i:age=0
  f greet()s
    >"Hi {self.name}"
```

### NAIDE-X cheat sheet

| Symbol | Meaning | Symbol | Meaning |
|--------|---------|--------|---------|
| `>` | return | `?` | if |
| `\|` | elif | `:` | else |
| `@` | loop | `*` | while |
| `!` | try | `!!` | catch |
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

High-level: `schema`, `crud`, `auth`, `cors`, `limit`, `env`, `every`, `watch`, `static`, `ws`, `db`, `group`, `cookie`, `error`, `session`, `upload`, `view`, `sse`, `cache`, `patch` — same syntax in both modes. `api` is auto-imported.

## Why?

AI code generation speed depends on:

1. **Token count** — fewer output tokens = faster generation
2. **Predictability** — one way to write everything = better next-token prediction
3. **Context window** — shorter code = more room for complex projects

NAIDE-X is designed as an **AI-internal representation** — the AI thinks in NAIDE-X, users receive standard JavaScript.

## License

MIT
