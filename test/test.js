import { describe, it } from 'node:test';
import assert from 'node:assert';
import { compile, transpile, preprocess } from '../src/index.js';

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
    assert.ok(js.includes('return (a + b)'));
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
    assert.ok(js.includes('"/api/*"'));
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
    assert.ok(js.includes('"/api/*"'));
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
});
