# NAIDE

**Node AI Development Environment** — One readable syntax for building, checking, and running applications, with the NaideVM direct interpreter and compiler targets for **15 languages**.

NAIDE is designed around one canonical syntax shared by people, AI tools, the compiler, editor support, and examples. It combines familiar control flow and types with concise inference, a built-in application toolkit, diagnostics, and a compiler that can emit multiple targets. The goal is not to hide how programs work, but to make common work direct and errors easier to find.

### Compilation Targets

| Target | Flag | Language | Server Framework | CI validation |
|--------|------|----------|-----------------|---------------|
| `node` | default | JavaScript (ES Modules) | Express | Code generation + basic runtime smoke |
| `python` / `py` | `--target python` | Python | Flask | Code generation + basic runtime smoke |
| `bun` | `--target bun` | JavaScript (Bun) | Bun.serve | Code generation + basic runtime smoke |
| `typescript` / `ts` | `--target ts` | TypeScript | Express | Compile + runtime smoke |
| `go` | `--target go` | Go | net/http | Compile + runtime smoke |
| `java` | `--target java` | Java | HttpServer | Compile + runtime smoke |
| `rust` / `rs` | `--target rust` | Rust | actix-web | Compile + runtime smoke |
| `cpp` / `c++` | `--target cpp` | C++ | cpp-httplib | Compile + runtime smoke |
| `c` | `--target c` | C | libmicrohttpd | Compile + runtime smoke |
| `csharp` / `cs` | `--target csharp` | C# | ASP.NET | Compile + runtime smoke |
| `kotlin` / `kt` | `--target kotlin` | Kotlin | Ktor | Compile + runtime smoke |
| `swift` | `--target swift` | Swift | Vapor | Compile + runtime smoke |
| `dart` | `--target dart` | Dart | shelf | Compile + runtime smoke |
| `php` | `--target php` | PHP | Built-in / Laravel | Compile + runtime smoke |
| `ruby` / `rb` | `--target ruby` | Ruby | Sinatra | Compile + runtime smoke |

NAIDE source files use the `.naide` extension. There is one language syntax; no separate compressed or AI-only dialect.

#### What "supported target" means

The table describes exactly what CI is configured to verify: all 15 targets have automated code-generation checks and a hosted Linux job compiles and runs a small program with a function call and conditional output for each target. The dedicated runtime job treats missing compilers as failures rather than silently skipping them. This does **not** guarantee that every generated program compiles or runs, or that every built-in feature has equivalent behavior. Backend feature coverage varies; review generated code and target-specific requirements before relying on it in production.

The server-framework column identifies the backend's intended framework; it is not a promise that every NAIDE server feature is implemented for that target. The C backend rejects CRUD, authentication, and WebSocket declarations; the Rust backend rejects the same declarations instead of emitting placeholder TODO code. Other backend-specific feature gaps may still exist. Treat a feature as supported only when generated code is executable and its compile/runtime integration tests pass.

NAIDE's measurable release-readiness criteria and current evidence are tracked in [docs/release-readiness.md](./docs/release-readiness.md). A configured CI check is not counted as passing until it has run successfully.

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
npm run check
npm run dev
```

Or write a file directly:

```python
# app.naide
log "Hello from NAIDE"
```

```bash
naide app.naide
```

The default file runner and REPL execute NAIDE directly with NaideVM, without generating JavaScript. Experimental direct and hotness-tiered machine-code modes are available only for a guarded numeric subset on Windows x64; both remain opt-in and neither has met the all-workload performance gate against V8. The native backend uses liveness-based XMM register allocation with stack spills, and can inline bounded immutable pure numeric helpers with simple conditional returns while preserving step and call-depth semantics. It also recognizes exact zero-initialized accumulator loops (triangular sums and unit increments) and may replace them with a closed-form reduction within safe integer bounds while preserving results and logical step charges. Build the bridge from source with `npm run build:native-jit` after installing the Visual Studio C++ Build Tools. Enable eager native compilation with `new NaideVM({ nativeMachineCode: true })`, or delayed compilation after repeated calls with `new NaideVM({ nativeMachineCode: true, nativeMachineCodeThreshold: 8 })`. `nativeMachineCodeDiagnostics: true` enables compilation, allocation/spill, code-size, call, warmup, and fallback counters available through `getNativeMachineCodeStats()`. Tiered execution conservatively leaves low-benefit leaf functions on the existing fast tier. Use `naide --compile app.naide` only for JavaScript runtime and framework-backed declarations outside NaideVM's stated support. Use `naide --emit app.naide` to inspect generated JavaScript.

### Japanese Learning Path

1. **Values and variables** — `str` / `int` / `bool` declare values; add `mut` only when a value must change.
2. **Decisions and repetition** — use `if` / `elif` / `else` and `each`.
3. **Functions** — declare reusable behavior with `fn` and return with `ret`.
4. **Applications** — start with a route, then add validation, authentication, and storage deliberately.

```naide
str name = "NAIDE"
mut int visits = 0

fn greet(str who) -> str:
  ret "こんにちは、{who}さん"

if visits == 0:
  log greet(name)
  visits += 1
```

Save as `lesson.naide`, then run `naide lesson.naide`. To inspect a project's local setup, use `naide doctor`; use `naide verify` to check its manifests without executing code. Each lesson should introduce one concept at a time—read the generated behavior and test your own small variation before adding features.

## CLI

```bash
naide <file.naide>             # Run directly with the interpreter
naide --compile <file.naide>   # Opt in to JavaScript compilation/runtime
naide --native <file.naide>    # Alias for the default direct execution mode
naide --watch <file.naide>     # Restart native execution when the source changes
naide --node-module node:crypto <file.naide> # Explicitly allow one Node.js builtin
naide                         # Start interactive REPL
naide repl                    # Start interactive REPL
naide init [dir]              # Scaffold a new project
naide build [dir] [outdir]    # Transpile all files to JavaScript
naide check <files...>        # Type-check without running
naide fmt <files...>          # Format NAIDE files
naide lsp                     # Start Language Server (LSP)
naide vscode                  # Install VS Code extension
naide deploy [dir]            # Generate Dockerfile for deployment
naide doctor [dir]            # Diagnose local tools and project setup
naide verify [dir]            # Validate manifests and type-check NAIDE sources
naide status                  # Show release posture, support boundaries, and evidence
naide release                 # Alias for naide status
naide test [dir]              # Run detected native test suites
naide pkg init                # Create naide.pkg.json manifest
naide pkg install <name>      # Install a NAIDE package
naide pkg add <manager> <spec> # Install with a native package manager
naide pkg managers            # List supported package ecosystems
naide pkg publish             # Publish package to npm
naide -w <file>               # Watch mode (auto-restart on changes)
naide -d <file>               # Debug mode (Node.js inspector)
naide ~~ "instruction"        # Generate NAIDE code from natural language
naide gen "instruction"       # Same as ~~ (alias)
naide --expand <file>         # Show ~~ directive expansion results
naide --emit <file>           # Print generated JavaScript
naide -o <out.js> <file>      # Write JavaScript to file
naide --ast <file>            # Print AST
naide --tokens <file>         # Print token stream
```

The native runtime provides limited host context without exposing Node.js `process` or launching shell commands:

```naide
each argument in runtime.args:
  log argument

str mode = runtime.env.get("APP_MODE")
str directory = runtime.cwd
log "{runtime.platform}/{runtime.arch}"
runtime.exitCode = 2
```

`runtime.args` contains arguments after `--` in `naide app.naide -- input.txt`. Environment variables are **not** exposed by default; opt in by name with `--env APP_MODE`, which makes only that variable visible through `runtime.env.get/has/keys` and declared `env:` values. Embedded runtimes can pass `runtime: {args, env, cwd, platform, arch}` to `NaideVM` (the backwards-compatible `NativeEngine` export is an alias) or `runNativeAsync`.

The default file runner, `naide --native`, and `naide native` use NAIDE's direct AST interpreter; these paths do not generate or execute JavaScript. The REPL also runs directly by default; `.compile` switches to JavaScript inspection mode and `.eval` returns to direct execution. `naide check` and `--check` type-check without compiling, and `--watch` restarts native runs by default. `--debug` remains a compiler/Node debugger workflow; use `--compile` explicitly when debugging generated JavaScript. The `naider/native` package entry exposes the interpreter API for embedding in Node.js applications. This interpreter supports core values, functions and synchronous/asynchronous generators, model declarations and inheritance, enums, expressions, conditionals, loops, matching, basic error handling, `fn.async`, `await`, `await.all`, task primitives and channels, relative imports of `.naide` modules, and installed NAIDE source packages. Export values, functions, models, and enums with `pub`, then import them with `use`:

```naide
# math.naide
pub fn add(int left, int right) -> int:
  ret left + right

pub enum Color:
  RED
  GREEN

model User:
  str name
  int age = 0
  fn greet() -> str:
    ret "Hello, {self.name}"
```

```naide
# app.naide
use { add } from "./math.naide"
log add(20, 22)
```

Enum members have zero-based integer values and enum objects are frozen:

```naide
use { Color } from "./math.naide"
int favorite = Color.GREEN
```

Models support `new`, ordered constructor arguments, field defaults, custom `init(params):` initializers, instance methods using `self`, and single inheritance with inherited fields and methods. Custom initializers run after parent initialization and field defaults, and can assign fields through `self`. Models can declare initialized `static <type> field = value` fields, plus `static fn` and `static fn.async` methods; static fields and methods are inherited by derived models. In static methods, `self` refers to the class used for the call, including when an inherited method is called on a derived model. Overridden instance or static methods can call their parent implementation with `super.method()`, including with `await` in async methods. Arbitrary JavaScript classes and model features requiring compiler/runtime integrations remain outside the direct interpreter.

```naide
model User:
  str name
  int age = 18
  init(str name, int age = 18):
    self.name = name
    self.age = age
```

NAIDE source packages installed with `naide pkg install` are stored in `naide_modules/` and can be imported by their package name. npm and other JavaScript dependencies continue to use `node_modules/`. The interpreter checks `naide_modules/` first and retains `node_modules/` as a compatibility fallback for existing projects. A NAIDE package must include a `naide.pkg.json` whose `main` points to a `.naide` entry file inside that package; packages created by `naide pkg init` use `index.naide` by default. Package lookup walks the importing file's parent directories, allowing nested package dependencies. A package can expose additional files by exact subpath mappings in `exports`:

```naide
use { add } from "@example/math"
use { divide } from "@example/math/arithmetic"
log add(20, 22)
```

```json
{
  "main": "index.naide",
  "exports": {
    "./arithmetic": "./src/arithmetic.naide"
  }
}
```

Only declared subpaths can be imported, and each mapped `.naide` file must resolve inside the package (including through symbolic links). JavaScript packages must be declared in the nearest project `package.json` or `nidpackage.json` dependencies before import. Node.js built-ins are disabled unless that exact module is granted with `--node-module node:crypto` (repeatable) or the `nodeModules` option to `NaideVM`; `node:process`, `node:fs`, and `node:child_process` are not exposed implicitly. Allowed JavaScript modules execute with the host process's permissions and are not sandboxed. Imported modules are evaluated once and cached; cyclic imports fail with an explicit diagnostic. Synchronous and asynchronous generator functions, lambdas, and model methods support standalone `yield` statements and `yield*` delegation; async generators may await while producing values. `yield` nested inside another expression remains unsupported. `for await value of iterable:` consumes asynchronous or synchronous iterables in async functions and async generators; synchronous execution rejects it. Iterable consumption and collection callbacks count against the NaideVM execution step budget and close iterators on early exit or failure.

The current NaideVM capability inventory classifies all 120 parser AST types: 62 supported, 58 contextual, and 0 unsupported. The measured AST availability is **120/120 (100%)** under the agreed contract: contextual nodes execute in their intended parent/server context or through an explicitly supplied, validated `NaideVM` capability. This is an AST execution metric, not a compiler-parity, provider-bundling, or release-readiness score. Database, bot, object-storage, mail, Web Push, desktop, GraphQL, gRPC, image, migration, OAuth, payments, PDF, WebRTC, WebSocket, and blockchain integrations require host adapters; the CLI runner does not invent credentials or third-party provider implementations. `NaideVM` accepts a `nativeServices` object of functions for those integrations and reports an error when a required adapter is absent. The `NativeEngine` export remains available as a compatibility alias. Native pages, screens, locale files, CSV output, and downloads use project-confined I/O. Native server support includes bounded JSON, URL-encoded, and multipart bodies; routes, schemas and file-backed CRUD; bearer authentication, signed in-memory sessions, CORS, rate limits, redirects, project-confined static files and downloads; bounded SSE; response caching; views; queues; and OpenAPI generation. GraphQL adapters supply an HTTP handler; WebSocket adapters supply an upgrade handler and optional cleanup callback. The server binds to `127.0.0.1` by default; use `--host 0.0.0.0` only when intentionally exposing it to the network.

When embedding `NaideVM` (or the compatible `NativeEngine` alias), integrations use explicit adapters: `database` provides `connect` and `createStore`; `bot.create` returns a client with `on`, `command`, and `start`; `storage.connect` returns `upload`, `download`, and `remove`; `mailer.createTransport` returns `sendMail`; and `push.configure` returns `sendNotification`. The `nativeServices` adapter map accepts functions named `desktop`, `graphql`, `websocket`, `grpc`, `webrtc`, `image`, `pdf`, `migration`, `oauth`, `payments`, and `blockchain`. Each receives evaluated declaration values; event and RPC adapters also receive callable handlers that execute the NAIDE bodies. GraphQL functions return an HTTP handler, while WebSocket server functions return `{ handler, close? }` for HTTP upgrade routing and orderly cleanup. Adapter failures are reported rather than silently replaced. See [release readiness](./docs/release-readiness.md) for the full native capability boundaries.

`await.all` starts all listed async operations before waiting for their results, enabling I/O concurrency. Synchronous iterable collections support `map`, `filter`, `reduce`, `find`, `some`, `every`, `flatMap`, `unique`, `enumerate`, streaming `zip`, `chunk`, `partition`, `groupBy`, `count`, and `sum`; `zip` stops at the shortest input and closes the other iterators, `groupBy` returns a `Map`, and `chunk` keeps the final partial group. Async iterables also support `zipAsync`, `chunkAsync`, `partitionAsync`, `groupByAsync`, `countAsync`, and `uniqueAsync`; callback-based partition/group/count operations preserve input order. `mapAsync`, `filterAsync`, and `forEachAsync` run callbacks with a positive-safe-integer concurrency limit and consume synchronous or asynchronous iterables; async map/filter preserve input order. `reduceAsync` runs its callback sequentially. `task.map` remains the task-oriented bounded-concurrency mapping API. The native runtime also exposes asynchronous file I/O through `io`; relative paths are confined to the entry file's directory, and paths escaping it (including symbolic-link escapes) are rejected:

```naide
await io.writeText("notes.txt", "hello")
await io.appendText("notes.txt", " from NAIDE")
str contents = await io.readText("notes.txt")
bool present = await io.exists("notes.txt")
list files = await io.listDir(".")
```

`io` provides `readText`, `writeText`, `appendText`, `exists`, and `listDir`. Writes only target existing directories. When embedding the engine, pass an explicit `io` capability to `NativeEngine` / `runNativeAsync` to provide a host-specific implementation; otherwise source-only runs use the current working directory as the project root. These operations are asynchronous and work in the default file runner and REPL. Runtime errors include NAIDE source-line locations and a `NAIDE stack` with function and file frames when available. Step and call-depth limit errors use the same diagnostics. The path checks are a useful project boundary, not an OS-level sandbox for hostile code. Eligible synchronous functions use a conservative JavaScript fast tier; unsupported functions continue through the interpreter. The checked-in five-workload benchmark currently exceeds its CPython 3.13.7 baseline on all five measured workloads on the recorded host, but this is not a portable performance guarantee. CPU-parallel execution and Go-class throughput remain future work. JavaScript generation remains available as an explicit compatibility path. A configurable step budget protects against runaway programs:

Collection queries `find`, `some`, and `every` stop as soon as their result is known instead of consuming the entire iterable. `first`, `take`, and `takeWhile` also stop early and close the iterator; `drop` skips a specified non-negative item count. Their async counterparts are `firstAsync`, `findAsync`, `someAsync`, `everyAsync`, `takeAsync`, and `takeWhileAsync`. Count arguments must be non-negative safe integers, and iterable reads are covered by the execution step limit.

The native runtime also exposes `http.request`, `http.get`, and `http.post`. They return the host's Fetch `Response`, so JSON and text bodies can be read with `await response.json()` and `await response.text()`:

```naide
fn.async loadUser(str id):
  map response = await http.get("https://api.example.com/users/{id}")
  ret await response.json()

map user = await loadUser("42")
```

Only absolute `http:` and `https:` URLs are accepted. The default uses the host's Fetch implementation; embeddings can provide an `http` capability with `request`, `get`, and `post` methods. Network access is not restricted to an allowlist and is not an OS-level sandbox; only run trusted code with network access.

For concurrent work, `task.spawn` starts a function, `task.all` waits for all results in input order, `task.race` returns the first settled result, `task.map` processes a list with a concurrency limit while preserving result order, and `task.sleep` asynchronously waits for a duration in milliseconds. `task.controller()` creates an `AbortSignal`; `task.withTimeout(callback, milliseconds, ...args)` passes a signal as the callback's final argument and aborts it on timeout:

```naide
fn.async load(str url):
  map response = await http.get(url)
  ret await response.json()

list results = await task.all([
  task.spawn(load, "https://api.example.com/a"),
  task.spawn(load, "https://api.example.com/b")
])
list users = await task.map(["a", "b", "c", "d"], 2, load)
```

Task concurrency is cooperative and intended for I/O-bound work; it does not run CPU-bound NAIDE functions in parallel threads. `task.all` rejects when any task rejects. `task.race` does not cancel tasks that finish later. `task.map` stops dispatching new items after a callback fails, but already-running callbacks are allowed to finish.

Pass the signal to cancellable operations such as HTTP requests or `task.sleep`. Cancellation is cooperative: arbitrary host functions that ignore the signal continue running, even after `task.withTimeout` has returned a timeout error.

Use `task.channel(capacity)` to pass messages between asynchronous tasks. Capacity defaults to `0` (a rendezvous channel where each send waits for a receiver); positive capacity buffers messages. `receive()` returns `{value, done}` and returns `done: true` after a closed channel has been drained. Closing is idempotent, wakes blocked receivers, and rejects blocked or future sends. `send(value, signal)` and `receive(signal)` accept an optional `AbortSignal`; cancelling a blocked operation removes it from the channel queue without consuming or publishing a message:

```naide
map messages = task.channel(2)
await messages.send("ready")
map item = await messages.receive()
messages.close()
```

```bash
naide app.naide --steps 2000000
```

Example native async source:

```naide
fn.async load(int id):
  ret await fetchValue(id)

list pending = [load(1), load(2)]
list values = await.all pending
log values
```

`await.all` preserves the input order of results and rejects if any task rejects. This provides cooperative asynchronous I/O concurrency; it does not run CPU-bound NAIDE code in parallel threads.

### Code Generation (`~~`)

Generate valid NAIDE code from natural language instructions — no AI, no network, no dependencies. Pure pattern matching + template composition with self-healing parser validation. Multi-entity support with automatic relationship detection, paginated CRUD, soft delete, batch operations, nested routes, seed data, tests, and full project scaffolding.

```bash
# Single entity
naide ~~ "REST API for users with auth"
naide ~~ "todo app with database"

# Multi-entity (auto-detects relationships, injects foreign keys)
naide ~~ "users and products and orders with auth"

# Composite presets
naide ~~ "shop"        # User + Product + Order
naide ~~ "crm"         # User + Contact + Deal + Activity
naide ~~ "sns"         # User + Post + Comment + Message + Notification
naide ~~ "booking"     # User + Event + Reservation

# Project mode (generates full directory)
naide ~~ "e-commerce app with auth" --project

# File write mode (merge into existing file)
naide ~~ "REST API for users" --write app.naide

# Japanese
naide ~~ "ECサイト"
naide ~~ "ユーザー管理APIを認証付きで"
```

Generated routes per entity: paginated list, CRUD, soft delete, restore, batch create/delete, nested routes (from relationships), file upload, webhooks. With auth: register, login, profile, admin stats, audit log.

Project mode (`--project`) generates: `app.naide`, `package.json`, `.env`, `Dockerfile`, `README.md`, `openapi.json`, `admin.html`, `client.mjs`.

API usage:

```javascript
import { generate, generateProject } from 'naider';

const result = generate("users and products with auth");
console.log(result.entities);      // ['User', 'Product']
console.log(result.relationships); // [{parent:'User', child:'Product', fk:'user_id'}]
console.log(result.valid);         // true
console.log(result.analysis);      // {entities, relationships, plan, ...}

const project = generateProject("e-commerce with auth");
project.files.forEach(f => console.log(f.path));
```

**Self-healing**: Generated code is validated against the actual NAIDE parser. Parse errors are auto-fixed (up to 5 retries) — missing colons, indent issues, reserved keyword conflicts.

**Field normalization**: Smart aliases — `e-mail` → `email`, `pwd` → `password`, `tel` → `phone`, `desc` → `description`. Field types are auto-inferred from names (`email` → `str + email`, `age` → `int`, `done` → `bool`).

<details>
<summary>Keyword Cheat Sheet</summary>

| Category | Keywords |
|----------|----------|
| Intent | `server` `api` `rest` `bot` `cli` `page` `test` `database` `ai` `crud` `auth` `websocket` `mail` `graphql` |
| Composite | `todo` `blog` `chat` `shop` `fullstack` `board` `crm` `inventory` `booking` `sns` |
| Platform | `discord` `slack` `telegram` `line` |
| DB Type | `sqlite` `postgres` |
| JP Intent | `サーバー` `認証` `ログイン` `会員` `CRUD` `管理` `データベース` `ボット` `テスト` `ページ` `メール` |
| JP Entity | `ユーザー` `商品` `記事` `タスク` `注文` `コメント` `イベント` `問い合わせ` `通知` `カテゴリ` `掲示板` `決済` `予約` `社員` |
| JP Composite | `管理システム` `やることリスト` `ブログ` `チャットアプリ` `ECサイト` `掲示板` |
| NL Phrases | `"users can comment"` `"admin manage"` `"upload"` `"search"` `"notification"` `"deploy"` `"seed"` |
| Fields | `"with name email age"` — auto-inferred types & validators |

</details>

### REPL

```
$ naide
NAIDE REPL v2.0.9 — type NAIDE code; use `.compile` to inspect JavaScript output
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

The default runner and REPL use NaideVM's direct AST execution, with eligible synchronous functions using its fast tier and all unsupported constructs retaining interpreter execution. Use `naide --compile <file.naide>` to opt in to the JavaScript runtime; generated applications that depend on unsupported framework declarations should continue to use this mode until NaideVM implements those integrations.

JavaScript applications can embed NaideVM without importing the compiler API:

```js
import { runNativeAsync } from 'naider/native';

await runNativeAsync('log "executed directly"');
```

This entry point evaluates NAIDE source through the interpreter and does not generate JavaScript. It still runs on Node.js; it is not a standalone native binary.

### Playground

Open `playground/index.html` in a browser (via a local server) for a live in-browser compiler with examples and source-size indicators.

### Benchmark

```bash
node benchmark/compare.js
```

```
  Source         Whitespace units   Chars   Lines
  JavaScript                  330    2590      78
  NAIDE                        66     517      19
```

The benchmark's "whitespace units" are a rough source-size comparison, not model-token counts or evidence of faster generation.

The runtime comparison is a separate, measured microbenchmark:

```bash
npm run benchmark:engines -- --iterations 100000 --samples 7 --json docs/naidevm-benchmark.json
```

It runs five deterministic arithmetic, branching, function-call, collection, and mixed workloads on the default NaideVM tier, Node/V8, Bun/JavaScriptCore, CPython, and both native x64 modes when the bridge is available; checks exact results; and records median throughput, cold process startup, OS-reported peak RSS, and native-tier activity. Performance acceptance compares each NaideVM tier against Node/V8 separately on every workload; the current checked-in results do not pass that gate. The native integer-sum workload benefits from a general guarded accumulator-loop reduction, not a benchmark-specific result substitution; the optimizer preserves the result and NaideVM's logical step charge. Bounded conditional-helper inlining now lets the native tier compile the mixed-loop fixture, but it remains slower than V8. The [NaideVM comparison page](./docs/naidevm.html) plots per-workload ratios to V8 and the measured tier counters. Passing these specific fixtures does not establish general application performance or full feature parity.

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

auto x = 42                  # type inferred (const)
auto msg = "hello"           # compiler infers str
mut auto counter2 = 0        # type inferred (let)
```

Types: `str`, `int`, `num`, `bool`, `list`, `map`, `any`, `json`, `void`, `auto` (inferred)

### Destructuring

```python
# Object destructuring
auto {name, age} = user
auto {name, age = 0} = user          # with defaults
auto {name, ...rest} = user          # with rest
mut {score, level} = gameState       # mutable

# Array destructuring
auto [first, second] = items
auto [head, ...tail] = items         # with rest
auto [x, y = 0] = coords            # with defaults
mut [a, b] = pair                    # mutable
```

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

Schema inheritance with constructors and methods:

```python
schema Animal:
  id       auto
  name     str required
  species  str required

schema Dog extends Animal:
  breed    str optional
  trained  bool default(false)

  init(str name, str breed):
    self.name = name
    self.breed = breed

  fn bark() -> str:
    ret "Woof! I'm {self.name}"
```

`init(params):` defines a constructor. `fn method():` defines methods. `extends` inherits all fields and methods from the parent.

### Pipe Operator

```python
list result = data
  |> filter((x) => x.active)
  |> map((x) => x.name)
  |> sort()

int total = items
  |> filter((x) => x > 0)
  |> map((x) => x * 2)
  |> reduce((a, b) => a + b, 0)
```

Chain operations left to right for readable data transformations.

### Optional Chaining & Null Coalescing

```python
str name = user?.name                    # safe property access
any val = data?.nested?.value            # deep safe access
any first = maybeList?.[0]                # optional computed access
any result = maybeCallback?.("value")     # optional function call
str display = user?.name ?? "Anonymous"  # fallback on null/undefined
int port = config?.port ?? 3000
```

`?.` safely accesses properties, computed indexes, or callable values (returns `undefined` if the left side is `null`/`undefined`). `??` provides a fallback value when the left side is `null` or `undefined`.

### Dynamic Imports and Compound Assignment

```python
any plugin = await import("./plugins/report.naide")
mut num total = 10
total *= 2
total ??= 1
mut bool enabled = true
enabled &&= hasPermission
```

`import(specifier)` is emitted as a native dynamic ESM import, so the specifier can be computed and the result can be awaited. Literal relative `.naide` specifiers are rewritten to generated `.mjs` files for build output and remain `.naide` when loaded through Native-Meld. Browser builds can bundle dynamic npm imports with `naide build . build --bundle-browser`. Arithmetic (`+=`, `-=`, `*=`, `/=`, `%=`) and logical (`??=`, `&&=`, `||=`) compound assignments follow JavaScript semantics.

NAIDE also accepts JavaScript's `&&` and `||` logical operators as aliases for `and` and `or`, along with `===` and `!==` for strict equality, while retaining the readable word forms and `is`/`isnt`.

### JavaScript syntax coverage

NAIDE remains its own indentation-based language; this is not a parser for arbitrary `.js` files. JavaScript-generating targets (Node.js, Bun, TypeScript, and browser modules) additionally support:

- Decimal, hexadecimal, binary, octal, exponent, numeric-separator, and BigInt literals (`bigint` is available as a declaration type).
- Regular-expression literals and backtick template literals with `${...}` interpolation.
- Exponentiation, bitwise and shift operators, unary `+`/`~`, prefix/postfix `++`/`--`, JavaScript ternary expressions, and their compound assignments.
- Iterator loops (`for item of values`, `for key in object`), post-test loops (`do: ... while condition`), and generator declarations (`fn.gen`, `fn.async.gen`) with `yield`/`yield*`.
- Existing NAIDE `match` provides switch-like case selection with automatic breaks; `each`, `model`, and `use`/`pub` provide NAIDE-native alternatives to JavaScript loop/class/module declarations.

This is a practical compatibility subset, not complete ECMAScript grammar. Decorators, labeled `break`/`continue`, and direct JavaScript `class`/`import`/`export` source syntax remain outside this interface. The other language backends do not promise these JavaScript-only features; `compileAsync` reports an explicit target error rather than emitting unsupported syntax.

Expressions inside backtick `${...}` interpolations use JavaScript expression syntax and are passed through to the generated JavaScript; they are not parsed as NAIDE expressions.

### Spread Operator

```python
list combined = [...listA, ...listB]
map merged = {...defaults, ...overrides}
list withExtra = [...items, 4, 5, 6]
map withDebug = {...config, debug: true}
```

Spread arrays and objects with `...`. Works in list literals, map literals, and function arguments.

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
bot myBot token process.env.BOT_TOKEN:
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

### Run a NAIDE Discord bot on MWS

NAIDE's host runner removes the need to upload a JavaScript bootstrap. Upload `discord-bot.naide` and `nidpackage.json`; the manifest points Node.js at the installed runner, which registers the NAIDE loader and imports the source:

```json
{
  "name": "naide-discord-bot",
  "version": "1.0.0",
  "main": "node_modules/naider/bin/naide-host.js",
  "naide": {
    "entry": "discord-bot.naide"
  },
  "dependencies": {
    "naider": "^2.0.9",
    "discord.js": "^14.27.0"
  }
}
```

Save the manifest as `nidpackage.json`. Add any additional compatible npm modules under `dependencies`; NAIDE can import them with `use` from its `.naide` source. The host must install dependencies from this manifest and launch its `main` entry. If the host ignores `main`, configure `node_modules/naider/bin/naide-host.js` as its startup file instead. Uploading a raw `.naide` file as the Node.js startup command is not sufficient because Node needs the loader registered first.

Set `BOT_TOKEN` as a secret environment variable in the host dashboard; never put it in source code or commit it. For slash commands, invite the bot with the `bot` and `applications.commands` scopes. If you add an `on "message"` handler, enable the privileged Message Content intent in the Discord Developer Portal.

This two-file convention works on hosted Node.js services that install dependencies from `nidpackage.json` and honor `main` (or let you select the NAIDE runner as the startup file). It is not a Node.js standard manifest: hosts that ignore `nidpackage.json` need an adapter or equivalent startup configuration. Verify the target host's manifest behavior before relying on auto-detection.

## Browser UI and JavaScript Interoperability

NAIDE can author browser behavior in `.naide` while using the browser's native Web APIs. Import the compiler-provided `naide:browser` module to access `document`, `window`, `fetch`, storage, DOM helpers, Canvas 2D, and the animation-frame loop. This is a built-in NAIDE module, not an npm dependency.

`app.naide` creates the HTML shell; `game.naide` contains the interactive behavior:

```naide
# app.naide
page "index.html":
  lang "ja"
  title "My App"
  style "styles.css"
  importmap "chart.js" "https://esm.sh/chart.js/auto"
  main "#app":
    h1 "Hello World"
    button "#start" "Start"
    canvas "#game" "800" "600"
  module "build/game.mjs"
```

```naide
# game.naide — browser application code, authored in NAIDE
use { select, canvas2d, listen, animate } from "naide:browser"

any canvas = select("#game")
any context = canvas2d(canvas)
mut num position = 0

fn draw(num delta, num elapsed):
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = "#ed7d55"
  context.fillRect(position, 40, 48, 48)
  position += delta * 0.05

fn startGame(any event):
  log "Game started"

listen("#start", "click", startGame)
animate(draw)
```

Build the client module and generate the page:

```bash
naide build . build --bundle-browser
node build/app.mjs
```

`naide build` emits JavaScript modules as build artifacts from the `.naide` sources. Add `--bundle-browser` to bundle browser-compatible npm dependencies installed in the project into the local `.mjs` modules referenced by page `module` elements. It uses esbuild, preserves explicit import-map entries for remote ESM modules, emits imported CSS alongside the browser module and loads it automatically, and reports unsupported browser imports (such as Node-only APIs) rather than silently shipping them. Serve the project directory as a static site so `index.html`, `styles.css`, and `build/game.mjs` can be loaded by the browser. The `module` page element emits `<script type="module">`; `button "#id" "Label"` and `canvas "#id" "width" "height"` generate matching elements. `lang` sets the document language.

`naide:browser` provides `select`, `selectAll`, `listen` (`on` is an alias), `createElement`, `canvas2d`, `animate`, `text`, `value`, `setAttribute`, `toggleClass`, and reactive UI helpers: `state`, `bindText`, `bindValue`, and `bindClass`. A state store exposes `get()`, `set(value)`, `update(fn)`, and `subscribe(fn)`; each DOM binding initializes immediately and returns a cleanup function. `bindValue` synchronizes an input on its `input` event by default. The module also exposes browser globals such as `document`, `window`, `fetch`, `localStorage`, `requestAnimationFrame`, `WebSocket`, `Worker`, `crypto`, `indexedDB`, `URL`, and `performance`. `listen` accepts a selector or element and returns an unsubscribe function. `animate` calls the frame callback with `(deltaMilliseconds, elapsedTimestamp)` and returns a stop function. For direct JavaScript API interoperability, import the needed Web API object or `globalThis` and call its native methods; the authored module remains `.naide`.

To import browser-compatible ESM packages, map their bare specifiers in the page and import normally from the NAIDE client module:

```naide
# app.naide
page "index.html":
  importmap "chart.js" "https://esm.sh/chart.js/auto"
  module "build/chart-demo.mjs"

# chart-demo.naide
use Chart from "chart.js"
```

The import map is emitted as JSON in the HTML head; it does not add handwritten JavaScript. Use an import map for remote browser ESM, or `--bundle-browser` for installed npm packages. A dependency must be installed in the project before bundling; declaring it in `nidpackage.json` alone does not install it or make Node-only APIs available in a browser.

For example, after installing `chart.js` in the project:

```naide
# chart-demo.naide
use Chart from "chart.js/auto"
```

Build it with `naide build . build --bundle-browser`; the package implementation is included in the generated `build/chart-demo.mjs`.

The browser module targets native browser ES modules. `--bundle-browser` bundles compatible packages but does not polyfill Node APIs or make a Node-only package browser-compatible. NAIDE provides static page generation and common DOM/Canvas operations, not a complete typed DOM model or every browser API. Unsupported APIs can be accessed through the JavaScript interop surface if they exist in the browser, but generated code must be run in a browser. The same `.naide` source may not work under Node.js if it uses browser globals.

Page elements support nested content and safe attributes. Specify attributes as child lines, and use `attr` for `aria-*` or `data-*` names:

```naide
page "index.html":
  title "Sign up"
  style "styles.css"
  main "#app":
    h1 "Create an account"
    form "#signup":
      action "/signup"
      method "post"
      label "Email address":
        attr "for" "email"
      input:
        id "email"
        type "email"
        name "email"
        autocomplete "email"
        required
        attr "aria-label" "Email address"
      button "#submit" "Create account":
        type "submit"
```

Generated text and attributes are HTML-escaped. Event-handler attributes such as `onclick` and `javascript:` URLs are rejected; keep behavior in `.naide` browser modules and bind it with `listen` instead of embedding inline JavaScript.

Run a web project locally with automatic rebuilding and browser refresh:

```bash
naide init my-site --template web
cd my-site
naide dev .
# Open http://127.0.0.1:5173
```

`naide dev` compiles `.naide` sources, bundles local browser modules when a page references them, generates `page` HTML, and serves the project with no-store responses. It watches source and static files; failed rebuilds are shown in the terminal and in the served page without replacing the current page with a successful-looking result. The development server binds to loopback by default and does not serve `.naide`, package manifests, hidden files, or `node_modules`. Use `--port` and `--host` to configure the listener deliberately.

The web starter includes a responsive task-list example, accessible form markup, and browser behavior written in NAIDE. It creates `nidpackage.json` and does not create `package.json`; CSS stays in a regular `.css` file.

### Static HTML page generation

```naide
page "index.html":
  title "My App"
  style "styles.css"
  div "container":
    h1 "Hello World"
    p "Welcome"
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

## CSV/Excel Export

```python
csv "users" format "csv":
  columns "name" "email" "age"
  from data

csv "report" format "xlsx":
  columns "id" "value" "date"
  from items
  output "monthly_report.xlsx"
```

| Target | CSV Library | Excel Library |
|--------|-----------|-------------|
| Node.js | csv-stringify | ExcelJS |
| Python | csv (stdlib) | openpyxl |

## Logging

```python
logging "app":
  level "info"
  file "app.log"
  format "json"
  rotate "14d"
```

Usage: `logger.info("message")`, `logger.error("fail")`, `logger.warn("caution")`.

| Target | Library |
|--------|---------|
| Node.js | winston + winston-daily-rotate-file |
| Python | logging (stdlib) |

## DB Migrations

```python
migrate "create_users":
  up:
    log "Creating users table"
  down:
    log "Dropping users table"
```

Generates migration files with `up()` and `down()` methods for reversible schema changes.

## gRPC

```python
grpc "users" port 50051:
  rpc getUser(id) -> user
  rpc createUser(data) -> user
  rpc deleteUser(id) -> result
```

| Target | Library |
|--------|---------|
| Node.js | @grpc/grpc-js + @grpc/proto-loader |
| Python | grpcio |

## WebRTC

```python
webrtc "video-chat":
  stun "stun:stun.l.google.com:19302"
  on offer(data):
    log "Received offer"
  on answer(data):
    log "Received answer"
  on candidate(data):
    log "ICE candidate"
```

Generates a WebSocket-based signaling server with ICE configuration.

| Target | Library |
|--------|---------|
| Node.js | ws (WebSocketServer) |
| Python | websockets + asyncio |

## Blockchain / Web3

```python
blockchain "eth":
  network "ethereum"
  provider env.ETH_RPC
  contract "0x1234abcd..."
  abi "contract-abi.json"
```

Usage: `eth.getBalance("0x...")`, `eth.getBlock()`, `eth.sendTx(wallet, to, "0.1")`.

| Target | Library |
|--------|---------|
| Node.js | ethers.js v6 |
| Python | web3.py |

## Environment Variables

```python
env:
  PORT       int default(3000)
  JWT_SECRET str required
  DB_URL     str default("data/")
```

Variables become constants. Missing `required` vars exit with an error.

## Syntax Sugar (Simpler than Python)

```python
# auto — type inference
auto x = 42
auto msg = "hello"
mut auto counter = 0

# destructuring
auto {name, age} = user
auto [first, ...rest] = items

# unless — negated if
unless x > 10:
  log "small"

# until — negated while
until done:
  process()

# repeat — simple counted loop
repeat 5:
  log "hi"
repeat 10 as i:
  log i

# enum
enum Color:
  RED
  GREEN
  BLUE

# swap
swap a, b

# is / isnt — readable equality
if x is 5: log "five"
if y isnt null: log "exists"

# one-line functions
fn double(int x) -> int = x * 2

# pipe operator
list result = items |> filter((x) => x > 0) |> map((x) => x * 2)

# optional chaining + null coalescing
str name = user?.name ?? "Anonymous"

# spread
list all = [...a, ...b]
map merged = {...defaults, ...overrides}

# print alias
print "hello world"
```

## Built-in Functions

```python
# Security
str id = uuid()
str hashed = hash("password")
bool ok = verify("password", hashed)
str token = sign({id: 1})

# Type conversions
str s = str(42)
int n = int("42")
num f = float("3.14")

# String ops
str u = upper("hello")
str l = lower("HELLO")
str t = trim("  hi  ")
list parts = split("a,b,c", ",")
str joined = join(parts, "-")
bool has = contains("hello", "ell")

# Collection ops
int length = len(items)
list sorted = sort(items)
list r = range(10)
list k = keys(obj)
list v = values(obj)
list uniq = unique(items)
list flat_list = flat(nested)
list zipped = zip(a, b)
list chunks = chunk(items, 3)

# Functional ops (map/filter/reduce)
list doubled = map(items, (x) => x * 2)
list big = filter(items, (x) => x > 5)
int total = reduce(items, (a, b) => a + b, 0)
any found = find(items, (x) => x > 3)
bool allPos = every(items, (x) => x > 0)
bool hasNeg = some(items, (x) => x < 0)
foreach(items, (x) => log x)

# Math
num a = abs(-5)
num r = round(3.7)
num s = sqrt(16)
num p = pow(2, 10)
num total = sum(nums)

# JSON
any data = json_parse('{"a":1}')
str json = json_str(data)

# I/O
str answer = ask("Name?")
str content = read("file.txt")
write("out.txt", content)

# Time & misc
int ts = now()
str t = time()
sleep(1000)
exit(0)
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

Built-in LSP for editor integration — live syntax/type diagnostics, prefix-filtered completions, hover docs, document symbols, and definition/reference navigation across open `.naide` files:

```bash
naide lsp
```

### VS Code

```bash
naide vscode
```

One command installs the extension — syntax highlighting, LSP diagnostics, autocomplete, hover docs, symbols, and definition/reference navigation for `.naide` files. Restart VS Code after install.

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

Build all files with `naide build`, which compiles every `.naide` file to `.mjs`.

### Native-Meld: use NAIDE inside a Node.js project

Native-Meld lets Node.js execute a `.naide` entry file directly, lets an ES module import a `.naide` file, and lets a NAIDE module import Node.js built-ins, installed npm packages, and existing JavaScript modules:

```bash
node --enable-source-maps --import naider/register discord_bot.naide
```

Install `naider` in the Node.js project first. The `--import naider/register` hook registers the loader before Node loads the entry file; Node.js 24.0.0 or newer is required. Node.js 24 is an LTS release; Node.js 26 is currently in its Current phase. See the [official Node.js release schedule](https://nodejs.org/en/about/previous-releases).

```js
// app.js (in a package with "type": "module", or rename this to app.mjs)
import { display } from './display.naide';

console.log(display('./README.md'));
```

```naide
# display.naide
use { basename } from "node:path"

pub fn display(str path) -> str:
  ret "File: " + basename(path)
```

Install NAIDE in the host project, then start Node with the development loader:

```bash
npm install naider
node --enable-source-maps --loader naider/loader app.js
```

The loader compiles `.naide` modules as Node.js ES modules and preserves their imports. Relative `.naide` imports must include the `.naide` extension. `pub fn` and `pub` variables become standard named ESM exports. Node.js CommonJS `require()` integration is not part of this first release; use an ESM host (or `import()` from CommonJS).

For production, compile the `.naide` files and let Node run the resulting JavaScript without a loader:

```bash
naide build .
```

Then point the host's import at the generated module:

```js
import { display } from './display.mjs';
```

Generated modules that only use Node.js built-ins and npm/JavaScript modules have no NAIDE runtime dependency. When generated code uses NAIDE runtime helpers, keep `naider` installed in the host project so its `naider/runtime` import can resolve. The loader includes source maps; `--enable-source-maps` maps runtime stack traces back to `.naide` lines.

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

This generates a broad API starter demonstrating SQLite, AI/LLM integration, auth, CORS, CRUD, WebSocket, SSE, file caching, request validation, background jobs, and more from ~75 lines. Treat it as a starting point: install the generated dependencies, inspect the emitted code, and perform your own security, load, and deployment reviews before production use.

## One syntax, end to end

NAIDE has one source syntax for people and tools. Type inference and concise built-ins reduce ceremony; ordinary keywords keep control flow explicit:

```naide
auto name = "World"

fn greet(str who) -> str:
  ret "Hello, {who}!"

if name:
  log greet(name)
```

New projects, generated examples, editor tooling, and compiler input all use `.naide`. There is no separate symbolic or AI-only form to learn.

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

## Source Maps & Error Remapping

Runtime errors are automatically remapped to source file line numbers:

```
Error in app.naide:12
  10 |   user = UserStore.getById(id)
  11 |   if not user:
>>12 |     throw "not found"
```

The CLI tracks source-to-output line mappings and shows context from your `.naide` file, not the generated JavaScript.

## Native Host Imports

Direct execution can import Node.js built-ins only when each exact module is granted with a repeatable `--node-module` option. JavaScript npm packages must already be declared in the project's `dependencies` or `optionalDependencies` in `package.json` or `nidpackage.json`. These imports execute with the host process's permissions; this is explicit interoperability, not a sandbox. The compiler path remains available for other JavaScript integrations.

## Type Checker

Type-check without running the code or generating JavaScript:

```bash
naide check app.naide
```

Catches type mismatches at compile time:

```
  app.naide:3 ERROR: Type mismatch: cannot assign str to int
  app.naide:7 WARN: Type warning: reassigning int variable 'count' with str
```

The type checker checks supported annotations (`str`, `int`, `num`, `bool`, `list`, `map`), known function argument counts and types, return expressions against explicit annotations, and straightforward assignments. `num` accepts `int` values. `any` and `json` accept all types. Expressions whose types cannot be determined (including many dynamic member accesses) are treated as `any`, so passing `naide check` is useful feedback, **not a proof of program correctness or runtime safety**.

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

## Project Diagnostics

```bash
naide doctor                    # inspect Node.js and installed language tools
naide doctor . --json           # machine-readable report
naide verify                    # validate package manifests and find setup gaps
```

`doctor` checks the local Node.js requirement, available ecosystem tools, package manifests, and NAIDE source files. `verify` parses `package.json`, checks its dependency and script sections, and compiles and type-checks `.naide` files recursively, excluding `.git`, `dist`, `node_modules`, and the root `SPEC.naide` language reference. It is read-only and does not execute package scripts or source code; it is a setup/type-check aid, not a security audit or a guarantee that dependencies resolve or the application behaves correctly. Other ecosystem manifests are detected but are not fully validated. `test` is a separate, explicit command: it detects common native test setups (npm, Cargo, Go, .NET, Maven/Gradle, SwiftPM, Dart, Composer, Bundler, and pytest) and runs their configured test commands. Since project tests are executable code, run this only in a project you trust.

## Native Package Ecosystems

NAIDE can ask the native package manager to install dependencies from several registries:

```bash
naide pkg managers
naide pkg add npm zod@3.24.0
python -m venv .venv
# Activate .venv before installing Python packages
naide pkg add pip requests==2.32.0
naide pkg add cargo serde@1.0.0
naide pkg add go github.com/google/uuid@v1.6.0
naide pkg add dotnet Newtonsoft.Json@13.0.1
naide pkg add composer symfony/console:^7.0
naide pkg add gem rails@7.1.0
naide pkg add dart 'http:^1.2.0'
naide pkg add maven org.slf4j:slf4j-api:2.0.16
naide pkg add conan fmt/11.0.2
```

Supported adapters are npm, PyPI/pip, Cargo, Go modules, NuGet/.NET, Packagist/Composer, RubyGems via Bundler, pub.dev, Maven Central, and Conan. Arguments are passed separately; on Windows, script-based manager shims use a quoted `cmd.exe` wrapper, and arguments containing quotes, percent signs, or line breaks are rejected. npm, pip, Cargo, Go, .NET, Composer, Bundler, and Dart delegate dependency declaration and lockfile updates to their native tools (where that ecosystem supports lockfiles). pip installs into an active/project `.venv`, records its requirement in `requirements.txt`, and records the ecosystem dependency in `naide.pkg.json`; activate a virtual environment before installing. Metadata files are staged before replacement, and failed multi-file updates are rolled back where possible. Every successful `naide pkg add` creates or updates `naide.pkg.json` as NAIDE's cross-ecosystem index, while native project manifests remain authoritative.

This is package-manager interoperability, **not** automatic cross-language linking. A Python, Rust, Java, or other native library cannot be called directly from NAIDE just because it is installed. To use one from a Node.js NAIDE program, expose a deliberate boundary such as a subprocess protocol, HTTP service, or a maintained FFI/WASM adapter. The Ruby adapter uses `bundle add`, so a Gemfile must already exist. Maven downloads to the local cache, and Conan resolves/generates dependency metadata; both still require their respective build-file/toolchain integration before the dependency is usable by an application. SwiftPM, Gradle, and other ecosystems without a tested adapter can still be used through their normal native tools.

`naide.pkg.json` stores NAIDE package metadata and records non-npm additions under `languageDependencies`; the native manager's manifest and lockfile remain authoritative. `naide pkg install` remains the npm convenience command for NAIDE plugins.

## MCP Server

`naide-mcp` communicates over stdio using the modern stateless [MCP protocol](https://modelcontextprotocol.io/specification/2026-07-28) (`2026-07-28`): clients send protocol version, identity, and capabilities in each request's `_meta`; the server supports `server/discover` and does not implement the older `initialize` handshake. It provides compilation/generation, non-executing `naide_check` diagnostics, project verification and tests, package ecosystem guidance, and the language specification. Its `naide_search` tool searches the package's first-party specification, documentation, examples, compiler/runtime source, and MCP/LSP/VS Code implementation, returning file and line evidence; it does not read arbitrary workspace files or dependencies. Use it before concluding a feature is unsupported, and distinguish language specification from implementation evidence and target parity. Its discovery instructions enforce a NAIDE-only application-source workflow: application behavior belongs in `.naide`; the agent must not author JavaScript/TypeScript or inline JavaScript unless the user explicitly approves it. When NAIDE cannot express a requested capability, the agent must explain the specific limitation and ask before switching to JS/TS rather than making that decision for the user. Browser support includes static HTML generation, the `naide:browser` module for common DOM/events/Canvas/animation APIs, and native browser Web API access; generated JavaScript is build output, not authored source. This is a practical browser layer, not a complete typed DOM or a promise that Node-only npm packages work in browsers. When a project uses `nidpackage.json`, agents must not create a competing `package.json` or `package-lock.json` unless explicitly requested or a verified host requirement demands it. Call `naide_context` or read `naide://ai-guide` for NAIDE idioms, feature areas, target limitations, and project conventions; use the `naide_first` / `naide_coding_ja` prompts for task-specific guidance. The `naide_hosted_manifest` tool creates a `nidpackage.json` for hosted Node.js apps; `naide_mws_discord_template` returns exactly `discord-bot.naide` and `nidpackage.json`, with additional npm libraries accepted through `libraries`. These use `node_modules/naider/bin/naide-host.js` as the host runner and require the host to install dependencies from `nidpackage.json` and launch `main` (or select the runner as startup file). Read-only knowledge resources include `naide://spec`, `naide://ai-guide`, `naide://knowledge`, and `naide://package-ecosystems`; `naide://project` reports project diagnostics.

For VS Code, after installing `naider` in a location on `PATH`, add this to `.vscode/mcp.json`:

```json
{
  "servers": {
    "naide": {
      "type": "stdio",
      "command": "naide-mcp",
      "args": []
    }
  }
}
```

The MCP server's `naide_run` and `naide_test` tools execute code with the server process's operating-system permissions. Connect it only to clients and workspaces whose code you trust.

## NAIDE vs Python — Side by Side

**Read a file, process lines, write result:**

```python
# Python (8 lines)
with open("input.txt") as f:
    lines = f.read().strip().split("\n")
upper_lines = [line.upper() for line in lines]
result = "\n".join(upper_lines)
with open("output.txt", "w") as f:
    f.write(result)
print(f"Processed {len(upper_lines)} lines")
```

```python
# NAIDE (4 lines)
list lines = split(trim(read("input.txt")), "\n")
list upper_lines = [upper(line) for line in lines]
write("output.txt", join(upper_lines, "\n"))
print "Processed {len(upper_lines)} lines"
```

**Sort, deduplicate, and swap:**

```python
# Python (5 lines)
items = [3, 1, 4, 1, 5]
items = sorted(set(items))
a, b = 1, 2
a, b = b, a
print(f"a={a}, b={b}")
```

```python
# NAIDE (5 lines)
list items = unique(sort([3, 1, 4, 1, 5]))
mut int a = 1
mut int b = 2
swap a, b
print "a={a}, b={b}"
```

**Simple API server:**

```python
# Python + Flask (12 lines)
from flask import Flask, jsonify
app = Flask(__name__)

@app.route("/")
def index():
    return jsonify({"message": "Hello"})

@app.route("/health")
def health():
    return jsonify({"status": "ok"})

app.run(port=3000)
```

```python
# NAIDE (5 lines)
server app port 3000:
  get "/":
    ret {message: "Hello"}
  get "/health":
    ret {status: "ok"}
```

## Why NAIDE?

An approachable language should reduce incidental complexity without obscuring program behavior:

1. **One syntax** — no human-only and machine-only dialects to keep in sync
2. **Direct feedback** — type checks, tests, and source-mapped diagnostics help find mistakes
3. **Useful defaults** — common application patterns need less setup
4. **Escape hatches** — generated code and ordinary packages remain inspectable and usable

NAIDE aims to make one readable source representation work well for both people and AI tools. Generated code and compiler diagnostics remain inspectable rather than treating the source as an opaque prompt format.

## License

MIT
