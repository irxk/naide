import { describe, it } from 'node:test';
import assert from 'node:assert';
import { compile, transpile, preprocess } from '../src/index.js';
import * as lexerMod from '../src/lexer.js';

describe('NAIDE v1', () => {
  it('compiles variables', () => {
    const js = transpile('str name = "hello"');
    assert.ok(js.includes('const name = "hello"'));
  });

  it('compiles mutable variables', () => {
    const js = transpile('mut int counter = 0');
    assert.ok(js.includes('let counter = 0'));
  });

  it('compiles functions', () => {
    const js = transpile('fn add(int a, int b) -> int:\n  ret a + b');
    assert.ok(js.includes('function add(a, b)'));
    assert.ok(js.includes('return a + b'));
  });

  it('compiles async functions', () => {
    const js = transpile('fn.async load(str url) -> any:\n  ret await fetch(url)');
    assert.ok(js.includes('async function load(url)'));
  });

  it('compiles if/elif/else', () => {
    const js = transpile('if x > 1:\n  log "a"\nelif x > 0:\n  log "b"\nelse:\n  log "c"');
    assert.ok(js.includes('if'));
    assert.ok(js.includes('else if'));
    assert.ok(js.includes('else'));
  });

  it('compiles each loop', () => {
    const js = transpile('each item in items:\n  log item');
    assert.ok(js.includes('for (const item of items)'));
  });

  it('compiles for range', () => {
    const js = transpile('for i in 0..10:\n  log i');
    assert.ok(js.includes('for (let i = 0; i < 10; i++)'));
  });

  it('compiles try/fail', () => {
    const js = transpile('try:\n  log "ok"\nfail e:\n  log e');
    assert.ok(js.includes('try {'));
    assert.ok(js.includes('catch (e)'));
  });

  it('compiles string interpolation', () => {
    const js = transpile('str msg = "hello {name}"');
    assert.ok(js.includes('`hello ${name}`'));
  });

  it('compiles model', () => {
    const js = transpile('model User:\n  str name\n  int age = 0');
    assert.ok(js.includes('class User'));
    assert.ok(js.includes('constructor(name, age = 0)'));
  });

  it('compiles match', () => {
    const js = transpile('match x:\n  1: log "one"\n  _: log "other"');
    assert.ok(js.includes('switch (x)'));
    assert.ok(js.includes('case 1'));
    assert.ok(js.includes('default'));
  });

  it('compiles pipe operator', () => {
    const js = transpile('list r = data\n  |> filter((x) => x > 0)\n  |> map((x) => x * 2)');
    assert.ok(js.includes('.filter('));
    assert.ok(js.includes('.map('));
  });
});

describe('NAIDE-X preprocessor', () => {
  it('converts typed variables', () => {
    const out = preprocess('s:name="hello"');
    assert.ok(out.includes('str name = "hello"'));
  });

  it('converts mutable variables', () => {
    const out = preprocess('~i:counter=0');
    assert.ok(out.includes('mut int counter = 0'));
  });

  it('converts functions', () => {
    const out = preprocess('f add(i:a,i:b)i');
    assert.ok(out.includes('fn add(int a, int b) -> int:'));
  });

  it('converts async functions', () => {
    const out = preprocess('~f load(s:url)a');
    assert.ok(out.includes('fn.async load(str url) -> any:'));
  });

  it('converts return', () => {
    const out = preprocess('  >result');
    assert.ok(out.includes('ret result'));
  });

  it('converts if/elif/else', () => {
    const out = preprocess('?x>1\n|x>0\n:');
    assert.ok(out.includes('if x>1:'));
    assert.ok(out.includes('elif x>0:'));
    assert.ok(out.includes('else:'));
  });

  it('converts each loop', () => {
    const out = preprocess('@item<items');
    assert.ok(out.includes('each item in items:'));
  });

  it('converts for range', () => {
    const out = preprocess('@i<0..10');
    assert.ok(out.includes('for i in 0..10:'));
  });

  it('converts while', () => {
    const out = preprocess('*active');
    assert.ok(out.includes('while active:'));
  });

  it('converts try/catch', () => {
    const out = preprocess('!\n!!e');
    assert.ok(out.includes('try:'));
    assert.ok(out.includes('fail e:'));
  });

  it('converts server', () => {
    const out = preprocess('$app:3000');
    assert.ok(out.includes('server app port 3000:'));
  });

  it('converts routes', () => {
    const out = preprocess('G"/users"');
    assert.ok(out.includes('get "/users":'));
  });

  it('converts model', () => {
    const out = preprocess('^User');
    assert.ok(out.includes('model User:'));
  });

  it('converts model with inheritance', () => {
    const out = preprocess('^Dog<Animal');
    assert.ok(out.includes('model Dog extends Animal:'));
  });

  it('converts import', () => {
    const out = preprocess('<express');
    assert.ok(out.includes('use express'));
  });

  it('converts destructured import', () => {
    const out = preprocess('<{readFile}"fs/promises"');
    assert.ok(out.includes('use {readFile} from "fs/promises"'));
  });

  it('converts comments', () => {
    const out = preprocess('-- hello');
    assert.ok(out.includes('# hello'));
  });

  it('converts await', () => {
    const out = preprocess('  a:data=~fetch(url)');
    assert.ok(out.includes('await fetch(url)'));
  });

  it('converts ret.redirect shorthand', () => {
    const out = preprocess('  >.r "/login"');
    assert.ok(out.includes('ret.redirect "/login"'));
  });

  it('converts ret.html shorthand', () => {
    const out = preprocess('  >.h "<h1>Hi</h1>"');
    assert.ok(out.includes('ret.html "<h1>Hi</h1>"'));
  });

  it('converts ret.text shorthand', () => {
    const out = preprocess('  >.t "pong"');
    assert.ok(out.includes('ret.text "pong"'));
  });
});

describe('NAIDE high-level features', () => {
  it('compiles schema declaration', () => {
    const src = 'schema User:\n  id auto\n  name str required min(2) max(50)\n  email str required email\n  role str default("user")';
    const js = transpile(src);
    assert.ok(js.includes('createSchema'));
    assert.ok(js.includes('createStore'));
    assert.ok(js.includes("UserSchema"));
    assert.ok(js.includes("UserStore"));
    assert.ok(js.includes("type: 'id'"));
    assert.ok(js.includes("type: 'string'"));
    assert.ok(js.includes("required: true"));
    assert.ok(js.includes("email: true"));
    assert.ok(js.includes("min: 2"));
    assert.ok(js.includes("max: 50"));
    assert.ok(js.includes('default: "user"'));
  });

  it('compiles schema with enum type', () => {
    const src = 'schema Task:\n  status enum("todo", "done") required';
    const js = transpile(src);
    assert.ok(js.includes("type: 'enum'"));
    assert.ok(js.includes("values:"));
    assert.ok(js.includes('"todo"'));
    assert.ok(js.includes('"done"'));
  });

  it('compiles env declaration', () => {
    const src = 'env:\n  PORT int default(3000)\n  SECRET str required';
    const js = transpile(src);
    assert.ok(js.includes('loadEnv'));
    assert.ok(js.includes('PORT'));
    assert.ok(js.includes('SECRET'));
    assert.ok(js.includes("type: 'integer'"));
    assert.ok(js.includes('default: 3000'));
    assert.ok(js.includes('required: true'));
  });

  it('compiles crud inside server', () => {
    const src = 'schema User:\n  id auto\n  name str required\n\nserver app port 3000:\n  crud "/api/users" User';
    const js = transpile(src);
    assert.ok(js.includes('registerCrud'));
    assert.ok(js.includes('UserSchema'));
    assert.ok(js.includes('UserStore'));
    assert.ok(js.includes('"/api/users"'));
  });

  it('compiles auth with protect/public', () => {
    const src = 'server app port 3000:\n  auth SECRET:\n    protect "/api/*"\n    public "/api/auth/*"';
    const js = transpile(src);
    assert.ok(js.includes('jwtAuth'));
    assert.ok(js.includes('SECRET'));
    assert.ok(js.includes('"/api/(.*)"'));
    assert.ok(js.includes('public:'));
    assert.ok(js.includes('__authSecret'));
  });

  it('compiles cors', () => {
    const src = 'server app port 3000:\n  cors "*"';
    const js = transpile(src);
    assert.ok(js.includes('corsMiddleware'));
  });

  it('compiles rate limit', () => {
    const src = 'server app port 3000:\n  limit "/api/*" 100 "1m"';
    const js = transpile(src);
    assert.ok(js.includes('rateLimit'));
    assert.ok(js.includes('100'));
    assert.ok(js.includes('"1m"'));
  });

  it('compiles every (cron)', () => {
    const src = 'every "5m":\n  log "tick"';
    const js = transpile(src);
    assert.ok(js.includes('scheduleEvery'));
    assert.ok(js.includes('"5m"'));
    assert.ok(js.includes('console.log'));
  });

  it('compiles watch event', () => {
    const src = 'watch User.create (event):\n  log event';
    const js = transpile(src);
    assert.ok(js.includes('__eventBus'));
    assert.ok(js.includes("'User.create'"));
    assert.ok(js.includes('(event) =>'));
  });

  it('compiles db directive with file store', () => {
    const src = 'db "data/"\n\nschema User:\n  id auto\n  name str required';
    const js = transpile(src);
    assert.ok(js.includes('createFileStore'));
    assert.ok(js.includes("'data/User.json'"));
    assert.ok(!js.includes('createStore('), 'should not use in-memory createStore');
  });

  it('compiles static file serving in server', () => {
    const src = 'server app port 3000:\n  static "/public"';
    const js = transpile(src);
    assert.ok(js.includes('express.static'));
    assert.ok(js.includes('"public"'));
  });

  it('compiles ws (WebSocket) in server', () => {
    const src = 'server app port 3000:\n  ws "/chat":\n    on "message" (data):\n      log data\n    on "connect":\n      log "connected"';
    const js = transpile(src);
    assert.ok(js.includes('WebSocketServer'));
    assert.ok(js.includes('__server'));
    assert.ok(js.includes('__wss'));
    assert.ok(js.includes("'message'"));
    assert.ok(js.includes('send'));
    assert.ok(js.includes('broadcast'));
    assert.ok(js.includes('JSON.parse'));
  });

  it('compiles hash() auto-import', () => {
    const src = 'str h = hash("password")';
    const js = transpile(src);
    assert.ok(js.includes("import { hash }"));
    assert.ok(js.includes('hash("password")'));
  });

  it('compiles verify() auto-import', () => {
    const src = 'str ok = verify("pass", stored)';
    const js = transpile(src);
    assert.ok(js.includes('verify'));
    assert.ok(js.includes("import"));
  });

  it('compiles uuid() auto-import', () => {
    const src = 'str id = uuid()';
    const js = transpile(src);
    assert.ok(js.includes("import { uuid }"));
    assert.ok(js.includes('uuid()'));
  });

  it('compiles sign() with auth secret', () => {
    const src = [
      'server app port 3000:',
      '  auth SECRET:',
      '    protect "/api/*"',
      '  post "/api/auth/login" (req, res):',
      '    token = sign({id: 1})',
      '    ret {token}',
    ].join('\n');
    const js = transpile(src);
    assert.ok(js.includes('jwtSign'));
    assert.ok(js.includes('__authSecret'));
  });

  it('compiles auth.sign() with auth secret', () => {
    const src = [
      'server app port 3000:',
      '  auth SECRET:',
      '    protect "/api/*"',
      '  post "/api/auth/login" (req, res):',
      '    token = auth.sign({id: 1})',
      '    ret {token}',
    ].join('\n');
    const js = transpile(src);
    assert.ok(js.includes('jwtSign'));
    assert.ok(js.includes('__authSecret'));
  });

  it('compiles ret.redirect', () => {
    const src = 'server app port 3000:\n  get "/old":\n    ret.redirect "/new"';
    const js = transpile(src);
    assert.ok(js.includes('res.redirect'));
  });

  it('compiles ret.html', () => {
    const src = 'server app port 3000:\n  get "/":\n    ret.html "<h1>Hello</h1>"';
    const js = transpile(src);
    assert.ok(js.includes("res.type('html').send"));
  });

  it('compiles ret.text', () => {
    const src = 'server app port 3000:\n  get "/ping":\n    ret.text "pong"';
    const js = transpile(src);
    assert.ok(js.includes("res.type('text').send"));
  });

  it('compiles api auto-import', () => {
    const src = 'fn.async getData() -> any:\n  any result = await api.get("https://api.example.com/data")\n  ret result';
    const js = transpile(src);
    assert.ok(js.includes("import { api }"));
    assert.ok(js.includes('api.get("https://api.example.com/data")'));
  });

  it('compiles error handler in server', () => {
    const src = [
      'server app port 3000:',
      '  get "/":', '    ret {ok: true}',
      '  error (err, req, res):',
      '    log.error err.message',
      '    ret.status 500 {error: "Internal error"}',
    ].join('\n');
    const js = transpile(src);
    assert.ok(js.includes('(err, req, res, next)'));
    assert.ok(js.includes('console.error'));
  });

  it('compiles route group in server', () => {
    const src = [
      'server app port 3000:',
      '  group "/api/v1":',
      '    get "/users":', '      ret []',
      '    post "/users" (req, res):', '      ret req.body',
    ].join('\n');
    const js = transpile(src);
    assert.ok(js.includes('express.Router()'));
    assert.ok(js.includes('app.use("/api/v1"'));
  });

  it('compiles cookie middleware', () => {
    const src = 'server app port 3000:\n  cookie\n  get "/":\n    ret {ok: true}';
    const js = transpile(src);
    assert.ok(js.includes('cookieParser'));
    assert.ok(js.includes("import {"));
  });

  it('compiles patch route in server', () => {
    const src = 'server app port 3000:\n  patch "/api/users/:id" (req, res):\n    ret {updated: true}';
    const js = transpile(src);
    assert.ok(js.includes('app.patch'));
    assert.ok(js.includes('"/api/users/:id"'));
  });

  it('compiles upload in server', () => {
    const src = 'server app port 3000:\n  upload "/api/upload" "avatar" (req, res):\n    ret {file: req.file}';
    const js = transpile(src);
    assert.ok(js.includes('uploadMiddleware'));
    assert.ok(js.includes('app.post'));
    assert.ok(js.includes('"avatar"'));
  });

  it('compiles session in server', () => {
    const src = 'server app port 3000:\n  session "my-secret"\n  get "/":\n    ret {ok: true}';
    const js = transpile(src);
    assert.ok(js.includes('sessionMiddleware'));
    assert.ok(js.includes('"my-secret"'));
  });

  it('compiles view in server', () => {
    const src = 'server app port 3000:\n  view "./views"\n  get "/":\n    ret.render "home" {title: "Hi"}';
    const js = transpile(src);
    assert.ok(js.includes('createRenderer'));
    assert.ok(js.includes('"./views"'));
    assert.ok(js.includes('__render'));
    assert.ok(js.includes('"home"'));
  });

  it('compiles sse in server', () => {
    const src = 'server app port 3000:\n  sse "/events"\n  post "/api/notify" (req, res):\n    sse.broadcast req.body\n    ret {ok: true}';
    const js = transpile(src);
    assert.ok(js.includes('createSseManager'));
    assert.ok(js.includes('sse.handler()'));
    assert.ok(js.includes('sse.broadcast'));
  });

  it('compiles cache in server', () => {
    const src = 'server app port 3000:\n  cache "/api/*" "5m"\n  get "/api/data":\n    ret {data: 1}';
    const js = transpile(src);
    assert.ok(js.includes('cacheMiddleware'));
    assert.ok(js.includes('"/api/(.*)"'));
    assert.ok(js.includes('"5m"'));
  });

  it('compiles middleware reference in server', () => {
    const src = 'fn logger(req, res, next):\n  log req.method\n  next()\n\nserver app port 3000:\n  mid logger\n  get "/":\n    ret {ok: true}';
    const js = transpile(src);
    assert.ok(js.includes('function logger'));
    assert.ok(js.includes('app.use(logger)'));
  });

  it('compiles middleware reference with path', () => {
    const src = 'fn checkAuth(req, res, next):\n  next()\n\nserver app port 3000:\n  mid checkAuth "/api"\n  get "/":\n    ret {ok: true}';
    const js = transpile(src);
    assert.ok(js.includes('app.use("/api", checkAuth)'));
  });

  it('allows keywords as function names', () => {
    const src = 'fn cache():\n  ret 1';
    const js = transpile(src);
    assert.ok(js.includes('function cache()'));
  });

  it('compiles full app with all features', () => {
    const src = [
      'db "data/"',
      '',
      'env:',
      '  PORT int default(3000)',
      '  JWT_SECRET str required',
      '',
      'schema User:',
      '  id auto',
      '  name str required',
      '  email str required email',
      '',
      'server app port PORT:',
      '  cors "*"',
      '  auth JWT_SECRET:',
      '    protect "/api/*"',
      '    public "/api/auth/*"',
      '  limit "/api/*" 100 "1m"',
      '  static "/public"',
      '  crud "/api/users" User',
      '  post "/api/auth/register" (req, res):',
      '    str hashed = hash(req.body.password)',
      '    ret {ok: true}',
      '  get "/":',
      '    ret.html "<h1>Welcome</h1>"',
      '',
      'watch User.create (event):',
      '  log "new user: {event.data.name}"',
    ].join('\n');
    const js = transpile(src);
    assert.ok(js.includes('loadEnv'));
    assert.ok(js.includes('createSchema'));
    assert.ok(js.includes('createFileStore'));
    assert.ok(js.includes('registerCrud'));
    assert.ok(js.includes('jwtAuth'));
    assert.ok(js.includes('corsMiddleware'));
    assert.ok(js.includes('rateLimit'));
    assert.ok(js.includes('express'));
    assert.ok(js.includes('hash'));
    assert.ok(js.includes('express.static'));
    assert.ok(js.includes("res.type('html').send"));
    assert.ok(js.includes('__eventBus'));
    assert.ok(js.includes("'data/User.json'"));
    assert.ok(js.includes('urlencoded'));
  });

  it('compiles validate in server', () => {
    const src = [
      'schema User:', '  id auto', '  name str required',
      '', 'server app port 3000:',
      '  validate "/api/users" User',
      '  post "/api/users" (req, res):', '    ret req.body',
    ].join('\n');
    const js = transpile(src);
    assert.ok(js.includes('validateMiddleware'));
    assert.ok(js.includes('UserSchema'));
    assert.ok(js.includes('app.use("/api/users"'));
  });

  it('compiles test and assert', () => {
    const src = [
      'test "math":', '  assert 1 + 1 == 2', '  assert 2 * 3 == 6',
    ].join('\n');
    const js = transpile(src);
    assert.ok(js.includes("import { test } from 'node:test'"));
    assert.ok(js.includes("import assert from 'node:assert/strict'"));
    assert.ok(js.includes("test(\"math\""));
    assert.ok(js.includes('assert.strictEqual'));
  });

  it('compiles assert with different operators', () => {
    const src = [
      'test "ops":', '  assert x != y', '  assert x > 0',
    ].join('\n');
    const js = transpile(src);
    assert.ok(js.includes('assert.notStrictEqual'));
    assert.ok(js.includes('assert.ok'));
  });

  it('compiles queue with jobs', () => {
    const src = [
      'queue jobs:', '  job "sendEmail" (data):', '    log data.to',
      '  job "resize" (data):', '    log data.path',
    ].join('\n');
    const js = transpile(src);
    assert.ok(js.includes('createQueue'));
    assert.ok(js.includes('const jobs = createQueue()'));
    assert.ok(js.includes('jobs.register("sendEmail"'));
    assert.ok(js.includes('jobs.register("resize"'));
  });

  it('compiles openapi in server', () => {
    const src = [
      'schema User:', '  id auto', '  name str required',
      '', 'server app port 3000:',
      '  openapi "/docs"',
      '  get "/":', '    ret {ok: true}',
    ].join('\n');
    const js = transpile(src);
    assert.ok(js.includes('buildOpenApiSpec'));
    assert.ok(js.includes('app.get("/docs"'));
    assert.ok(js.includes('UserSchema'));
  });

  it('compiles typeof operator', () => {
    const js = transpile('if typeof x == "string":\n  log "is string"');
    assert.ok(js.includes('typeof x'));
    assert.ok(js.includes('=== "string"'));
  });

  it('compiles typeof in expression', () => {
    const js = transpile('str t = typeof data');
    assert.ok(js.includes('typeof data'));
  });

  it('compiles instanceof operator', () => {
    const js = transpile('if err instanceof TypeError:\n  log "type error"');
    assert.ok(js.includes('instanceof TypeError'));
  });

  it('compiles try/fail/ensure', () => {
    const src = [
      'try:', '  log "start"',
      'fail e:', '  log e.message',
      'ensure:', '  log "cleanup"',
    ].join('\n');
    const js = transpile(src);
    assert.ok(js.includes('try {'));
    assert.ok(js.includes('catch (e)'));
    assert.ok(js.includes('finally {'));
    assert.ok(js.includes('console.log("cleanup")'));
  });

  it('compiles try/ensure without fail', () => {
    const src = [
      'try:', '  log "risky"',
      'ensure:', '  log "always"',
    ].join('\n');
    const js = transpile(src);
    assert.ok(js.includes('try {'));
    assert.ok(js.includes('finally {'));
    assert.ok(!js.includes('catch'));
  });

  it('compiles route middleware', () => {
    const src = [
      'server app port 3000:',
      '  get "/admin" [authCheck] (req, res):',
      '    ret {admin: true}',
    ].join('\n');
    const js = transpile(src);
    assert.ok(js.includes('app.get("/admin", authCheck,'));
  });

  it('compiles route with multiple middleware', () => {
    const src = [
      'server app port 3000:',
      '  post "/api/data" [auth, logger] (req, res):',
      '    ret req.body',
    ].join('\n');
    const js = transpile(src);
    assert.ok(js.includes('auth, logger,'));
  });

  it('compiles ret.redirect with status code', () => {
    const src = [
      'server app port 3000:',
      '  get "/old":',
      '    ret.redirect 301 "/new"',
    ].join('\n');
    const js = transpile(src);
    assert.ok(js.includes('res.redirect(301, "/new")'));
  });

  it('compiles ret.download', () => {
    const src = [
      'server app port 3000:',
      '  get "/file":',
      '    ret.download "/path/to/file.zip"',
    ].join('\n');
    const js = transpile(src);
    assert.ok(js.includes('res.download("/path/to/file.zip")'));
  });

  it('compiles ret.download with filename', () => {
    const src = [
      'server app port 3000:',
      '  get "/file":',
      '    ret.download "/path/to/file.zip" "custom.zip"',
    ].join('\n');
    const js = transpile(src);
    assert.ok(js.includes('res.download'));
    assert.ok(js.includes('"custom.zip"'));
  });
});

describe('NAIDE-X full pipeline', () => {
  it('compiles .nx to JS', () => {
    const source = 's:name="World"\nf greet(s:who)s\n  >"Hello, {who}!"\nlog greet(name)';
    const js = transpile(source, { mode: 'x' });
    assert.ok(js.includes('const name = "World"'));
    assert.ok(js.includes('function greet(who)'));
    assert.ok(js.includes('return `Hello, ${who}!`'));
    assert.ok(js.includes('console.log(greet(name))'));
  });

  it('compiles async .nx to JS', () => {
    const source = '~f load(s:url)a\n  a:res=~fetch(url)\n  >~res.json()';
    const js = transpile(source, { mode: 'x' });
    assert.ok(js.includes('async function load(url)'));
    assert.ok(js.includes('await fetch(url)'));
  });

  it('compiles server .nx to JS', () => {
    const source = '$app:3000\n  G"/"\n    >{msg:"hi"}';
    const js = transpile(source, { mode: 'x' });
    assert.ok(js.includes('express'));
    assert.ok(js.includes("app.get"));
    assert.ok(js.includes('listen(3000'));
  });

  it('compiles .nx with ret.redirect shorthand', () => {
    const source = '$app:3000\n  G"/old"\n    >.r "/new"';
    const js = transpile(source, { mode: 'x' });
    assert.ok(js.includes('res.redirect'));
  });

  it('compiles .nx PATCH route', () => {
    const source = '$app:3000\n  X"/api/users/:id"(req,res)\n    >{updated:true}';
    const js = transpile(source, { mode: 'x' });
    assert.ok(js.includes('app.patch'));
  });

  it('compiles .nx ret.render shorthand', () => {
    const source = '$app:3000\n  G"/"\n    >.v "home" {title: "Hi"}';
    const js = transpile(source, { mode: 'x' });
    assert.ok(js.includes('__render'));
    assert.ok(js.includes('"home"'));
  });

  it('compiles .nx log.i and log.d shorthands', () => {
    const source = 'log.i"info msg"\nlog.d"debug msg"';
    const js = transpile(source, { mode: 'x' });
    assert.ok(js.includes('console.info("info msg")'));
    assert.ok(js.includes('console.debug("debug msg")'));
  });

  it('compiles .nx !!! ensure shorthand', () => {
    const source = '!\n  log"start"\n!!e\n  log.e e.message\n!!!\n  log"cleanup"';
    const js = transpile(source, { mode: 'x' });
    assert.ok(js.includes('try {'));
    assert.ok(js.includes('catch (e)'));
    assert.ok(js.includes('finally {'));
  });

  it('compiles .nx ret.download shorthand', () => {
    const source = '$app:3000\n  G"/dl"\n    >.d "/file.zip"';
    const js = transpile(source, { mode: 'x' });
    assert.ok(js.includes('res.download'));
  });
});

describe('AI integration', () => {
  it('auto-imports ai on ai.ask()', () => {
    const src = 'fn.async main():\n  any answer = await ai.ask("What is 2+2?")\n  log answer';
    const js = transpile(src);
    assert.ok(js.includes("import { ai }"));
    assert.ok(js.includes('ai.ask("What is 2+2?")'));
  });

  it('auto-imports ai on ai.json()', () => {
    const src = 'fn.async extract():\n  any data = await ai.json("extract name", {name: "str"})\n  ret data';
    const js = transpile(src);
    assert.ok(js.includes("import { ai }"));
    assert.ok(js.includes('ai.json('));
  });

  it('auto-imports ai on ai.chat()', () => {
    const src = 'fn.async chat():\n  any reply = await ai.chat([{role: "user", content: "hi"}])\n  ret reply';
    const js = transpile(src);
    assert.ok(js.includes('ai'));
    assert.ok(js.includes('ai.chat('));
  });

  it('ai.ask in server route', () => {
    const src = [
      'server app port 3000:',
      '  post "/api/ai" (req, res):',
      '    any answer = await ai.ask(req.body.prompt)',
      '    ret {answer}',
    ].join('\n');
    const js = transpile(src);
    assert.ok(js.includes("import { ai }"));
    assert.ok(js.includes('ai.ask(req.body.prompt)'));
  });

  it('ai object has ask, json, chat methods', async () => {
    const { ai } = await import('../src/runtime.js');
    assert.ok(typeof ai.ask === 'function');
    assert.ok(typeof ai.json === 'function');
    assert.ok(typeof ai.chat === 'function');
  });
});

describe('SQL database support', () => {
  it('compiles db.sql sqlite', () => {
    const src = 'db.sql "sqlite" "app.db"';
    const js = transpile(src);
    assert.ok(js.includes("import Database from 'better-sqlite3'"));
    assert.ok(js.includes('new Database("app.db")'));
    assert.ok(js.includes("journal_mode = WAL"));
  });

  it('compiles db.sql sqlite with default path', () => {
    const src = 'db.sql "sqlite"';
    const js = transpile(src);
    assert.ok(js.includes("import Database from 'better-sqlite3'"));
    assert.ok(js.includes('new Database("data.db")'));
  });

  it('compiles db.sql postgres', () => {
    const src = 'db.sql "postgres" "postgresql://localhost/mydb"';
    const js = transpile(src);
    assert.ok(js.includes("import pg from 'pg'"));
    assert.ok(js.includes('pg.Pool'));
    assert.ok(js.includes('postgresql://localhost/mydb'));
  });

  it('schema uses SQLite store with db.sql', () => {
    const src = [
      'db.sql "sqlite" "test.db"',
      '',
      'schema User:',
      '  id auto',
      '  name str required',
      '  email str required email',
    ].join('\n');
    const js = transpile(src);
    assert.ok(js.includes("import Database from 'better-sqlite3'"));
    assert.ok(js.includes('createSqliteStore'));
    assert.ok(js.includes("createSqliteStore(__db, 'User', UserSchema)"));
    assert.ok(!js.includes('createFileStore'));
    assert.ok(!js.includes('createStore('));
  });

  it('db.sql + schema + server compiles', () => {
    const src = [
      'db.sql "sqlite" "app.db"',
      '',
      'schema Todo:',
      '  id auto',
      '  title str required',
      '  done bool default(false)',
      '',
      'server app port 3000:',
      '  crud "/api/todos" Todo',
      '  get "/":', '    ret.html "<h1>Todo</h1>"',
    ].join('\n');
    const js = transpile(src);
    assert.ok(js.includes('better-sqlite3'));
    assert.ok(js.includes('createSqliteStore'));
    assert.ok(js.includes('registerCrud'));
    assert.ok(js.includes('express'));
  });

  it('createSqliteStore is exported from runtime', async () => {
    const { createSqliteStore } = await import('../src/runtime.js');
    assert.ok(typeof createSqliteStore === 'function');
  });
});

describe('AI streaming & embeddings', () => {
  it('ai.stream is exported from runtime', async () => {
    const { ai } = await import('../src/runtime.js');
    assert.ok(typeof ai.stream === 'function');
  });

  it('ai.embed is exported from runtime', async () => {
    const { ai } = await import('../src/runtime.js');
    assert.ok(typeof ai.embed === 'function');
  });

  it('ai.similarity computes cosine similarity', async () => {
    const { ai } = await import('../src/runtime.js');
    const a = [1, 0, 0];
    const b = [1, 0, 0];
    assert.strictEqual(ai.similarity(a, b), 1);
    const c = [0, 1, 0];
    const sim = ai.similarity(a, c);
    assert.ok(sim < 0.01);
  });

  it('auto-imports ai on ai.stream()', () => {
    const js = transpile('fn.async main():\n  any s = await ai.stream("hello")');
    assert.ok(js.includes("import { ai } from"));
  });

  it('auto-imports ai on ai.embed()', () => {
    const js = transpile('fn.async main():\n  any v = await ai.embed("hello")');
    assert.ok(js.includes("import { ai } from"));
  });
});

describe('Vector store', () => {
  it('createVectorStore is exported from runtime', async () => {
    const { createVectorStore } = await import('../src/runtime.js');
    assert.ok(typeof createVectorStore === 'function');
  });

  it('vector store add and search', async () => {
    const { createVectorStore, ai } = await import('../src/runtime.js');
    const store = createVectorStore();
    store.add('a', [1, 0, 0], { text: 'hello' });
    store.add('b', [0, 1, 0], { text: 'world' });
    store.add('c', [0.9, 0.1, 0], { text: 'hi' });
    assert.strictEqual(store.size, 3);
    const results = store.search([1, 0, 0], 2);
    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0].id, 'a');
    assert.strictEqual(results[1].id, 'c');
  });

  it('vector store remove and clear', async () => {
    const { createVectorStore } = await import('../src/runtime.js');
    const store = createVectorStore();
    store.add('x', [1, 0]);
    assert.strictEqual(store.size, 1);
    store.remove('x');
    assert.strictEqual(store.size, 0);
    store.add('y', [0, 1]);
    store.clear();
    assert.strictEqual(store.size, 0);
  });
});

describe('Prompt templates', () => {
  it('compiles prompt declaration', () => {
    const src = 'prompt summarize:\n  "Summarize the following text:"\n  "{text}"';
    const js = transpile(src);
    assert.ok(js.includes('createPrompt'));
    assert.ok(js.includes('const summarize = createPrompt('));
  });

  it('compiles prompt with defaults', () => {
    const src = 'prompt translate {lang: "ja"}:\n  "Translate to {lang}: {text}"';
    const js = transpile(src);
    assert.ok(js.includes('createPrompt'));
    assert.ok(js.includes('{ lang: "ja" }'));
  });

  it('createPrompt works at runtime', async () => {
    const { createPrompt } = await import('../src/runtime.js');
    const p = createPrompt('Hello {name}, welcome to {place}', { place: 'NAIDE' });
    assert.strictEqual(p({ name: 'Alice' }), 'Hello Alice, welcome to NAIDE');
    assert.strictEqual(p({ name: 'Bob', place: 'Tokyo' }), 'Hello Bob, welcome to Tokyo');
  });

  it('prompt used with ai.ask in server', () => {
    const src = [
      'prompt summarize:',
      '  "Summarize: {text}"',
      '',
      'server app port 3000:',
      '  post "/api/summarize" (req, res):',
      '    str p = summarize({text: req.body.text})',
      '    str answer = await ai.ask(p)',
      '    ret {answer}',
    ].join('\n');
    const js = transpile(src);
    assert.ok(js.includes('createPrompt'));
    assert.ok(js.includes('ai'));
    assert.ok(js.includes('const summarize'));
  });
});

describe('Deploy command', () => {
  it('naide deploy is in help text', async () => {
    const { readFileSync } = await import('fs');
    const cli = readFileSync('bin/naide.js', 'utf-8');
    assert.ok(cli.includes('naide deploy'));
    assert.ok(cli.includes('Dockerfile'));
  });
});

describe('Inter-file imports', () => {
  it('rewrites .naide imports to .mjs', () => {
    const src = 'use {handler} from "./routes.naide"';
    const js = transpile(src);
    assert.ok(js.includes('./routes.mjs'));
    assert.ok(!js.includes('.naide'));
  });

  it('rewrites .nx imports to .mjs', () => {
    const src = 'use utils from "./helpers.nx"';
    const js = transpile(src);
    assert.ok(js.includes('./helpers.mjs'));
    assert.ok(!js.includes('.nx'));
  });

  it('does not rewrite non-naide imports', () => {
    const src = 'use express';
    const js = transpile(src);
    assert.ok(js.includes("'express'"));
  });
});

describe('Parser stability', () => {
  it('ignores semicolons (JS habit)', () => {
    const js = transpile('str x = 1;\nstr y = 2;');
    assert.ok(js.includes('const x = 1'));
    assert.ok(js.includes('const y = 2'));
  });

  it('handles empty lines between blocks', () => {
    const js = transpile('str a = 1\n\n\nstr b = 2');
    assert.ok(js.includes('const a = 1'));
    assert.ok(js.includes('const b = 2'));
  });

  it('handles empty lines inside functions', () => {
    const js = transpile('fn test():\n  str a = 1\n\n  str b = 2\n  ret a');
    assert.ok(js.includes('function test()'));
    assert.ok(js.includes('const a = 1'));
    assert.ok(js.includes('const b = 2'));
  });

  it('handles empty lines in server blocks', () => {
    const src = 'server app port 3000:\n  cors "*"\n\n  get "/":\n    ret {ok: true}';
    const js = transpile(src);
    assert.ok(js.includes('express'));
    assert.ok(js.includes('app.get'));
  });

  it('handles empty lines in schema blocks', () => {
    const src = 'schema User:\n  id auto\n\n  name str required';
    const js = transpile(src);
    assert.ok(js.includes('createSchema'));
  });

  it('handles strings with special chars', () => {
    const js = transpile('str q = "SELECT * FROM users WHERE id = 1;"');
    assert.ok(js.includes('SELECT'));
  });

  it('handles standalone ternary', () => {
    const js = transpile('str size = if count > 10 then "big" else "small"');
    assert.ok(js.includes('?'));
    assert.ok(js.includes(':'));
  });

  it('errors on unterminated string', () => {
    assert.throws(() => transpile('str x = "hello'), /[Uu]nterminated/);
  });

  it('handles CRLF line endings', () => {
    const js = transpile('str a = 1\r\nstr b = 2\r\n');
    assert.ok(js.includes('const a = 1'));
    assert.ok(js.includes('const b = 2'));
  });

  it('handles complex realistic app with empty lines', () => {
    const src = [
      'db "data/"', '',
      'env:', '  PORT int default(3000)', '  SECRET str required', '',
      'schema User:', '  id auto', '  name str required', '',
      'server app port PORT:', '  cors "*"', '  cookie', '',
      '  crud "/api/users" User', '',
      '  get "/":',  '    ret.html "<h1>Welcome</h1>"', '',
      '  error (err, req, res):',
      '    ret.status 500 {error: err.message}',
    ].join('\n');
    const js = transpile(src);
    assert.ok(js.includes('express'));
    assert.ok(js.includes('createFileStore'));
    assert.ok(js.includes('cookieParser'));
    assert.ok(js.includes('err, req, res, next'));
  });

  it('provides helpful error messages', () => {
    try {
      transpile('if true\n  log "yes"');
      assert.fail('should throw');
    } catch (e) {
      assert.ok(e.message.includes('COLON') || e.message.includes(':'));
    }
  });

  it('shows source context in errors', () => {
    try {
      transpile('str a = 1\nif true\n  log "yes"');
      assert.fail('should throw');
    } catch (e) {
      assert.ok(e.message.includes('>>') || e.message.includes('|'));
    }
  });
});

describe('Runtime unit tests', () => {
  it('hash and verify password', async () => {
    const { hash, verify } = await import('../src/runtime.js');
    const hashed = hash('mypassword');
    assert.ok(hashed.includes(':'));
    assert.ok(verify('mypassword', hashed));
    assert.ok(!verify('wrongpassword', hashed));
  });

  it('uuid generates valid UUIDs', async () => {
    const { uuid } = await import('../src/runtime.js');
    const id = uuid();
    assert.ok(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id));
  });

  it('JWT sign and verify roundtrip', async () => {
    const { jwtSign, jwtVerify } = await import('../src/runtime.js');
    const token = jwtSign({ userId: 42 }, 'test-secret', '1h');
    const payload = jwtVerify(token, 'test-secret');
    assert.strictEqual(payload.userId, 42);
    assert.ok(payload.exp);
    assert.ok(payload.iat);
  });

  it('schema validation works', async () => {
    const { createSchema } = await import('../src/runtime.js');
    const schema = createSchema('Test', {
      name: { type: 'string', required: true, min: 2 },
      email: { type: 'string', email: true },
    });
    const ok = schema.validate({ name: 'John', email: 'j@e.com' });
    assert.ok(ok.valid);
    const fail = schema.validate({ name: 'J', email: 'bad' });
    assert.ok(!fail.valid);
    assert.ok(fail.errors.length >= 2);
  });

  it('api object has all methods', async () => {
    const { api } = await import('../src/runtime.js');
    assert.ok(typeof api.get === 'function');
    assert.ok(typeof api.post === 'function');
    assert.ok(typeof api.put === 'function');
    assert.ok(typeof api.del === 'function');
    assert.ok(typeof api.raw === 'function');
  });

  it('cookieParser parses cookies', async () => {
    const { cookieParser } = await import('../src/runtime.js');
    const parser = cookieParser();
    const req = { headers: { cookie: 'session=abc123; theme=dark; name=hello%20world' } };
    const res = {};
    let called = false;
    parser(req, res, () => { called = true; });
    assert.ok(called);
    assert.strictEqual(req.cookies.session, 'abc123');
    assert.strictEqual(req.cookies.theme, 'dark');
    assert.strictEqual(req.cookies.name, 'hello world');
  });

  it('sessionMiddleware provides req.session', async () => {
    const { sessionMiddleware } = await import('../src/runtime.js');
    const mid = sessionMiddleware('secret');
    const req = { headers: {} };
    const res = { writeHead: () => {}, setHeader: () => {} };
    let called = false;
    mid(req, res, () => { called = true; });
    assert.ok(called);
    assert.ok(req.session);
    assert.ok(req.sessionId);
    assert.ok(typeof req.session.destroy === 'function');
  });

  it('cacheMiddleware caches GET responses', async () => {
    const { cacheMiddleware } = await import('../src/runtime.js');
    const mid = cacheMiddleware('1m');
    assert.ok(typeof mid === 'function');
  });

  it('createSseManager has send/broadcast/handler', async () => {
    const { createSseManager } = await import('../src/runtime.js');
    const sse = createSseManager();
    assert.ok(typeof sse.handler === 'function');
    assert.ok(typeof sse.send === 'function');
    assert.ok(typeof sse.broadcast === 'function');
    assert.strictEqual(sse.count, 0);
  });

  it('uploadMiddleware returns middleware function', async () => {
    const { uploadMiddleware } = await import('../src/runtime.js');
    const mid = uploadMiddleware('file');
    assert.ok(typeof mid === 'function');
  });

  it('createRenderer returns a function', async () => {
    const { createRenderer } = await import('../src/runtime.js');
    const render = createRenderer('./test');
    assert.ok(typeof render === 'function');
  });

  it('createStore CRUD operations', async () => {
    const { createSchema, createStore } = await import('../src/runtime.js');
    const schema = createSchema('Item', {
      id: { type: 'id', auto: true },
      name: { type: 'string', required: true },
    });
    const store = createStore(schema);
    const item = store.create({ name: 'test' });
    assert.ok(item.id);
    assert.strictEqual(item.name, 'test');
    assert.strictEqual(store.getAll().length, 1);
    assert.strictEqual(store.getById(item.id).name, 'test');
    store.update(item.id, { name: 'updated' });
    assert.strictEqual(store.getById(item.id).name, 'updated');
    store.delete(item.id);
    assert.strictEqual(store.getAll().length, 0);
  });

  it('validateMiddleware validates POST bodies', async () => {
    const { createSchema, validateMiddleware } = await import('../src/runtime.js');
    const schema = createSchema('User', {
      name: { type: 'string', required: true, min: 2 },
    });
    const mid = validateMiddleware(schema);
    const req = { method: 'POST', body: { name: 'A' } };
    const res = { status(code) { res._status = code; return res; }, json(data) { res._json = data; } };
    let called = false;
    mid(req, res, () => { called = true; });
    assert.ok(!called);
    assert.strictEqual(res._status, 400);

    const req2 = { method: 'POST', body: { name: 'Alice' } };
    let called2 = false;
    mid(req2, { status() { return { json() {} }; } }, () => { called2 = true; });
    assert.ok(called2);
  });

  it('validateMiddleware passes GET requests', async () => {
    const { createSchema, validateMiddleware } = await import('../src/runtime.js');
    const schema = createSchema('User', { name: { type: 'string', required: true } });
    const mid = validateMiddleware(schema);
    const req = { method: 'GET' };
    let called = false;
    mid(req, {}, () => { called = true; });
    assert.ok(called);
  });

  it('createQueue registers and processes jobs', async () => {
    const { createQueue } = await import('../src/runtime.js');
    const q = createQueue();
    const results = [];
    q.register('test', async (data) => { results.push(data.value); });
    await q.add('test', { value: 1 });
    await q.add('test', { value: 2 });
    assert.deepStrictEqual(results, [1, 2]);
  });

  it('buildOpenApiSpec generates valid spec', async () => {
    const { createSchema, buildOpenApiSpec } = await import('../src/runtime.js');
    const schema = createSchema('User', {
      id: { type: 'id', auto: true },
      name: { type: 'string', required: true },
      age: { type: 'integer', min: 0 },
    });
    const spec = buildOpenApiSpec([schema]);
    assert.strictEqual(spec.openapi, '3.1.0');
    assert.ok(spec.components.schemas.User);
    assert.strictEqual(spec.components.schemas.User.properties.name.type, 'string');
    assert.strictEqual(spec.components.schemas.User.properties.age.type, 'integer');
    assert.ok(spec.components.schemas.User.required.includes('name'));
  });

  // ===== createMock tests =====
  it('createMock tracks calls and supports returns/reset', async () => {
    const { createMock } = await import('../src/runtime.js');
    const mock = createMock();
    assert.strictEqual(mock.callCount(), 0);
    mock(1, 2);
    mock('a');
    assert.strictEqual(mock.callCount(), 2);
    assert.ok(mock.calledWith(1, 2));
    assert.ok(mock.calledWith('a'));
    assert.ok(!mock.calledWith(99));
    mock.returns(42);
    assert.strictEqual(mock(), 42);
    mock.reset();
    assert.strictEqual(mock.callCount(), 0);
  });

  it('createMock wraps an existing function', async () => {
    const { createMock } = await import('../src/runtime.js');
    const mock = createMock((x) => x * 2);
    assert.strictEqual(mock(5), 10);
    assert.strictEqual(mock.callCount(), 1);
    mock.impl((x) => x + 1);
    assert.strictEqual(mock(5), 6);
  });

  // ===== createSpy tests =====
  it('createSpy wraps and restores object methods', async () => {
    const { createSpy } = await import('../src/runtime.js');
    const obj = { greet(name) { return `hi ${name}`; } };
    const spy = createSpy(obj, 'greet');
    assert.strictEqual(obj.greet('world'), 'hi world');
    assert.strictEqual(spy.callCount(), 1);
    assert.ok(spy.calledWith('world'));
    spy.restore();
    assert.strictEqual(obj.greet('test'), 'hi test');
  });

  // ===== Plugin system tests =====
  it('registerPlugin and usePlugin work', async () => {
    const { registerPlugin, usePlugin, listPlugins } = await import('../src/runtime.js');
    registerPlugin('test-logger', (opts) => ({
      log: (msg) => `[${opts.prefix || 'LOG'}] ${msg}`,
    }));
    assert.ok(listPlugins().includes('test-logger'));
    const logger = usePlugin('test-logger', { prefix: 'TEST' });
    assert.strictEqual(logger.log('hello'), '[TEST] hello');
    const same = usePlugin('test-logger');
    assert.strictEqual(same, logger);
  });

  it('usePlugin throws for unknown plugin', async () => {
    const { usePlugin } = await import('../src/runtime.js');
    assert.throws(() => usePlugin('nonexistent-xyz'), /not found/);
  });

  // ===== Indent auto-detection tests =====
  it('lexer auto-detects 2-space indent', () => {
    const { Lexer } = lexerMod;
    const lex = new Lexer('fn foo():\n  ret 1\n');
    lex.tokenize();
    assert.strictEqual(lex.indentUnit, 2);
  });

  it('lexer auto-detects 4-space indent', () => {
    const { Lexer } = lexerMod;
    const lex = new Lexer('fn foo():\n    ret 1\n');
    lex.tokenize();
    assert.strictEqual(lex.indentUnit, 4);
  });

  // ===== Source map tests =====
  it('compile returns sourceMap array', () => {
    const result = compile('fn add(a, b):\n  ret a + b\n');
    assert.ok(Array.isArray(result.sourceMap));
    assert.ok(result.sourceMap.length > 0);
    assert.ok(typeof result.sourceMap[0] === 'number');
  });

  // ===== Path normalization tests =====
  it('normalizes wildcard paths in auth routes', () => {
    const result = compile('server app port 3000:\n  auth SECRET:\n    protect "/api/*"\n');
    assert.ok(result.js.includes('"/api/(.*)"'));
  });

  it('normalizes wildcard paths in cache', () => {
    const result = compile('server app port 3000:\n  cache "/api/*" "5m"\n');
    assert.ok(result.js.includes('"/api/(.*)"'));
  });

  // ===== Reduced parens in transpiled JS =====
  it('simple binary expressions have no outer parens', () => {
    const result = compile('num x = 1 + 2\n');
    assert.ok(result.js.includes('1 + 2'));
    assert.ok(!result.js.includes('(1 + 2)'));
  });

  // ===== NX mode compile =====
  it('compiles NX mode via preprocess', () => {
    const result = compile('s:name="World"\nf greet(s:who)s\n  >"Hello, {who}!"', { mode: 'x' });
    assert.ok(result.js.includes('function greet'));
    assert.ok(result.naide);
  });

  // ===== Type-annotated variable compilation =====
  it('compiles typed variables (str, int, num, bool)', () => {
    const js1 = compile('str name = "hello"\n').js;
    assert.ok(js1.includes('const name = "hello"'));
    const js2 = compile('int count = 42\n').js;
    assert.ok(js2.includes('const count = 42'));
    const js3 = compile('bool flag = true\n').js;
    assert.ok(js3.includes('const flag = true'));
  });

  // ===== Type checker =====
  it('type checker detects type mismatch (int = string)', () => {
    const result = compile('int x = "hello"\n', { typeCheck: true });
    assert.ok(result.typeErrors);
    assert.ok(result.typeErrors.errors.length > 0);
    assert.ok(result.typeErrors.errors[0].message.includes('cannot assign'));
  });

  it('type checker accepts compatible types', () => {
    const result = compile('int x = 42\nstr name = "hello"\nbool flag = true\n', { typeCheck: true });
    assert.ok(result.typeErrors);
    assert.strictEqual(result.typeErrors.errors.length, 0);
  });

  it('type checker allows num = int', () => {
    const result = compile('num x = 42\n', { typeCheck: true });
    assert.ok(result.typeErrors);
    assert.strictEqual(result.typeErrors.errors.length, 0);
  });

  it('type checker detects str = number', () => {
    const result = compile('str x = 42\n', { typeCheck: true });
    assert.ok(result.typeErrors);
    assert.ok(result.typeErrors.errors.length > 0);
  });

  it('type checker detects bool = string', () => {
    const result = compile('bool x = "yes"\n', { typeCheck: true });
    assert.ok(result.typeErrors);
    assert.ok(result.typeErrors.errors.length > 0);
  });

  it('type checker returns null when disabled', () => {
    const result = compile('int x = "hello"\n');
    assert.strictEqual(result.typeErrors, null);
  });

  // ===== Async route error handling =====
  it('async routes get auto try/catch', () => {
    const src = 'server app port 3000:\n  post "/api/data" (req, res):\n    any data = await fetchData()\n    ret data\n';
    const js = compile(src).js;
    assert.ok(js.includes('try {'));
    assert.ok(js.includes('catch (__err)'));
    assert.ok(js.includes('res.status(500)'));
  });

  it('routes with manual try/catch skip auto-wrap', () => {
    const src = 'server app port 3000:\n  post "/api/data" (req, res):\n    try:\n      any data = await fetchData()\n      ret data\n    fail e:\n      ret.status 500 {error: e.message}\n';
    const js = compile(src).js;
    const catchCount = (js.match(/catch/g) || []).length;
    assert.strictEqual(catchCount, 1);
  });

  it('sync routes do not get auto try/catch', () => {
    const src = 'server app port 3000:\n  get "/":\n    ret {ok: true}\n';
    const js = compile(src).js;
    assert.ok(!js.includes('catch (__err)'));
  });

  // ===== Unhandled rejection handler =====
  it('server code includes unhandledRejection handler', () => {
    const src = 'server app port 3000:\n  get "/":\n    ret {ok: true}\n';
    const js = compile(src).js;
    assert.ok(js.includes('unhandledRejection'));
  });

  // ===== Debug mode in help text =====
  it('help text includes debug, check, and target commands', async () => {
    const { execSync } = await import('child_process');
    const help = execSync('node bin/naide.js --help', { encoding: 'utf-8' });
    assert.ok(help.includes('--debug'));
    assert.ok(help.includes('--check'));
    assert.ok(help.includes('naide pkg'));
    assert.ok(help.includes('--target'));
    assert.ok(help.includes('python'));
    assert.ok(help.includes('bun'));
  });

  // ===== compileAsync with target =====
  it('compileAsync returns code for node target', async () => {
    const { compileAsync } = await import('../src/index.js');
    const result = await compileAsync('str name = "hello"\n', { target: 'node' });
    assert.ok(result.js.includes('const name = "hello"'));
    assert.ok(result.code);
  });

  // ===== Python target =====
  it('compileAsync generates Python for variables', async () => {
    const { compileAsync } = await import('../src/index.js');
    const result = await compileAsync('str name = "hello"\nint count = 42\n', { target: 'python' });
    assert.ok(result.code.includes('name = "hello"'));
    assert.ok(result.code.includes('count = 42'));
  });

  it('compileAsync generates Python functions', async () => {
    const { compileAsync } = await import('../src/index.js');
    const result = await compileAsync('fn add(int a, int b) -> int:\n  ret a + b\n', { target: 'python' });
    assert.ok(result.code.includes('def add(a, b):'));
    assert.ok(result.code.includes('return a + b'));
  });

  it('compileAsync generates Flask server', async () => {
    const { compileAsync } = await import('../src/index.js');
    const result = await compileAsync('server app port 3000:\n  get "/":\n    ret {ok: true}\n', { target: 'python' });
    assert.ok(result.code.includes('Flask'));
    assert.ok(result.code.includes("@app.route"));
    assert.ok(result.code.includes('app.run'));
  });

  // ===== Bun target =====
  it('compileAsync generates Bun.serve server', async () => {
    const { compileAsync } = await import('../src/index.js');
    const result = await compileAsync('server app port 3000:\n  get "/":\n    ret {ok: true}\n', { target: 'bun' });
    assert.ok(result.code.includes('Bun.serve'));
    assert.ok(result.code.includes('fetch(req)'));
    assert.ok(result.code.includes('new Response'));
  });

  it('compileAsync Bun target generates variables as JS', async () => {
    const { compileAsync } = await import('../src/index.js');
    const result = await compileAsync('str name = "hello"\nint count = 42\n', { target: 'bun' });
    assert.ok(result.code.includes('const name = "hello"'));
    assert.ok(result.code.includes('const count = 42'));
  });

  it('compileAsync Bun server has route matching', async () => {
    const { compileAsync } = await import('../src/index.js');
    const src = 'server app port 8080:\n  get "/api/hello":\n    ret {msg: "hi"}\n  post "/api/data" (req, res):\n    ret {ok: true}\n';
    const result = await compileAsync(src, { target: 'bun' });
    assert.ok(result.code.includes("method === 'GET'"));
    assert.ok(result.code.includes("method === 'POST'"));
    assert.ok(result.code.includes('"/api/hello"'));
  });

  // ===== Bun CRUD =====
  it('compileAsync Bun generates CRUD routes', async () => {
    const { compileAsync } = await import('../src/index.js');
    const src = 'schema User:\n  id auto\n  name str required\n\nserver app port 3000:\n  crud "/api/users" User\n';
    const result = await compileAsync(src, { target: 'bun' });
    assert.ok(result.code.includes('Bun.serve'));
    assert.ok(result.code.includes('__userStore'));
    assert.ok(result.code.includes("method === 'POST'"));
    assert.ok(result.code.includes("method === 'DELETE'"));
  });

  // ===== Bun static =====
  it('compileAsync Bun serves static files', async () => {
    const { compileAsync } = await import('../src/index.js');
    const src = 'server app port 3000:\n  static "public"\n  get "/":\n    ret {ok: true}\n';
    const result = await compileAsync(src, { target: 'bun' });
    assert.ok(result.code.includes('Bun.file'));
    assert.ok(result.code.includes('file.exists'));
  });

  // ===== Python CRUD =====
  it('compileAsync Python generates CRUD routes', async () => {
    const { compileAsync } = await import('../src/index.js');
    const src = 'schema User:\n  id auto\n  name str required\n\nserver app port 3000:\n  crud "/api/users" User\n';
    const result = await compileAsync(src, { target: 'python' });
    assert.ok(result.code.includes('Flask'));
    assert.ok(result.code.includes('__user_store'));
    assert.ok(result.code.includes("methods=['POST']"));
    assert.ok(result.code.includes("methods=['DELETE']"));
  });

  // ===== Python static =====
  it('compileAsync Python serves static files', async () => {
    const { compileAsync } = await import('../src/index.js');
    const src = 'server app port 3000:\n  static "public"\n  get "/":\n    ret {ok: true}\n';
    const result = await compileAsync(src, { target: 'python' });
    assert.ok(result.code.includes('send_from_directory'));
  });

  // ===== Discord Bot =====
  it('compiles bot with events', () => {
    const src = 'bot myBot token "TEST_TOKEN":\n  on "ready":\n    log "Bot is online!"\n  on "message" (msg):\n    log msg.content\n';
    const js = transpile(src);
    assert.ok(js.includes("import { Client, GatewayIntentBits"));
    assert.ok(js.includes("new Client("));
    assert.ok(js.includes("myBot.on('ready'"));
    assert.ok(js.includes("myBot.on('messageCreate'"));
    assert.ok(js.includes('myBot.login("TEST_TOKEN")'));
  });

  it('compiles bot with slash commands', () => {
    const src = 'bot myBot token "TEST_TOKEN":\n  slash "hello" "Says hello":\n    interaction.reply("Hi!")\n';
    const js = transpile(src);
    assert.ok(js.includes("interactionCreate"));
    assert.ok(js.includes("isChatInputCommand"));
    assert.ok(js.includes('commandName === "hello"'));
    assert.ok(js.includes("SlashCommandBuilder"));
    assert.ok(js.includes('setName("hello")'));
    assert.ok(js.includes('setDescription("Says hello")'));
  });

  it('compileAsync Bun bot with events', async () => {
    const { compileAsync } = await import('../src/index.js');
    const src = 'bot myBot token "TEST_TOKEN":\n  on "ready":\n    log "Bot is online!"\n';
    const result = await compileAsync(src, { target: 'bun' });
    assert.ok(result.code.includes("new Client("));
    assert.ok(result.code.includes("myBot.on('ready'"));
    assert.ok(result.code.includes('myBot.login("TEST_TOKEN")'));
  });

  it('compileAsync Python bot with events', async () => {
    const { compileAsync } = await import('../src/index.js');
    const src = 'bot myBot token "TEST_TOKEN":\n  on "ready":\n    log "Bot is online!"\n  on "message" (msg):\n    log msg.content\n';
    const result = await compileAsync(src, { target: 'python' });
    assert.ok(result.code.includes("import discord"));
    assert.ok(result.code.includes("commands.Bot("));
    assert.ok(result.code.includes("async def on_ready"));
    assert.ok(result.code.includes("async def on_message(msg)"));
    assert.ok(result.code.includes('.run("TEST_TOKEN")'));
  });

  it('compileAsync Python bot with slash commands', async () => {
    const { compileAsync } = await import('../src/index.js');
    const src = 'bot myBot token "TEST_TOKEN":\n  slash "greet" "Greets user":\n    interaction.reply("Hello!")\n';
    const result = await compileAsync(src, { target: 'python' });
    assert.ok(result.code.includes("@myBot.tree.command"));
    assert.ok(result.code.includes("discord.Interaction"));
    assert.ok(result.code.includes("tree.sync()"));
  });

  // ===== Page (HTML generation) =====
  it('compiles page with elements', () => {
    const src = 'page "index.html":\n  title "My Page"\n  h1 "Hello"\n  p "Welcome"\n';
    const js = transpile(src);
    assert.ok(js.includes('writeFileSync'));
    assert.ok(js.includes('index.html'));
    assert.ok(js.includes('My Page'));
    assert.ok(js.includes('<h1>'));
    assert.ok(js.includes('<p>'));
  });

  it('compileAsync Python page generation', async () => {
    const { compileAsync } = await import('../src/index.js');
    const src = 'page "index.html":\n  title "Test"\n  h1 "Hello"\n';
    const result = await compileAsync(src, { target: 'python' });
    assert.ok(result.code.includes("open("));
    assert.ok(result.code.includes('Test'));
    assert.ok(result.code.includes('<h1>'));
  });

  it('compileAsync Bun page generation', async () => {
    const { compileAsync } = await import('../src/index.js');
    const src = 'page "index.html":\n  title "Test"\n  h1 "Hello"\n';
    const result = await compileAsync(src, { target: 'bun' });
    assert.ok(result.code.includes('Bun.write'));
    assert.ok(result.code.includes('<title>Test</title>'));
  });

  it('compiles page with nested elements', () => {
    const src = 'page "app.html":\n  title "App"\n  div "container":\n    h1 "Title"\n    p "Text"\n';
    const js = transpile(src);
    assert.ok(js.includes('<div class="container">'));
    assert.ok(js.includes('</div>'));
  });

  // ===== CLI App =====
  it('compiles CLI app', () => {
    const src = 'cli myTool "A useful tool":\n  arg "name" str "Your name"\n  flag "v" "verbose" "Verbose output"\n  run (args):\n    log args.name\n';
    const js = transpile(src);
    assert.ok(js.includes('process.argv'));
    assert.ok(js.includes('--name'));
    assert.ok(js.includes('--verbose'));
    assert.ok(js.includes('--help'));
  });

  it('compileAsync Python CLI app', async () => {
    const { compileAsync } = await import('../src/index.js');
    const src = 'cli myTool "A useful tool":\n  arg "name" str "Your name"\n  flag "v" "verbose" "Verbose"\n  run (args):\n    log args.name\n';
    const result = await compileAsync(src, { target: 'python' });
    assert.ok(result.code.includes('argparse'));
    assert.ok(result.code.includes('add_argument'));
    assert.ok(result.code.includes("'--name'"));
    assert.ok(result.code.includes("'--verbose'"));
  });

  // ===== Mail =====
  it('compiles mail config', () => {
    const src = 'mail "smtp.gmail.com" 587:\n  user "me@gmail.com"\n  pass "secret"\n';
    const js = transpile(src);
    assert.ok(js.includes('nodemailer'));
    assert.ok(js.includes('createTransport'));
    assert.ok(js.includes('smtp.gmail.com'));
    assert.ok(js.includes('587'));
  });

  it('compileAsync Python mail config', async () => {
    const { compileAsync } = await import('../src/index.js');
    const src = 'mail "smtp.gmail.com" 587:\n  user "me@gmail.com"\n  pass "secret"\n';
    const result = await compileAsync(src, { target: 'python' });
    assert.ok(result.code.includes('smtplib'));
    assert.ok(result.code.includes('MIMEText'));
    assert.ok(result.code.includes('smtp.gmail.com'));
  });

  // ===== Cron (enhanced every) =====
  it('compiles cron expression in every', () => {
    const src = 'every "*/5 * * * *":\n  log "tick"\n';
    const js = transpile(src);
    assert.ok(js.includes('node-cron'));
    assert.ok(js.includes('cron.schedule'));
  });

  it('compiles regular interval in every', () => {
    const src = 'every "5s":\n  log "tick"\n';
    const js = transpile(src);
    assert.ok(js.includes('scheduleEvery'));
    assert.ok(!js.includes('node-cron'));
  });

  it('compileAsync Python cron expression', async () => {
    const { compileAsync } = await import('../src/index.js');
    const src = 'every "*/5 * * * *":\n  log "tick"\n';
    const result = await compileAsync(src, { target: 'python' });
    assert.ok(result.code.includes('apscheduler') || result.code.includes('BlockingScheduler'));
  });

  // ===== GraphQL =====
  it('compiles GraphQL in server', () => {
    const src = 'server app port 3000:\n  graphql "/graphql"\n';
    const js = transpile(src);
    assert.ok(js.includes('graphql'));
    assert.ok(js.includes('/graphql'));
  });

  it('compileAsync Bun GraphQL', async () => {
    const { compileAsync } = await import('../src/index.js');
    const src = 'server app port 3000:\n  graphql "/graphql"\n';
    const result = await compileAsync(src, { target: 'bun' });
    assert.ok(result.code.includes('graphql'));
    assert.ok(result.code.includes('/graphql'));
  });

  it('compileAsync Python GraphQL', async () => {
    const { compileAsync } = await import('../src/index.js');
    const src = 'server app port 3000:\n  graphql "/graphql"\n';
    const result = await compileAsync(src, { target: 'python' });
    assert.ok(result.code.includes('GraphQLView') || result.code.includes('graphql'));
  });

  // ===== Multi-platform Bots =====
  it('compiles Slack bot', () => {
    const src = 'bot myBot type "slack" token "xoxb-test":\n  on "message" (msg):\n    msg.reply("Hi")\n';
    const js = transpile(src);
    assert.ok(js.includes("@slack/bolt"));
    assert.ok(js.includes("App({"));
  });

  it('compiles Telegram bot', () => {
    const src = 'bot myBot type "telegram" token "123:ABC":\n  on "message" (msg):\n    msg.reply("Hi")\n';
    const js = transpile(src);
    assert.ok(js.includes("node-telegram-bot-api"));
    assert.ok(js.includes("TelegramBot("));
  });

  it('compiles LINE bot', () => {
    const src = 'bot myBot type "line" token "test-token":\n  on "message" (event):\n    log event\n';
    const js = transpile(src);
    assert.ok(js.includes("@line/bot-sdk"));
    assert.ok(js.includes("Client("));
  });

  it('compiles Discord bot (default type)', () => {
    const src = 'bot myBot token "TEST":\n  on "ready":\n    log "online"\n';
    const js = transpile(src);
    assert.ok(js.includes("discord.js"));
    assert.ok(js.includes("Client("));
  });

  it('compileAsync Python Slack bot', async () => {
    const { compileAsync } = await import('../src/index.js');
    const src = 'bot myBot type "slack" token "xoxb-test":\n  on "message" (msg):\n    msg.reply("Hi")\n';
    const result = await compileAsync(src, { target: 'python' });
    assert.ok(result.code.includes("slack_bolt"));
    assert.ok(result.code.includes("App("));
  });

  it('compileAsync Python Telegram bot', async () => {
    const { compileAsync } = await import('../src/index.js');
    const src = 'bot myBot type "telegram" token "123:ABC":\n  on "message" (msg):\n    msg.reply("Hi")\n';
    const result = await compileAsync(src, { target: 'python' });
    assert.ok(result.code.includes("ApplicationBuilder"));
    assert.ok(result.code.includes("MessageHandler"));
  });

  it('compileAsync Python LINE bot', async () => {
    const { compileAsync } = await import('../src/index.js');
    const src = 'bot myBot type "line" token "test-token":\n  on "message" (event):\n    log event\n';
    const result = await compileAsync(src, { target: 'python' });
    assert.ok(result.code.includes("LineBotApi"));
    assert.ok(result.code.includes("WebhookHandler"));
  });

  // ===== Desktop App =====
  it('compiles desktop app', () => {
    const src = 'desktop myApp:\n  title "My App"\n  size 1024 768\n  load "index.html"\n';
    const js = transpile(src);
    assert.ok(js.includes('electron'));
    assert.ok(js.includes('BrowserWindow'));
    assert.ok(js.includes('1024'));
    assert.ok(js.includes('768'));
  });

  it('compileAsync Python desktop app', async () => {
    const { compileAsync } = await import('../src/index.js');
    const src = 'desktop myApp:\n  title "My App"\n  size 1024 768\n  load "index.html"\n';
    const result = await compileAsync(src, { target: 'python' });
    assert.ok(result.code.includes('webview'));
    assert.ok(result.code.includes('create_window'));
    assert.ok(result.code.includes('1024'));
    assert.ok(result.code.includes('768'));
  });

  // ===== Mobile/Screen =====
  it('compiles screen (React Native)', () => {
    const src = 'screen Home:\n  text "Hello World"\n  button "Click Me"\n  input "Enter name"\n';
    const js = transpile(src);
    assert.ok(js.includes('react-native'));
    assert.ok(js.includes('View'));
    assert.ok(js.includes('Text'));
    assert.ok(js.includes('Button') || js.includes('TouchableOpacity'));
    assert.ok(js.includes('TextInput'));
  });

  it('compileAsync Python screen (Kivy)', async () => {
    const { compileAsync } = await import('../src/index.js');
    const src = 'screen Home:\n  text "Hello World"\n  button "Click Me"\n  input "Enter name"\n';
    const result = await compileAsync(src, { target: 'python' });
    assert.ok(result.code.includes('kivy'));
    assert.ok(result.code.includes('Label'));
    assert.ok(result.code.includes('Button'));
    assert.ok(result.code.includes('TextInput'));
    assert.ok(result.code.includes('HomeApp'));
  });

  // ===== LSP capabilities =====
  it('LSP server file exists and exports handlers', async () => {
    const { readFileSync } = await import('fs');
    const lsp = readFileSync('lsp/server.js', 'utf-8');
    assert.ok(lsp.includes('definitionProvider'));
    assert.ok(lsp.includes('referencesProvider'));
    assert.ok(lsp.includes('getDefinition'));
    assert.ok(lsp.includes('getReferences'));
    assert.ok(lsp.includes('indexSymbols'));
  });
});
