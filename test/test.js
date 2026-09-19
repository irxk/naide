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

  it('compiles full app with schema + server + crud + auth', () => {
    const src = [
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
      '  crud "/api/users" User',
      '  get "/health":',
      '    ret {status: "ok"}',
    ].join('\n');
    const js = transpile(src);
    assert.ok(js.includes('loadEnv'));
    assert.ok(js.includes('createSchema'));
    assert.ok(js.includes('registerCrud'));
    assert.ok(js.includes('jwtAuth'));
    assert.ok(js.includes('corsMiddleware'));
    assert.ok(js.includes('express'));
    assert.ok(js.includes('app.get'));
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
});
