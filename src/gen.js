import { Lexer } from './lexer.js';
import { Parser } from './parser.js';

// ── Vocabulary ──────────────────────────────────────────────

const INTENT_WORDS = {
  server:    ['server', 'api', 'rest', 'restful', 'endpoint', 'web', 'http', 'https', 'backend', 'app', 'application', 'service', 'microservice'],
  schema:    ['schema', 'model', 'entity', 'struct', 'table', 'type', 'data', 'record', 'resource', 'object', 'definition'],
  bot:       ['bot', 'chatbot', 'robot'],
  cli:       ['cli', 'command', 'terminal', 'console', 'argv', 'args'],
  page:      ['page', 'html', 'website', 'site', 'frontend', 'ui', 'view', 'template', 'render', 'layout'],
  test:      ['test', 'testing', 'spec', 'unit', 'e2e', 'integration', 'assert', 'expect'],
  database:  ['database', 'db', 'storage', 'persist', 'store', 'repository', 'sqlite', 'postgres', 'postgresql', 'json-db', 'mongo'],
  ai:        ['ai', 'llm', 'gpt', 'claude', 'openai', 'prompt', 'embedding', 'rag'],
  crud:      ['crud', 'create', 'read', 'update', 'delete', 'listing', 'list', 'index'],
  auth:      ['auth', 'jwt', 'login', 'authentication', 'authorization', 'signup', 'signin', 'sign-in', 'sign-up',
              'password', 'token', 'session', 'protect', 'permission', 'role', 'rbac', 'oauth', 'register', 'member', 'membership', 'account'],
  cors:      ['cors', 'cross-origin'],
  websocket: ['websocket', 'ws', 'realtime', 'real-time', 'socket', 'live', 'push-notification', 'pubsub', 'pub-sub'],
  mail:      ['mail', 'smtp', 'mailer', 'sendmail', 'newsletter', 'notification'],
  graphql:   ['graphql', 'gql', 'query', 'mutation', 'resolver', 'subscription'],
};

const JA_INTENTS = {
  server:    ['サーバー', 'エンドポイント', 'バックエンド', 'アプリ', 'ウェブアプリ', 'Webアプリ', 'webアプリ',
              'API', 'サービス', 'マイクロサービス', 'ウェブサービス'],
  schema:    ['スキーマ', 'モデル', 'テーブル', 'データ型', '型定義', 'エンティティ', 'データモデル', 'リソース'],
  bot:       ['ボット', 'チャットボット', 'Bot', 'bot'],
  cli:       ['コマンド', 'ツール', 'ターミナル', 'コマンドライン', 'CLI', 'コンソール'],
  page:      ['ページ', 'サイト', 'ウェブ', 'フロントエンド', '画面', 'UI', '表示', 'テンプレート', 'ビュー', '見た目'],
  test:      ['テスト', '検証', 'テストコード', '単体テスト', '結合テスト', 'ユニットテスト'],
  database:  ['データベース', 'ストレージ', '保存', '永続化', 'DB', 'db', 'データ保存', '記録'],
  ai:        ['プロンプト', 'LLM', 'llm', '生成AI', '人工知能'],
  auth:      ['認証', 'ログイン', 'パスワード', '保護', '権限', '会員', 'サインイン', 'サインアップ',
              '登録', 'ユーザー認証', 'アカウント', 'メンバー', '会員制', '会員機能', 'ログインできる',
              'ログイン機能', '認証機能', '認証付き', 'パスワード保護', 'アクセス制御', 'セキュリティ'],
  crud:      ['CRUD', 'crud', '作成', '取得', '更新', '削除', '一覧', '追加', '編集', '管理',
              '管理機能', '一覧表示', 'リスト', '操作'],
  websocket: ['ウェブソケット', 'リアルタイム', 'ソケット', 'WebSocket', 'websocket',
              'リアルタイム通信', 'プッシュ通知', 'ライブ'],
  mail:      ['メール', 'メール送信', 'メール機能', 'SMTP', '通知メール', 'メール通知'],
};

const JA_ENTITIES = {
  'ユーザー': 'User', 'ユーザ': 'User', 'ユーザ管理': 'User', 'ユーザー管理': 'User',
  '会員': 'User', 'メンバー': 'User', 'アカウント': 'User', '利用者': 'User',
  '顧客': 'Customer', 'お客様': 'Customer', 'クライアント': 'Customer',
  '商品': 'Product', 'プロダクト': 'Product', '製品': 'Product', '品物': 'Product',
  '記事': 'Post', '投稿': 'Post', 'ブログ記事': 'Post',
  'タスク': 'Task', 'やること': 'Task', '作業': 'Task',
  'メッセージ': 'Message', 'チャットメッセージ': 'Message',
  '注文': 'Order', 'オーダー': 'Order', '受注': 'Order', '発注': 'Order',
  'コメント': 'Comment', '感想': 'Comment', 'レビュー': 'Review', '評価': 'Review',
  'ファイル': 'File', 'アップロード': 'File',
  'カテゴリ': 'Category', 'カテゴリー': 'Category', '分類': 'Category',
  'イベント': 'Event', '予定': 'Event', 'スケジュール': 'Event', '予約': 'Reservation',
  'プロジェクト': 'Project', '案件': 'Project',
  '書籍': 'Book', '本': 'Book', '図書': 'Book',
  'アイテム': 'Item', 'リスト': 'List', 'ノート': 'Note', 'メモ': 'Note',
  '通知': 'Notification', 'お知らせ': 'Notification',
  '決済': 'Payment', '支払い': 'Payment', '課金': 'Payment',
  '設定': 'Setting', '環境設定': 'Setting', '構成': 'Setting',
  '問い合わせ': 'Contact', 'お問い合わせ': 'Contact', '連絡': 'Contact',
  '掲示板': 'Post', 'スレッド': 'Thread', 'トピック': 'Topic',
  'レシピ': 'Recipe', '料理': 'Recipe',
  '在庫': 'Inventory', '倉庫': 'Inventory',
  '社員': 'Employee', '従業員': 'Employee', 'スタッフ': 'Staff',
  'チケット': 'Ticket', 'チーム': 'Team', 'グループ': 'Group',
  'ログ': 'Log', '履歴': 'Log', 'アクティビティ': 'Activity',
};

const PLATFORM_WORDS = {
  discord:  ['discord', 'ディスコード'],
  slack:    ['slack', 'スラック'],
  telegram: ['telegram', 'テレグラム'],
  line:     ['line', 'ライン'],
};

const COMPOSITE_WORDS = {
  fullstack: ['fullstack', 'full-stack', 'フルスタック', '管理システム', '管理アプリ', '管理画面'],
  todo:      ['todo', 'todos', 'to-do', 'タスク管理', 'todoアプリ', 'やることリスト', 'todo管理'],
  blog:      ['blog', 'ブログ', '記事管理', '投稿管理', 'ブログサイト', 'ブログアプリ'],
  chat:      ['chat', 'チャットアプリ', 'メッセンジャー', 'チャット機能', 'チャットルーム'],
  shop:      ['shop', 'ecommerce', 'e-commerce', 'ショップ', 'ストア', '通販', 'ECサイト', 'EC', 'オンラインショップ'],
  board:     ['board', '掲示板', 'フォーラム', 'BBS', 'bbs'],
};

const NOISE = new Set([
  'a', 'an', 'the', 'for', 'with', 'and', 'or', 'on', 'at', 'to', 'of', 'in', 'by',
  'that', 'which', 'this', 'it', 'its', 'my', 'is', 'are', 'has', 'have', 'do', 'does',
  'make', 'create', 'build', 'generate', 'add', 'implement', 'simple', 'basic', 'new',
  'please', 'want', 'need', 'like', 'just', 'some', 'using', 'use', 'based',
  'setup', 'set', 'up', 'get', 'should', 'can', 'could', 'would',
  'の', 'を', 'に', 'で', 'は', 'が', 'と', 'も', 'から', 'まで', 'より', 'って',
  'な', 'ような', 'みたいな', 'っぽい', 'ような感じ',
  '作って', '作る', '作成', '生成', '追加', '実装', 'ください', 'して', 'つけて',
  '付き', '付きの', 'ある', 'ない', 'する', 'できる', 'ほしい', 'したい',
  '機能', '仕組み', 'もの', 'こと', 'やつ', '感じ', '的な',
  '簡単な', 'シンプルな', '基本的な', '新しい',
]);

// ── Field Normalization ─────────────────────────────────────

const FIELD_SYNONYMS = {
  'e-mail': 'email', 'email_address': 'email', 'mail_address': 'email', 'emailaddress': 'email', 'mail': 'email',
  'user_name': 'username', 'login_name': 'username', 'loginname': 'username', 'login': 'username',
  'first_name': 'firstname', 'firstname': 'name', 'last_name': 'lastname',
  'display_name': 'name', 'full_name': 'name', 'fullname': 'name',
  'phone_number': 'phone', 'tel': 'phone', 'telephone': 'phone', 'phonenumber': 'phone', 'mobile': 'phone',
  'zip_code': 'zipcode', 'postal_code': 'zipcode', 'postalcode': 'zipcode',
  'birth_date': 'birthdate', 'birthday': 'birthdate', 'date_of_birth': 'birthdate',
  'created_at': 'created', 'creation_date': 'created', 'createdat': 'created', 'date_created': 'created',
  'updated_at': 'updated', 'modification_date': 'updated', 'updatedat': 'updated', 'date_updated': 'updated', 'modified_at': 'updated',
  'is_active': 'active', 'isactive': 'active',
  'is_deleted': 'deleted', 'isdeleted': 'deleted',
  'is_public': 'public', 'ispublic': 'public',
  'is_admin': 'admin', 'isadmin': 'admin',
  'is_verified': 'verified', 'isverified': 'verified',
  'is_done': 'done', 'isdone': 'done', 'is_completed': 'completed',
  'is_published': 'published', 'ispublished': 'published',
  'is_enabled': 'enabled', 'isenabled': 'enabled',
  'num_items': 'count', 'item_count': 'count',
  'total_price': 'total', 'total_amount': 'total',
  'img': 'image', 'pic': 'image', 'picture': 'image', 'photo': 'image', 'thumbnail': 'image', 'avatar': 'image',
  'desc': 'description', 'memo': 'description', 'detail': 'description', 'details': 'description',
  'pwd': 'password', 'passwd': 'password', 'pass': 'password', 'pw': 'password',
  'qty': 'quantity', 'amt': 'amount', 'addr': 'address', 'msg': 'message',
  'cat': 'category', 'tags': 'tag', 'lbl': 'label',
};

function normalizeField(name) {
  const lower = name.toLowerCase();
  if (FIELD_SYNONYMS[lower]) return FIELD_SYNONYMS[lower];
  const n = lower.replace(/-/g, '_');
  return FIELD_SYNONYMS[n] || n;
}

// ── Field Type Inference ────────────────────────────────────

const FIELD_TYPES = {
  auto: ['id', 'created', 'updated', 'timestamp'],
  bool: ['active', 'done', 'completed', 'enabled', 'published', 'verified', 'admin', 'public',
         'visible', 'archived', 'deleted', 'premium', 'banned', 'muted', 'online', 'featured',
         'approved', 'blocked', 'pinned', 'starred', 'read'],
  int:  ['age', 'count', 'quantity', 'amount', 'price', 'cost', 'total', 'score', 'rating',
         'level', 'order', 'index', 'size', 'width', 'height', 'weight', 'year', 'month',
         'day', 'port', 'priority', 'views', 'likes', 'followers', 'stock', 'points',
         'duration', 'position', 'rank', 'votes'],
};

function inferType(rawName) {
  const n = normalizeField(rawName);
  for (const [type, names] of Object.entries(FIELD_TYPES)) {
    if (names.includes(n)) return type;
  }
  if (n.endsWith('_id') || n.endsWith('id') && n !== 'id') return 'int';
  if (n.startsWith('is_') || n.startsWith('has_') || n.startsWith('can_')) return 'bool';
  if (n.endsWith('count') || n.endsWith('num') || n.endsWith('number')) return 'int';
  if (n.includes('price') || n.includes('cost') || n.includes('amount')) return 'int';
  if (n.includes('date') || n.includes('time') || n === 'birthdate') return 'str';
  return 'str';
}

function inferModifiers(rawName, type) {
  const n = normalizeField(rawName);
  if (type === 'auto') return [];
  const mods = [];
  if (!['bool', 'auto'].includes(type)) {
    if (['name', 'title', 'email', 'password', 'username', 'content', 'body', 'phone', 'address'].includes(n)) mods.push('required');
  }
  if (n === 'email') mods.push('email');
  if (n === 'name' || n === 'title') { mods.push('min(1)'); mods.push('max(200)'); }
  if (n === 'password') mods.push('min(8)');
  return mods;
}

// ── Default Schema Fields ───────────────────────────────────

const SCHEMA_PRESETS = {
  user:     [['id','auto'], ['name','str','required'], ['email','str','required','email'], ['password','str','required','min(8)']],
  customer: [['id','auto'], ['name','str','required'], ['email','str','required','email'], ['phone','str']],
  post:     [['id','auto'], ['title','str','required','min(1)','max(200)'], ['body','str','required'], ['published','bool'], ['created','auto']],
  product:  [['id','auto'], ['name','str','required'], ['price','int','required'], ['stock','int'], ['description','str']],
  todo:     [['id','auto'], ['title','str','required','min(1)'], ['done','bool']],
  task:     [['id','auto'], ['title','str','required'], ['description','str'], ['status','str'], ['done','bool']],
  comment:  [['id','auto'], ['body','str','required'], ['author','str','required'], ['created','auto']],
  review:   [['id','auto'], ['body','str','required'], ['rating','int'], ['author','str','required'], ['created','auto']],
  message:  [['id','auto'], ['content','str','required'], ['sender','str','required'], ['created','auto']],
  order:    [['id','auto'], ['total','int','required'], ['status','str'], ['created','auto']],
  event:    [['id','auto'], ['title','str','required'], ['date','str','required'], ['description','str']],
  reservation:[['id','auto'], ['date','str','required'], ['name','str','required'], ['status','str'], ['created','auto']],
  note:     [['id','auto'], ['title','str','required'], ['content','str'], ['created','auto']],
  book:     [['id','auto'], ['title','str','required'], ['author','str','required'], ['price','int'], ['published','bool']],
  category: [['id','auto'], ['name','str','required'], ['description','str']],
  file:     [['id','auto'], ['name','str','required'], ['path','str','required'], ['size','int'], ['created','auto']],
  project:  [['id','auto'], ['name','str','required'], ['description','str'], ['status','str'], ['created','auto']],
  contact:  [['id','auto'], ['name','str','required'], ['email','str','required','email'], ['message','str','required'], ['created','auto']],
  notification:[['id','auto'], ['title','str','required'], ['body','str'], ['read','bool'], ['created','auto']],
  payment:  [['id','auto'], ['amount','int','required'], ['status','str'], ['method','str'], ['created','auto']],
  setting:  [['id','auto'], ['key','str','required'], ['value','str','required']],
  ticket:   [['id','auto'], ['title','str','required'], ['description','str'], ['status','str'], ['priority','int'], ['created','auto']],
  employee: [['id','auto'], ['name','str','required'], ['email','str','required','email'], ['role','str']],
  staff:    [['id','auto'], ['name','str','required'], ['email','str','required','email'], ['role','str']],
  thread:   [['id','auto'], ['title','str','required'], ['body','str','required'], ['author','str','required'], ['created','auto']],
  recipe:   [['id','auto'], ['title','str','required'], ['description','str'], ['ingredients','str'], ['created','auto']],
  inventory:[['id','auto'], ['name','str','required'], ['quantity','int','required'], ['location','str']],
  log:      [['id','auto'], ['action','str','required'], ['detail','str'], ['created','auto']],
  activity: [['id','auto'], ['type','str','required'], ['description','str'], ['created','auto']],
  item:     [['id','auto'], ['name','str','required'], ['created','auto']],
};

function defaultFields(schemaName) {
  const key = schemaName.toLowerCase();
  const preset = SCHEMA_PRESETS[key];
  if (preset) return preset.map(f => ({ name: f[0], type: f[1], modifiers: f.slice(2) }));
  return [
    { name: 'id', type: 'auto', modifiers: [] },
    { name: 'name', type: 'str', modifiers: ['required'] },
    { name: 'created', type: 'auto', modifiers: [] },
  ];
}

// ── Utilities ───────────────────────────────────────────────

function singularize(w) {
  if (w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.endsWith('ses') || w.endsWith('xes') || w.endsWith('zes') || w.endsWith('ches') || w.endsWith('shes')) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && w.length > 3) return w.slice(0, -1);
  return w;
}

function capitalize(w) {
  return w.charAt(0).toUpperCase() + w.slice(1);
}

function pluralize(w) {
  if (w.endsWith('y') && !/[aeiou]y$/i.test(w)) return w.slice(0, -1) + 'ies';
  if (w.endsWith('s') || w.endsWith('x') || w.endsWith('z') || w.endsWith('ch') || w.endsWith('sh')) return w + 'es';
  return w + 's';
}

const RESERVED = new Set([
  'get', 'post', 'put', 'del', 'on', 'in', 'as', 'is', 'isnt', 'if', 'for', 'each', 'while',
  'use', 'fn', 'ret', 'mut', 'pub', 'elif', 'else', 'match', 'try', 'fail', 'server', 'bot',
  'page', 'cli', 'mail', 'db', 'log', 'new', 'not', 'and', 'or', 'then', 'from', 'break',
  'continue', 'throw', 'schema', 'crud', 'auth', 'cors', 'model', 'self', 'test', 'assert',
  'await', 'enum', 'swap', 'repeat', 'until', 'unless', 'extends', 'print', 'static',
  'true', 'false', 'null', 'str', 'int', 'num', 'bool', 'list', 'map', 'any', 'json', 'void', 'auto',
  'search', 'push', 'image', 'csv', 'graphql', 'desktop', 'screen', 'validate', 'prompt',
  'every', 'watch', 'limit', 'env', 'session', 'cookie', 'upload', 'view', 'cache', 'patch',
  'queue', 'job', 'ws', 'sse', 'group', 'storage', 'oauth', 'pay', 'pdf', 'i18n',
]);

function safeName(name) {
  if (RESERVED.has(name.toLowerCase())) return name + 'App';
  return name;
}

function align(rows) {
  if (rows.length === 0) return [];
  const cols = rows[0].length;
  const widths = Array(cols).fill(0);
  for (const row of rows) {
    for (let i = 0; i < Math.min(cols, row.length); i++) {
      widths[i] = Math.max(widths[i], (row[i] || '').length);
    }
  }
  return rows.map(row =>
    row.map((cell, i) => i < cols - 1 ? (cell || '').padEnd(widths[i]) : (cell || '')).join(' ').trimEnd()
  );
}

// ── Instruction Parsing ─────────────────────────────────────

function tokenize(instruction) {
  return instruction
    .replace(/[.,!?;:()'"\[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(w => w.length > 0);
}

function classify(words, raw) {
  const lower = raw.toLowerCase();
  const intents = new Set();
  const mods = {};
  let matchStrength = 0;

  // English keyword matching
  for (const [intent, kws] of Object.entries(INTENT_WORDS)) {
    for (const w of words) {
      const wl = w.toLowerCase();
      if (kws.includes(wl)) { intents.add(intent); matchStrength++; break; }
    }
  }

  // Japanese substring matching
  for (const [intent, kws] of Object.entries(JA_INTENTS)) {
    for (const kw of kws) {
      if (raw.includes(kw)) { intents.add(intent); matchStrength++; break; }
    }
  }

  // Composite detection
  for (const [comp, kws] of Object.entries(COMPOSITE_WORDS)) {
    if (kws.some(k => lower.includes(k))) {
      matchStrength += 2;
      if (comp === 'fullstack') { intents.add('server'); intents.add('schema'); intents.add('crud'); intents.add('auth'); intents.add('database'); }
      if (comp === 'todo')      { intents.add('server'); intents.add('schema'); intents.add('crud'); intents.add('database'); mods.preset = 'todo'; }
      if (comp === 'blog')      { intents.add('server'); intents.add('schema'); intents.add('crud'); intents.add('database'); mods.preset = 'post'; }
      if (comp === 'chat')      { intents.add('server'); intents.add('schema'); intents.add('websocket'); intents.add('database'); mods.preset = 'message'; }
      if (comp === 'shop')      { intents.add('server'); intents.add('schema'); intents.add('crud'); intents.add('auth'); intents.add('database'); mods.preset = 'product'; }
      if (comp === 'board')     { intents.add('server'); intents.add('schema'); intents.add('crud'); intents.add('database'); mods.preset = 'post'; }
    }
  }

  // Platform detection
  for (const [plat, kws] of Object.entries(PLATFORM_WORDS)) {
    if (kws.some(k => lower.includes(k))) mods.platform = plat;
  }

  // DB type detection
  if (lower.includes('sqlite')) mods.dbType = 'sqlite';
  else if (lower.includes('postgres')) mods.dbType = 'postgres';

  // Detect entity-like words (nouns that could be schema names)
  const allKnown = new Set([...Object.values(INTENT_WORDS).flat(), ...Object.values(PLATFORM_WORDS).flat(),
    ...Object.values(COMPOSITE_WORDS).flat()]);
  const hasEntity = words.some(w => {
    const wl = w.toLowerCase();
    return !NOISE.has(wl) && !allKnown.has(wl) && !/^\d+$/.test(wl) && wl.length > 2 && /^[a-z]+s?$/i.test(wl);
  }) || Object.keys(JA_ENTITIES).some(ja => raw.includes(ja));

  // "for X" pattern implies schema + crud
  if (hasEntity && intents.has('server')) {
    intents.add('schema'); intents.add('crud');
  }
  if (lower.includes(' for ') && intents.has('server') && !intents.has('schema')) {
    intents.add('schema'); intents.add('crud');
  }

  // Implicit intent rules
  if (intents.has('crud') && !intents.has('server')) intents.add('server');
  if (intents.has('crud') && !intents.has('schema')) intents.add('schema');
  if (intents.has('auth') && !intents.has('server')) intents.add('server');
  if (intents.has('schema') && intents.has('server')) intents.add('database');
  if (intents.has('bot') && !mods.platform) mods.platform = 'discord';

  // Default fallback: if nothing detected, server + schema
  if (intents.size === 0) {
    intents.add('server'); intents.add('schema'); intents.add('crud'); intents.add('database');
    mods.fallback = true;
  }

  mods.matchStrength = matchStrength;
  return { intents, mods };
}

function extractParams(words, raw, intents, mods) {
  const params = { port: 3000, schemaName: null, fields: [], features: intents, platform: mods.platform || null, dbType: mods.dbType || null, commands: [] };

  // Extract port number
  for (let i = 0; i < words.length; i++) {
    const n = parseInt(words[i]);
    if (!isNaN(n) && n >= 80 && n <= 65535) params.port = n;
    if (words[i].toLowerCase() === 'port' && i + 1 < words.length) {
      const pn = parseInt(words[i + 1]);
      if (!isNaN(pn)) params.port = pn;
    }
  }

  // Extract entity name — Japanese first (longest match wins)
  const jaEntries = Object.entries(JA_ENTITIES).sort((a, b) => b[0].length - a[0].length);
  for (const [ja, en] of jaEntries) {
    if (raw.includes(ja)) { params.schemaName = en; break; }
  }

  // Extract entity name — English (find nouns that aren't keywords)
  if (!params.schemaName) {
    const allKnown = new Set([...Object.values(INTENT_WORDS).flat(), ...Object.values(PLATFORM_WORDS).flat(),
      ...Object.values(COMPOSITE_WORDS).flat()]);
    for (const w of words) {
      const wl = w.toLowerCase();
      if (NOISE.has(wl) || allKnown.has(wl) || /^\d+$/.test(wl) || wl.length <= 2) continue;
      params.schemaName = capitalize(singularize(wl));
      break;
    }
  }

  // Preset override
  if (mods.preset && !params.schemaName) {
    params.schemaName = capitalize(mods.preset);
  }

  // Default schema name
  if (!params.schemaName && intents.has('schema')) params.schemaName = 'Item';

  // Extract fields from "with" clause
  const lower = raw.toLowerCase();
  const withIdx = lower.indexOf(' with ');
  if (withIdx !== -1) {
    const afterWith = lower.slice(withIdx + 6);
    const stopWords = new Set(Object.values(INTENT_WORDS).flat());
    const fieldNames = afterWith
      .split(/[\s,、]+/)
      .map(w => w.replace(/[^a-zA-Z0-9_\-]/g, ''))
      .filter(w => w.length > 1 && !NOISE.has(w) && !stopWords.has(w) && !/^\d+$/.test(w));
    if (fieldNames.length > 0) {
      params.fields = [{ name: 'id', type: 'auto', modifiers: [] }];
      for (const rawName of fieldNames) {
        const name = normalizeField(rawName);
        const type = inferType(name);
        params.fields.push({ name, type, modifiers: inferModifiers(name, type) });
      }
    }
  }

  // Use preset fields if none extracted
  if (params.fields.length === 0 && params.schemaName) {
    params.fields = defaultFields(params.schemaName);
  }

  // Extract bot commands
  const cmdMatch = raw.match(/command[s]?\s+(.+)/i);
  if (cmdMatch) {
    params.commands = cmdMatch[1].split(/[\s,、and]+/).filter(c => c.length > 1).map(c => ({
      trigger: c.startsWith('!') ? c : '!' + c,
      response: `${capitalize(c.replace('!', ''))}!`,
    }));
  }

  return params;
}

// ── Template Engine ─────────────────────────────────────────

function schemaBlock(name, fields) {
  const rows = fields.map(f => [f.name, f.type, ...f.modifiers]);
  const aligned = align(rows);
  return `schema ${name}:\n` + aligned.map(l => '  ' + l).join('\n');
}

function dbBlock(type) {
  if (type === 'sqlite') return 'db.sql "sqlite"';
  if (type === 'postgres') return 'db.sql "postgres"';
  return 'db "data/"';
}

function serverBlock(name, port, sections) {
  return `server ${name} port ${port}:\n` + sections.map(l => '  ' + l).join('\n');
}

function botBlock(platform, commands) {
  const token = platform.toUpperCase() + '_TOKEN';
  const lines = [`bot mybot type "${platform}" token ${token} prefix "!":`];
  if (commands.length === 0) {
    commands = [
      { trigger: '!hello', response: 'Hello!' },
      { trigger: '!help', response: 'Commands: !hello, !help' },
    ];
  }
  for (const cmd of commands) {
    lines.push(`  on "${cmd.trigger}" (msg):`);
    lines.push(`    msg.reply("${cmd.response}")`);
  }
  return lines.join('\n');
}

function cliBlock(name) {
  return `cli ${safeName(name || 'app')}:
  flag "-n" "--name" str "Name"
  flag "-o" "--output" str "Output file"
  run (args):
    log("Name: " + args.name)
    log("Output: " + args.output)`;
}

function testBlock(name) {
  return `test "${name || 'app'} tests":
  assert 1 + 1 == 2
  assert "hello".length == 5
  assert [1, 2, 3].length == 3`;
}

function graphqlBlock() {
  return `graphql "/graphql"`;
}

function pageBlock(title) {
  return `page "index.html":
  h1 "${title || 'Welcome'}"
  p "Built with NAIDE"`;
}

function mailBlock() {
  return `mail "smtp.example.com" 587:
  user SMTP_USER
  pass SMTP_PASS`;
}

// ── Code Composer ───────────────────────────────────────────

function compose(intents, params) {
  const sections = [];
  const schemaName = params.schemaName || 'Item';
  const nameLower = schemaName.toLowerCase();
  const namePlural = pluralize(nameLower);

  if (intents.has('schema') && params.fields.length > 0) {
    sections.push(schemaBlock(schemaName, params.fields));
  }

  if (intents.has('database')) {
    sections.push(dbBlock(params.dbType));
  }

  if (intents.has('server')) {
    const body = [];
    body.push('cors "*"');

    if (intents.has('crud') && intents.has('schema')) {
      body.push(`crud "/api/${namePlural}" ${schemaName}`);
    }

    if (intents.has('auth')) {
      body.push('auth JWT_SECRET:');
      body.push('  protect "/api/*"');
      body.push('  public "/api/auth/*"');
    }

    if (intents.has('websocket')) {
      body.push('');
      body.push('ws "/ws":');
      body.push('  on "message" (data):');
      body.push('    socket.send(data)');
    }

    if (intents.has('ai')) {
      body.push('');
      body.push('post "/api/ask" (req, res):');
      body.push('  str answer = await ai.ask(req.body.prompt)');
      body.push('  ret {answer}');
    }

    body.push('');
    body.push('get "/api/health" (req, res):');
    if (intents.has('schema') && intents.has('crud')) {
      body.push(`  ret {status: "ok", ${namePlural}: ${schemaName}Store.count()}`);
    } else {
      body.push('  ret {status: "ok"}');
    }

    sections.push(serverBlock(safeName(nameLower === 'item' ? 'app' : nameLower), params.port, body));
  }

  if (intents.has('bot')) {
    sections.push(botBlock(params.platform || 'discord', params.commands));
  }

  if (intents.has('cli')) {
    sections.push(cliBlock(nameLower));
  }

  if (intents.has('graphql')) {
    sections.push(graphqlBlock());
  }

  if (intents.has('page')) {
    sections.push(pageBlock(schemaName));
  }

  if (intents.has('mail')) {
    sections.push(mailBlock());
  }

  if (intents.has('test')) {
    sections.push(testBlock(nameLower));
  }

  return sections.join('\n\n') + '\n';
}

// ── Self-Healing Validator ──────────────────────────────────

function validate(code) {
  let current = code;
  let fixed = false;
  const repairs = [];

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const lexer = new Lexer(current);
      const tokens = lexer.tokenize();
      const parser = new Parser(tokens);
      parser.parse();
      return { code: current, valid: true, fixed, repairs };
    } catch (err) {
      const before = current;
      const repair = heal(current, err);
      current = repair.code;
      if (current === before) return { code: current, valid: false, fixed, repairs };
      if (repair.description) repairs.push(repair.description);
      fixed = true;
    }
  }

  return { code: current, valid: false, fixed, repairs };
}

function heal(code, err) {
  const msg = err.message;
  const lines = code.split('\n');
  const lineMatch = msg.match(/line (\d+)/);
  if (!lineMatch) return { code, description: null };

  const lineIdx = parseInt(lineMatch[1]) - 1;
  if (lineIdx < 0 || lineIdx >= lines.length) return { code, description: null };
  const line = lines[lineIdx];

  // Missing colon at end of block header
  if (msg.includes('COLON') || msg.includes('Expected ":"')) {
    if (!line.trimEnd().endsWith(':')) {
      lines[lineIdx] = line.trimEnd() + ':';
      return { code: lines.join('\n'), description: `L${lineIdx + 1}: added missing ':' at end of block header` };
    }
  }

  // Unexpected indent — previous line probably needs a colon
  if (msg.includes('INDENT') && lineIdx > 0) {
    const prev = lines[lineIdx - 1];
    if (!prev.trimEnd().endsWith(':') && !prev.trimEnd().endsWith(',')) {
      lines[lineIdx - 1] = prev.trimEnd() + ':';
      return { code: lines.join('\n'), description: `L${lineIdx}: added ':' to previous line to open block` };
    }
  }

  // Reserved keyword used as identifier — rename it
  const reserved = ['get', 'post', 'put', 'del', 'on', 'in', 'as', 'is', 'log', 'new', 'not', 'and', 'or', 'if', 'for', 'use', 'fn', 'ret', 'mut'];
  if (msg.includes('Unexpected') || msg.includes('Expected IDENT')) {
    for (const kw of reserved) {
      const fieldPattern = new RegExp(`^(\\s+)${kw}(\\s+(?:str|int|num|bool|auto))`, 'm');
      if (fieldPattern.test(line)) {
        lines[lineIdx] = line.replace(fieldPattern, `$1${kw}_field$2`);
        return { code: lines.join('\n'), description: `L${lineIdx + 1}: renamed reserved word '${kw}' → '${kw}_field'` };
      }
    }
  }

  // Unexpected token — try removing the problematic line (non-structural only)
  if (msg.includes('Unexpected') && !line.trim().match(/^(schema|server|bot|cli|page|test|fn|db)\b/)) {
    const removed = line.trim();
    lines.splice(lineIdx, 1);
    return { code: lines.join('\n'), description: `L${lineIdx + 1}: removed problematic line '${removed.slice(0, 40)}'` };
  }

  return { code, description: null };
}

// ── Suggestions ─────────────────────────────────────────────

const KEYWORD_CHEATSHEET = {
  'Intent':    'server, api, rest, bot, cli, page, test, database, ai, crud, auth, websocket, mail, graphql',
  'Composite': 'todo, blog, chat, shop, fullstack, board',
  'Platform':  'discord, slack, telegram, line',
  'DB':        'sqlite, postgres',
  'Japanese':  'サーバー, 認証, ログイン, 会員, CRUD, 管理, データベース, ボット, テスト, ページ',
  'JP Entity': 'ユーザー, 商品, 記事, タスク, 注文, コメント, イベント, 問い合わせ, 通知, 掲示板',
};

function buildSuggestion(mods) {
  if (!mods.fallback && mods.matchStrength >= 1) return null;
  const lines = ['  Hint: use these keywords for better results:'];
  for (const [cat, kws] of Object.entries(KEYWORD_CHEATSHEET)) {
    lines.push(`    ${cat.padEnd(10)} ${kws}`);
  }
  return lines.join('\n');
}

// ── Pre-Processor (for ~~ in source files) ──────────────────

export function expandDirectives(source) {
  const lines = source.split('\n');
  const result = [];
  let expanded = false;

  for (const line of lines) {
    const m = line.match(/^(\s*)~~\s+(?:"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)')\s*$/);
    if (m) {
      const indent = m[1];
      const instruction = m[2] ?? m[3];
      const gen = generate(instruction);
      const genLines = gen.code.trimEnd().split('\n');
      for (const gl of genLines) {
        result.push(indent + gl);
      }
      expanded = true;
    } else {
      result.push(line);
    }
  }

  return { source: result.join('\n'), expanded };
}

// ── Public API ──────────────────────────────────────────────

export function generate(instruction, options = {}) {
  const words = tokenize(instruction);
  const { intents, mods } = classify(words, instruction);
  const params = extractParams(words, instruction, intents, mods);

  if (options.port) params.port = options.port;
  if (options.schemaName) params.schemaName = options.schemaName;
  if (options.fields) params.fields = options.fields;

  let code = compose(intents, params);
  const result = validate(code);

  return {
    code: result.code,
    valid: result.valid,
    fixed: result.fixed,
    repairs: result.repairs,
    intents: [...intents],
    schema: params.schemaName,
    port: params.port,
    suggestion: buildSuggestion(mods),
    fallback: !!mods.fallback,
  };
}
