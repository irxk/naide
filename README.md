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
# Run a file
naide app.naide
naide app.nx

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

### crud — Auto-generate REST endpoints

```python
server app port 3000:
  crud "/api/users" User
```

Generates GET (list + by ID), POST, PUT, DELETE routes with validation.

### auth — JWT authentication

```python
server app port 3000:
  auth JWT_SECRET:
    protect "/api/*"
    public "/api/auth/*"
```

Built-in JWT sign/verify with no external dependencies.

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

### Full example

```python
env:
  PORT int default(3000)
  JWT_SECRET str required

schema User:
  id auto
  name str required min(2) max(50)
  email str required email

server app port PORT:
  cors "*"
  auth JWT_SECRET:
    protect "/api/*"
    public "/api/auth/*"
  limit "/api/*" 100 "1m"
  crud "/api/users" User
  get "/health":
    ret {status: "ok"}

watch User.create (event):
  log "new user: {event.data.name}"
```

This generates a complete Express API with validation, auth, CORS, rate limiting, and CRUD — from 20 lines.

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
  crud "/api/users" User
  G"/users"
    >users
  P"/users"(req,res)
    >req.body

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

Types: `s`=str `i`=int `n`=num `b`=bool `l`=list `m`=map `a`=any

High-level: `schema`, `crud`, `auth`, `cors`, `limit`, `env`, `every`, `watch` — same syntax in both modes.

## Why?

AI code generation speed depends on:

1. **Token count** — fewer output tokens = faster generation
2. **Predictability** — one way to write everything = better next-token prediction
3. **Context window** — shorter code = more room for complex projects

NAIDE-X is designed as an **AI-internal representation** — the AI thinks in NAIDE-X, users receive standard JavaScript.

## License

MIT
