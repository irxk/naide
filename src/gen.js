import { Lexer } from './lexer.js';
import { Parser } from './parser.js';
import { readFileSync as _readFS, writeFileSync as _writeFS, existsSync as _existsFS } from 'node:fs';

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
  shop:      ['shop', 'ecommerce', 'e-commerce', 'ショップ', 'ストア', '通販', 'ECサイト', 'EC', 'オンラインショップ', '通販サイト'],
  board:     ['board', '掲示板', 'フォーラム', 'BBS', 'bbs'],
  crm:       ['crm', 'CRM', '顧客管理', '顧客管理システム', 'カスタマー管理'],
  inventory: ['inventory', '在庫管理', '倉庫管理', '在庫システム'],
  booking:   ['booking', 'reservation', '予約システム', '予約管理', '予約アプリ', '予約サイト'],
  sns:       ['sns', 'SNS', 'ソーシャル', 'social', 'social-media', 'ソーシャルメディア'],
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

// ── Relationship Detection ─────────────────────────────────

const PARENT_CHILD = {
  User:     ['Post', 'Comment', 'Order', 'Message', 'Review', 'Task', 'Notification', 'File',
             'Payment', 'Ticket', 'Note', 'Reservation', 'Activity', 'Log', 'Thread', 'Recipe'],
  Category: ['Product', 'Post', 'Item'],
  Product:  ['Order', 'Review', 'Inventory'],
  Post:     ['Comment', 'Review'],
  Project:  ['Task', 'Ticket'],
  Team:     ['Employee', 'Staff', 'Project'],
  Order:    ['Payment'],
  Event:    ['Reservation'],
};

function detectRelationships(entities) {
  const rels = [];
  const names = entities.map(e => e.name);
  for (let i = 0; i < names.length; i++) {
    for (let j = 0; j < names.length; j++) {
      if (i === j) continue;
      const children = PARENT_CHILD[names[i]];
      if (children && children.includes(names[j])) {
        rels.push({ parent: names[i], child: names[j], fk: names[i].toLowerCase() + '_id' });
      }
    }
  }
  return rels;
}

function applyRelationships(entities, relationships) {
  for (const rel of relationships) {
    const child = entities.find(e => e.name === rel.child);
    if (child && !child.fields.some(f => f.name === rel.fk)) {
      const insertIdx = child.fields.findIndex(f => f.type !== 'auto' || f.name !== 'id');
      const fkField = { name: rel.fk, type: 'int', modifiers: ['required'] };
      if (insertIdx > 0) child.fields.splice(insertIdx, 0, fkField);
      else child.fields.push(fkField);
    }
  }
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

  // Composite detection (match both lowercase and original for mixed JP/EN keywords)
  for (const [comp, kws] of Object.entries(COMPOSITE_WORDS)) {
    if (kws.some(k => lower.includes(k.toLowerCase()) || raw.includes(k))) {
      matchStrength += 2;
      if (comp === 'fullstack') { intents.add('server'); intents.add('schema'); intents.add('crud'); intents.add('auth'); intents.add('database'); }
      if (comp === 'todo')      { intents.add('server'); intents.add('schema'); intents.add('crud'); intents.add('database'); mods.preset = 'todo'; }
      if (comp === 'blog')      { intents.add('server'); intents.add('schema'); intents.add('crud'); intents.add('database'); mods.preset = 'post'; }
      if (comp === 'chat')      { intents.add('server'); intents.add('schema'); intents.add('websocket'); intents.add('database'); mods.preset = 'message'; }
      if (comp === 'shop')      { intents.add('server'); intents.add('schema'); intents.add('crud'); intents.add('auth'); intents.add('database'); mods.preset = 'product'; mods.multiEntity = ['User', 'Product', 'Order']; }
      if (comp === 'board')     { intents.add('server'); intents.add('schema'); intents.add('crud'); intents.add('database'); mods.preset = 'post'; }
      if (comp === 'crm')       { intents.add('server'); intents.add('schema'); intents.add('crud'); intents.add('auth'); intents.add('database'); mods.multiEntity = ['Customer', 'Contact', 'Note']; }
      if (comp === 'inventory') { intents.add('server'); intents.add('schema'); intents.add('crud'); intents.add('database'); mods.multiEntity = ['Product', 'Inventory']; }
      if (comp === 'booking')   { intents.add('server'); intents.add('schema'); intents.add('crud'); intents.add('auth'); intents.add('database'); mods.multiEntity = ['User', 'Reservation']; }
      if (comp === 'sns')       { intents.add('server'); intents.add('schema'); intents.add('crud'); intents.add('auth'); intents.add('websocket'); intents.add('database'); mods.multiEntity = ['User', 'Post', 'Comment']; }
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

  // Complex NL phrase detection
  if (/(?:users?\s+can\s+(?:comment|post|review|write)|コメントできる|投稿できる|レビューできる)/i.test(raw)) {
    intents.add('auth'); intents.add('crud');
  }
  if (/(?:admin.*(?:delete|manage|moderate|ban)|管理者.*(?:削除|管理|モデレート))/i.test(raw)) {
    intents.add('auth');
    mods.needsAdmin = true;
  }
  if (/(?:upload|file\s+upload|画像.*アップ|ファイル.*アップ)/i.test(raw)) {
    intents.add('crud');
  }
  if (/(?:search|検索|フィルタ|filter|sort|ソート)/i.test(raw)) {
    intents.add('crud');
  }
  if (/(?:notification|通知|push|プッシュ|alert|アラート)/i.test(raw) && !intents.has('mail')) {
    intents.add('websocket');
  }
  if (/(?:deploy|デプロイ|docker|コンテナ|container)/i.test(raw)) {
    mods.needsDocker = true;
  }
  if (/(?:pagina|ページネーション|ページ送り|一覧表示)/i.test(raw)) {
    intents.add('crud');
  }
  if (/(?:seed|初期データ|サンプルデータ|テストデータ|ダミーデータ)/i.test(raw)) {
    mods.needsSeed = true;
  }

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
  const params = { port: 3000, schemaName: null, fields: [], entities: [], relationships: [],
    features: intents, platform: mods.platform || null, dbType: mods.dbType || null, commands: [] };

  // Extract port number
  for (let i = 0; i < words.length; i++) {
    const n = parseInt(words[i]);
    if (!isNaN(n) && n >= 80 && n <= 65535) params.port = n;
    if (words[i].toLowerCase() === 'port' && i + 1 < words.length) {
      const pn = parseInt(words[i + 1]);
      if (!isNaN(pn)) params.port = pn;
    }
  }

  // ── Multi-entity extraction ──
  const entityNames = [];

  // Japanese entities (longest match first, collect ALL matches)
  const jaEntries = Object.entries(JA_ENTITIES).sort((a, b) => b[0].length - a[0].length);
  const jaUsed = new Set();
  for (const [ja, en] of jaEntries) {
    if (raw.includes(ja) && !jaUsed.has(en)) {
      entityNames.push(en);
      jaUsed.add(en);
    }
  }

  // English entities: extract nouns from the full instruction, splitting on "and" / ","
  if (entityNames.length === 0) {
    const allKnown = new Set([...Object.values(INTENT_WORDS).flat(), ...Object.values(PLATFORM_WORDS).flat(),
      ...Object.values(COMPOSITE_WORDS).flat()]);
    const lower = raw.toLowerCase();
    const segments = lower.split(/\s+(?:and|&)\s+|,\s*/);
    for (const seg of segments) {
      const segWords = seg.trim().split(/\s+/).filter(w => w !== 'with');
      for (const w of segWords) {
        const wl = w.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!wl || NOISE.has(wl) || allKnown.has(wl) || /^\d+$/.test(wl) || wl.length <= 2) continue;
        const name = capitalize(singularize(wl));
        if (!entityNames.includes(name)) entityNames.push(name);
        break;
      }
    }
  }

  // Composite multi-entity presets (shop, crm, booking, sns, etc.)
  if (mods.multiEntity && entityNames.length <= 1) {
    for (const e of mods.multiEntity) {
      if (!entityNames.includes(e)) entityNames.push(e);
    }
  }

  // Preset override
  if (mods.preset && entityNames.length === 0) {
    entityNames.push(capitalize(mods.preset));
  }

  // Default
  if (entityNames.length === 0 && intents.has('schema')) entityNames.push('Item');

  // Primary entity (backward compat)
  params.schemaName = entityNames[0] || null;

  // Extract fields from "with" clause (applies to primary entity)
  // Only treat words after "with" as fields if they look like field names (not entity names or intent keywords)
  const lower = raw.toLowerCase();
  let primaryFields = [];
  const withIdx = lower.indexOf(' with ');
  if (withIdx !== -1) {
    const afterWith = lower.slice(withIdx + 6);
    const primaryIntents = new Set(['server', 'api', 'rest', 'bot', 'cli', 'page', 'test', 'database',
      'auth', 'crud', 'websocket', 'mail', 'graphql', 'sqlite', 'postgres']);
    const entityLike = new Set(entityNames.map(e => e.toLowerCase()));
    const entityLikePlural = new Set(entityNames.map(e => pluralize(e.toLowerCase())));
    const candidateWords = afterWith
      .split(/[\s,、]+/)
      .map(w => w.replace(/[^a-zA-Z0-9_\-]/g, ''))
      .filter(w => w.length > 1 && !NOISE.has(w) && !primaryIntents.has(w) && !/^\d+$/.test(w)
        && !entityLike.has(w) && !entityLikePlural.has(w) && w !== 'and');
    // Only use as fields if they look like actual field names (not entity names)
    const knownFieldish = new Set([...Object.keys(FIELD_SYNONYMS), ...Object.keys(FIELD_TYPES).flatMap(k => FIELD_TYPES[k])]);
    const hasFieldNames = candidateWords.some(w => knownFieldish.has(normalizeField(w)));
    if (candidateWords.length > 0 && hasFieldNames) {
      primaryFields = [{ name: 'id', type: 'auto', modifiers: [] }];
      for (const rawName of candidateWords) {
        const name = normalizeField(rawName);
        const type = inferType(name);
        primaryFields.push({ name, type, modifiers: inferModifiers(name, type) });
      }
    }
  }

  // Build entities array
  for (let i = 0; i < entityNames.length; i++) {
    const name = entityNames[i];
    const fields = (i === 0 && primaryFields.length > 0) ? primaryFields : defaultFields(name);
    params.entities.push({ name, fields });
  }

  // Backward compat: primary entity fields
  params.fields = params.entities.length > 0 ? params.entities[0].fields : [];

  // Detect relationships between entities
  if (params.entities.length > 1) {
    params.relationships = detectRelationships(params.entities);
    applyRelationships(params.entities, params.relationships);
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

function entityTestBlock(entity) {
  const name = entity.name;
  const lower = name.toLowerCase();
  const plural = pluralize(lower);
  const store = name + 'Store';
  const requiredFields = entity.fields.filter(f => f.modifiers.includes('required') && f.type !== 'auto');
  const sampleObj = requiredFields.map(f => {
    if (f.type === 'int') return `${f.name}: 1`;
    if (f.type === 'bool') return `${f.name}: true`;
    return `${f.name}: "test"`;
  }).join(', ');

  return `test "${lower} CRUD":
  any created = ${store}.create({${sampleObj}})
  assert created.id

  any found = ${store}.find(created.id)
  assert found.id == created.id

  list all = ${store}.all()
  assert all.length > 0

  ${store}.remove(created.id)
  any deleted = ${store}.find(created.id)
  assert not deleted`;
}

function nestedRouteBlock(parent, child, fk) {
  const parentLower = parent.toLowerCase();
  const childLower = child.toLowerCase();
  const childPlural = pluralize(childLower);
  const childStore = child + 'Store';
  return [
    `get "/api/${pluralize(parentLower)}/:${fk.replace('_id', 'Id')}/${childPlural}" (req, res):`,
    `  list items = ${childStore}.findAll("${fk}", req.params.${fk.replace('_id', 'Id')})`,
    `  ret items`,
  ];
}

function paginatedListBlock(entity) {
  const lower = entity.name.toLowerCase();
  const plural = pluralize(lower);
  const store = entity.name + 'Store';
  return [
    `get "/api/${plural}" (req, res):`,
    `  int page = req.query.page || 1`,
    `  int limit = req.query.limit || 20`,
    `  str search = req.query.search || ""`,
    `  list all = ${store}.all()`,
    `  if search:`,
    `    all = all.filter((item) => JSON.stringify(item).includes(search))`,
    `  int total = all.length`,
    `  int start = (page - 1) * limit`,
    `  list items = all.slice(start, start + limit)`,
    `  ret {items, total, page, limit}`,
  ];
}

function seedBlock(entities) {
  const lines = ['fn seed():'];
  for (const entity of entities) {
    const store = entity.name + 'Store';
    const seen = new Set();
    const sampleFields = [];
    for (const f of entity.fields) {
      if (f.type === 'auto' || seen.has(f.name)) continue;
      seen.add(f.name);
      if (f.name === 'password') { sampleFields.push('password: "hashed_demo"'); continue; }
      if (!f.modifiers.includes('required') && !f.name.endsWith('_id')) continue;
      if (f.name.endsWith('_id')) sampleFields.push(`${f.name}: 1`);
      else if (f.type === 'int') sampleFields.push(`${f.name}: ${f.name === 'price' ? 1000 : f.name === 'total' ? 2500 : 1}`);
      else if (f.type === 'bool') sampleFields.push(`${f.name}: false`);
      else if (f.name === 'email') sampleFields.push(`${f.name}: "demo@example.com"`);
      else sampleFields.push(`${f.name}: "Sample ${entity.name}"`);
    }
    lines.push(`  ${store}.create({${sampleFields.join(', ')}})`);
  }
  lines.push('  log("Seed data inserted")');
  return lines.join('\n');
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

// ── Middleware & Utility Templates ──────────────────────────

function utilityFunctions(intents) {
  const fns = [];
  if (intents.has('server')) {
    fns.push(`fn ok(any data, any meta):
  ret {ok: true, data, error: null, meta}`);
    fns.push(`fn err(str message, int code):
  ret {ok: false, data: null, error: message, code}`);
    fns.push(`fn sanitize(str input):
  ret input.replace("<", "&lt;").replace(">", "&gt;").replace("'", "&#39;")`);
  }
  return fns;
}

function softDeleteRoutes(entity) {
  const lower = entity.name.toLowerCase();
  const plural = pluralize(lower);
  const store = entity.name + 'Store';
  return [
    `del "/api/${plural}/:id/soft" (req, res):`,
    `  ${store}.update(req.params.id, {deleted: true})`,
    `  ret ok({archived: true}, null)`,
    ``,
    `put "/api/${plural}/:id/restore" (req, res):`,
    `  ${store}.update(req.params.id, {deleted: false})`,
    `  ret ok({restored: true}, null)`,
  ];
}

function batchRoutes(entity) {
  const lower = entity.name.toLowerCase();
  const plural = pluralize(lower);
  const store = entity.name + 'Store';
  return [
    `post "/api/${plural}/batch" (req, res):`,
    `  list results = []`,
    `  each item in req.body.items:`,
    `    any created = ${store}.create(item)`,
    `    results.push(created)`,
    `  ret ok({created: results.length, items: results}, null)`,
    ``,
    `del "/api/${plural}/batch" (req, res):`,
    `  each id in req.body.ids:`,
    `    ${store}.remove(id)`,
    `  ret ok({deleted: req.body.ids.length}, null)`,
  ];
}

function uploadRoute() {
  return [
    `post "/api/upload" (req, res):`,
    `  any file = req.files.file`,
    `  if not file:`,
    `    ret.status(400) err("No file provided", 400)`,
    `  str path = "uploads/" + file.name`,
    `  file.mv(path)`,
    `  ret ok({path, name: file.name, size: file.size}, null)`,
  ];
}

function auditSchema() {
  return `schema AuditLog:
  id        auto
  action    str required
  entity    str required
  entity_id int
  user_id   int
  detail    str
  created   auto`;
}

function auditFn() {
  return `fn auditLog(str action, str entity, int entityId, int userId):
  AuditLogStore.create({action, entity, entity_id: entityId, user_id: userId})`;
}

function webhookRoute() {
  return [
    `post "/api/webhooks" (req, res):`,
    `  str event = req.body.event`,
    `  any payload = req.body.payload`,
    `  log("Webhook received: " + event)`,
    `  ret ok({received: true, event}, null)`,
    ``,
    `get "/api/webhooks/health" (req, res):`,
    `  ret ok({status: "listening"}, null)`,
  ];
}

function serverMiddlewareHints(intents, params) {
  const hints = [];
  hints.push('# ── Middleware (install if needed) ──');
  hints.push('# npm install express-rate-limit  →  rateLimit({windowMs: 900000, max: 100})');
  hints.push('# npm install helmet             →  helmet() for security headers');
  hints.push('# npm install compression        →  compression() for gzip');
  if (intents.has('auth')) {
    hints.push('# npm install cors               →  cors({origin: "https://yourdomain.com"})');
  }
  return hints.join('\n');
}

function openApiSpec(entities, intents, params, relationships) {
  const paths = {};
  for (const entity of entities) {
    const plural = pluralize(entity.name.toLowerCase());
    const requiredFields = entity.fields.filter(f => f.modifiers.includes('required') && f.type !== 'auto');
    const properties = {};
    for (const f of entity.fields) {
      properties[f.name] = { type: f.type === 'auto' ? 'integer' : f.type === 'int' ? 'integer' : f.type === 'bool' ? 'boolean' : 'string' };
    }
    paths[`/api/${plural}`] = {
      get: { summary: `List ${plural} (paginated)`, parameters: [
        { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
        { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
        { name: 'search', in: 'query', schema: { type: 'string' } },
      ], responses: { '200': { description: `List of ${plural}` } } },
      post: { summary: `Create ${entity.name.toLowerCase()}`, requestBody: { content: { 'application/json': { schema: {
        type: 'object', required: requiredFields.map(f => f.name),
        properties: Object.fromEntries(requiredFields.map(f => [f.name, properties[f.name]])),
      } } } }, responses: { '201': { description: 'Created' } } },
    };
    paths[`/api/${plural}/{id}`] = {
      get: { summary: `Get ${entity.name.toLowerCase()} by ID`, responses: { '200': { description: entity.name } } },
      put: { summary: `Update ${entity.name.toLowerCase()}`, responses: { '200': { description: 'Updated' } } },
      delete: { summary: `Delete ${entity.name.toLowerCase()}`, responses: { '200': { description: 'Deleted' } } },
    };
    paths[`/api/${plural}/batch`] = {
      post: { summary: `Batch create ${plural}`, responses: { '200': { description: 'Batch created' } } },
      delete: { summary: `Batch delete ${plural}`, responses: { '200': { description: 'Batch deleted' } } },
    };
    paths[`/api/${plural}/{id}/soft`] = {
      delete: { summary: `Soft delete ${entity.name.toLowerCase()}`, responses: { '200': { description: 'Archived' } } },
    };
    paths[`/api/${plural}/{id}/restore`] = {
      put: { summary: `Restore ${entity.name.toLowerCase()}`, responses: { '200': { description: 'Restored' } } },
    };
  }
  for (const rel of relationships) {
    const parentPlural = pluralize(rel.parent.toLowerCase());
    const childPlural = pluralize(rel.child.toLowerCase());
    paths[`/api/${parentPlural}/{${rel.fk.replace('_id', 'Id')}}/${childPlural}`] = {
      get: { summary: `${rel.child}s by ${rel.parent}`, responses: { '200': { description: `List of ${childPlural}` } } },
    };
  }
  if (intents.has('auth')) {
    paths['/api/auth/register'] = { post: { summary: 'Register', responses: { '200': { description: 'Token + user' } } } };
    paths['/api/auth/login'] = { post: { summary: 'Login', responses: { '200': { description: 'Token + user' } } } };
    paths['/api/auth/me'] = { get: { summary: 'Current user', security: [{ bearerAuth: [] }], responses: { '200': { description: 'User' } } } };
  }
  paths['/api/health'] = { get: { summary: 'Health check', responses: { '200': { description: 'Status' } } } };
  paths['/api/upload'] = { post: { summary: 'Upload file', responses: { '200': { description: 'File info' } } } };

  const spec = {
    openapi: '3.0.3',
    info: { title: (entities[0]?.name || 'App') + ' API', version: '1.0.0', description: 'Generated by NAIDE Agent Coder' },
    servers: [{ url: `http://localhost:${params.port}` }],
    paths,
  };
  if (intents.has('auth')) {
    spec.components = { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } };
  }
  return spec;
}

function adminPage(entities, intents) {
  const lines = [];
  lines.push('<!DOCTYPE html>');
  lines.push('<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">');
  lines.push('<title>Admin Dashboard</title>');
  lines.push('<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#f5f5f5;padding:2rem}');
  lines.push('h1{margin-bottom:1rem}.card{background:#fff;border-radius:8px;padding:1.5rem;margin-bottom:1rem;box-shadow:0 1px 3px rgba(0,0,0,.1)}');
  lines.push('table{width:100%;border-collapse:collapse}th,td{padding:.5rem;text-align:left;border-bottom:1px solid #eee}');
  lines.push('th{background:#f9f9f9;font-weight:600}button{padding:.4rem 1rem;border:none;border-radius:4px;cursor:pointer;background:#2563eb;color:#fff}');
  lines.push('button:hover{background:#1d4ed8}button.danger{background:#dc2626}button.danger:hover{background:#b91c1c}');
  lines.push('input,select{padding:.4rem;border:1px solid #ddd;border-radius:4px;margin-right:.5rem}');
  lines.push('.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1rem;margin-bottom:1.5rem}');
  lines.push('.stat{background:#fff;border-radius:8px;padding:1.5rem;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.1)}');
  lines.push('.stat h3{font-size:2rem;color:#2563eb}.stat p{color:#666;margin-top:.5rem}');
  lines.push('#toast{position:fixed;top:1rem;right:1rem;background:#22c55e;color:#fff;padding:.8rem 1.5rem;border-radius:8px;display:none}');
  lines.push('</style></head><body>');
  lines.push('<h1>Admin Dashboard</h1>');
  lines.push('<div id="toast"></div>');
  lines.push('<div class="stats" id="stats"></div>');
  for (const entity of entities) {
    const lower = entity.name.toLowerCase();
    const plural = pluralize(lower);
    lines.push(`<div class="card"><h2>${entity.name}s</h2>`);
    lines.push(`<div style="margin:1rem 0"><input id="${lower}-search" placeholder="Search..." oninput="${lower}Load()">`);
    lines.push(`<button onclick="${lower}Load()">Refresh</button> <button onclick="${lower}ShowForm()">+ New</button></div>`);
    lines.push(`<div id="${lower}-form" style="display:none;margin:1rem 0;padding:1rem;background:#f9f9f9;border-radius:4px">`);
    for (const f of entity.fields) {
      if (f.type === 'auto') continue;
      const inputType = f.type === 'int' ? 'number' : f.type === 'bool' ? 'checkbox' : f.name === 'password' ? 'password' : f.name === 'email' ? 'email' : 'text';
      if (f.type === 'bool') {
        lines.push(`<label><input type="checkbox" id="${lower}-${f.name}"> ${f.name}</label> `);
      } else {
        lines.push(`<input type="${inputType}" id="${lower}-${f.name}" placeholder="${f.name}${f.modifiers.includes('required') ? ' *' : ''}">`);
      }
    }
    lines.push(`<button onclick="${lower}Create()">Save</button> <button onclick="document.getElementById('${lower}-form').style.display='none'" class="danger">Cancel</button></div>`);
    lines.push(`<table><thead><tr>${entity.fields.map(f => `<th>${f.name}</th>`).join('')}<th>Actions</th></tr></thead>`);
    lines.push(`<tbody id="${lower}-table"></tbody></table></div>`);
  }
  lines.push('<script>');
  lines.push('const API="";function toast(m){const t=document.getElementById("toast");t.textContent=m;t.style.display="block";setTimeout(()=>t.style.display="none",2000)}');
  lines.push('async function loadStats(){try{const r=await fetch(API+"/api/health");const d=await r.json();const s=document.getElementById("stats");');
  lines.push('s.innerHTML=Object.entries(d).filter(([k])=>k!=="status").map(([k,v])=>`<div class="stat"><h3>${v}</h3><p>${k}</p></div>`).join("")}catch(e){}}');
  for (const entity of entities) {
    const lower = entity.name.toLowerCase();
    const plural = pluralize(lower);
    const fields = entity.fields.filter(f => f.type !== 'auto');
    lines.push(`async function ${lower}Load(){const s=document.getElementById("${lower}-search").value;`);
    lines.push(`const r=await fetch(API+"/api/${plural}?search="+s);const d=await r.json();const items=d.items||d;`);
    lines.push(`document.getElementById("${lower}-table").innerHTML=items.map(i=>"<tr>${entity.fields.map(f => `<td>"+i.${f.name}+"`).join('')}<td>"+`);
    lines.push(`"<button onclick=\\"${lower}Del("+i.id+")\\">Del</button></td></tr>").join("")}`);
    lines.push(`function ${lower}ShowForm(){document.getElementById("${lower}-form").style.display="block"}`);
    lines.push(`async function ${lower}Create(){const body={${fields.map(f => {
      if (f.type === 'bool') return `${f.name}:document.getElementById("${lower}-${f.name}").checked`;
      if (f.type === 'int') return `${f.name}:+document.getElementById("${lower}-${f.name}").value`;
      return `${f.name}:document.getElementById("${lower}-${f.name}").value`;
    }).join(',')}};`);
    lines.push(`await fetch(API+"/api/${plural}",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});`);
    lines.push(`document.getElementById("${lower}-form").style.display="none";toast("Created!");${lower}Load();loadStats()}`);
    lines.push(`async function ${lower}Del(id){if(!confirm("Delete?"))return;await fetch(API+"/api/${plural}/"+id,{method:"DELETE"});toast("Deleted!");${lower}Load();loadStats()}`);
  }
  lines.push(`loadStats();${entities.map(e => pluralize(e.name.toLowerCase()).replace(/^./, c => c) && e.name.toLowerCase() + 'Load()').join(';')}`);
  lines.push('</script></body></html>');
  return lines.join('\n');
}

function apiClientCode(entities, intents, port) {
  const lines = [];
  lines.push('// Auto-generated API client — NAIDE Agent Coder');
  lines.push(`const BASE = typeof window !== 'undefined' ? '' : 'http://localhost:${port}';`);
  lines.push('let _token = null;');
  lines.push('');
  lines.push('function headers() {');
  lines.push("  const h = { 'Content-Type': 'application/json' };");
  lines.push("  if (_token) h['Authorization'] = 'Bearer ' + _token;");
  lines.push('  return h;');
  lines.push('}');
  lines.push('');
  lines.push('async function api(method, path, body) {');
  lines.push('  const opts = { method, headers: headers() };');
  lines.push('  if (body) opts.body = JSON.stringify(body);');
  lines.push('  const res = await fetch(BASE + path, opts);');
  lines.push('  return res.json();');
  lines.push('}');
  lines.push('');
  if (intents.has('auth')) {
    lines.push('export async function register(name, email, password) {');
    lines.push("  const r = await api('POST', '/api/auth/register', { name, email, password });");
    lines.push('  if (r.token) _token = r.token;');
    lines.push('  return r;');
    lines.push('}');
    lines.push('');
    lines.push('export async function login(email, password) {');
    lines.push("  const r = await api('POST', '/api/auth/login', { email, password });");
    lines.push('  if (r.token) _token = r.token;');
    lines.push('  return r;');
    lines.push('}');
    lines.push('');
    lines.push("export async function me() { return api('GET', '/api/auth/me'); }");
    lines.push('export function setToken(t) { _token = t; }');
    lines.push('');
  }
  for (const entity of entities) {
    const lower = entity.name.toLowerCase();
    const plural = pluralize(lower);
    const Name = entity.name;
    lines.push(`// ${Name}`);
    lines.push(`export async function list${Name}s(page = 1, limit = 20, search = '') {`);
    lines.push(`  return api('GET', \`/api/${plural}?page=\${page}&limit=\${limit}&search=\${search}\`);`);
    lines.push('}');
    lines.push(`export async function get${Name}(id) { return api('GET', \`/api/${plural}/\${id}\`); }`);
    lines.push(`export async function create${Name}(data) { return api('POST', '/api/${plural}', data); }`);
    lines.push(`export async function update${Name}(id, data) { return api('PUT', \`/api/${plural}/\${id}\`, data); }`);
    lines.push(`export async function remove${Name}(id) { return api('DELETE', \`/api/${plural}/\${id}\`); }`);
    lines.push(`export async function archive${Name}(id) { return api('DELETE', \`/api/${plural}/\${id}/soft\`); }`);
    lines.push(`export async function restore${Name}(id) { return api('PUT', \`/api/${plural}/\${id}/restore\`); }`);
    lines.push(`export async function batchCreate${Name}s(items) { return api('POST', '/api/${plural}/batch', { items }); }`);
    lines.push(`export async function batchRemove${Name}s(ids) { return api('DELETE', '/api/${plural}/batch', { ids }); }`);
    lines.push('');
  }
  lines.push("export async function upload(file) { const fd = new FormData(); fd.append('file', file); const r = await fetch(BASE + '/api/upload', { method: 'POST', headers: _token ? { Authorization: 'Bearer ' + _token } : {}, body: fd }); return r.json(); }");
  lines.push("export async function health() { return api('GET', '/api/health'); }");
  return lines.join('\n') + '\n';
}

// ── Auth Route Templates ────────────────────────────────────

function authRoutesBlock(userEntity) {
  const store = userEntity + 'Store';
  return [
    `post "/api/auth/register" (req, res):`,
    `  str hashed = await hash(req.body.password)`,
    `  any user = ${store}.create({name: req.body.name, email: req.body.email, password: hashed})`,
    `  str token = jwt.sign({id: user.id}, JWT_SECRET)`,
    `  ret {token, user: {id: user.id, name: user.name, email: user.email}}`,
    ``,
    `post "/api/auth/login" (req, res):`,
    `  any user = ${store}.findBy("email", req.body.email)`,
    `  if not user:`,
    `    ret.status(401) {error: "Invalid credentials"}`,
    `  bool valid = await verify(req.body.password, user.password)`,
    `  if not valid:`,
    `    ret.status(401) {error: "Invalid credentials"}`,
    `  str token = jwt.sign({id: user.id}, JWT_SECRET)`,
    `  ret {token, user: {id: user.id, name: user.name, email: user.email}}`,
    ``,
    `get "/api/auth/me" (req, res):`,
    `  ret {user: req.user}`,
  ];
}

function envLines(intents, params) {
  const lines = [];
  if (intents.has('auth')) lines.push('# env JWT_SECRET "change-me-in-production"');
  if (params.dbType === 'postgres') lines.push('# env DATABASE_URL "postgres://localhost:5432/app"');
  if (intents.has('mail')) {
    lines.push('# env SMTP_HOST "smtp.example.com"');
    lines.push('# env SMTP_USER "user@example.com"');
    lines.push('# env SMTP_PASS "password"');
  }
  if (intents.has('bot')) {
    const token = (params.platform || 'discord').toUpperCase() + '_TOKEN';
    lines.push(`# env ${token} "your-bot-token"`);
  }
  if (intents.has('ai')) lines.push('# env OPENAI_API_KEY "your-api-key"');
  return lines;
}

// ── Code Composer ───────────────────────────────────────────

function compose(intents, params) {
  const sections = [];
  const entities = params.entities.length > 0 ? params.entities : [{ name: params.schemaName || 'Item', fields: params.fields }];
  const primaryName = entities[0].name;
  const primaryLower = primaryName.toLowerCase();
  const relationships = params.relationships || [];
  const hasAuth = intents.has('auth');
  const userEntity = entities.find(e => ['User', 'Customer', 'Employee', 'Staff'].includes(e.name));

  // Middleware hints
  if (intents.has('server')) {
    sections.push(serverMiddlewareHints(intents, params));
  }

  // Env hints
  const env = envLines(intents, params);
  if (env.length > 0) sections.push(env.join('\n'));

  // Utility functions (envelope, sanitize)
  const utils = utilityFunctions(intents);
  if (utils.length > 0) sections.push(...utils);

  // Schema blocks for all entities (add role + deleted fields)
  if (intents.has('schema')) {
    for (const entity of entities) {
      if (entity.fields.length > 0) {
        if (hasAuth && userEntity && entity.name === userEntity.name && !entity.fields.some(f => f.name === 'role')) {
          entity.fields.push({ name: 'role', type: 'str', modifiers: [] });
        }
        if (intents.has('crud') && !entity.fields.some(f => f.name === 'deleted')) {
          entity.fields.push({ name: 'deleted', type: 'bool', modifiers: [] });
        }
        sections.push(schemaBlock(entity.name, entity.fields));
      }
    }
    // Audit log schema when auth is present
    if (hasAuth) {
      sections.push(auditSchema());
    }
  }

  if (intents.has('database')) {
    sections.push(dbBlock(params.dbType));
  }

  if (intents.has('server')) {
    const body = [];
    body.push('cors "*"');

    // CRUD for each entity
    if (intents.has('crud') && intents.has('schema')) {
      for (const entity of entities) {
        const ep = pluralize(entity.name.toLowerCase());
        body.push(`crud "/api/${ep}" ${entity.name}`);
      }
    }

    // Auth: full routes + role-based access
    if (hasAuth) {
      body.push('auth JWT_SECRET:');
      body.push('  protect "/api/*"');
      body.push('  public "/api/auth/*"');
      body.push('  public "/api/health"');
      if (userEntity) {
        body.push('');
        body.push(...authRoutesBlock(userEntity.name));
        // Role-based admin check route
        body.push('');
        body.push('get "/api/admin/stats" (req, res):');
        body.push('  if req.user.role != "admin":');
        body.push('    ret.status(403) {error: "Admin access required"}');
        if (entities.length > 0) {
          const counts = entities.map(e => `${pluralize(e.name.toLowerCase())}: ${e.name}Store.count()`).join(', ');
          body.push(`  ret {${counts}}`);
        } else {
          body.push('  ret {status: "ok"}');
        }
      }
    }

    // Paginated list endpoints (override default CRUD list)
    if (intents.has('crud') && intents.has('schema')) {
      body.push('');
      for (const entity of entities) {
        body.push(...paginatedListBlock(entity));
        body.push('');
      }
    }

    // Nested routes for relationships
    for (const rel of relationships) {
      body.push(...nestedRouteBlock(rel.parent, rel.child, rel.fk));
      body.push('');
    }

    // WebSocket
    if (intents.has('websocket')) {
      body.push('ws "/ws":');
      body.push('  on "connection" (socket):');
      body.push('    log("Client connected")');
      body.push('  on "message" (data, socket):');
      body.push('    socket.send(data)');
      body.push('  on "close" (socket):');
      body.push('    log("Client disconnected")');
      body.push('');
    }

    // AI endpoint
    if (intents.has('ai')) {
      body.push('post "/api/ask" (req, res):');
      body.push('  if not req.body.prompt:');
      body.push('    ret.status(400) {error: "prompt is required"}');
      body.push('  str answer = await ai.ask(req.body.prompt)');
      body.push('  ret {answer}');
      body.push('');
    }

    // Soft delete + batch for each entity
    if (intents.has('crud') && intents.has('schema')) {
      for (const entity of entities) {
        body.push(...softDeleteRoutes(entity));
        body.push('');
        body.push(...batchRoutes(entity));
        body.push('');
      }
    }

    // File upload
    if (intents.has('crud')) {
      body.push(...uploadRoute());
      body.push('');
    }

    // Webhook
    if (intents.has('server')) {
      body.push(...webhookRoute());
      body.push('');
    }

    // Health check
    body.push('get "/api/health" (req, res):');
    if (intents.has('schema') && intents.has('crud') && entities.length > 0) {
      const counts = entities.map(e => `${pluralize(e.name.toLowerCase())}: ${e.name}Store.count()`).join(', ');
      body.push(`  ret {status: "ok", ${counts}}`);
    } else {
      body.push('  ret {status: "ok"}');
    }

    const serverName = safeName(primaryLower === 'item' ? 'app' : primaryLower);
    sections.push(serverBlock(serverName, params.port, body));
  }

  // Seed function
  if (intents.has('database') && intents.has('schema') && entities.length > 0) {
    sections.push(seedBlock(entities));
  }

  // Audit log function
  if (hasAuth) {
    sections.push(auditFn());
  }

  if (intents.has('bot')) {
    sections.push(botBlock(params.platform || 'discord', params.commands));
  }

  if (intents.has('cli')) {
    sections.push(cliBlock(primaryLower));
  }

  if (intents.has('graphql')) {
    sections.push(graphqlBlock());
  }

  if (intents.has('page')) {
    sections.push(pageBlock(primaryName));
  }

  if (intents.has('mail')) {
    sections.push(mailBlock());
  }

  // Auto-generate entity tests when test intent or when entities exist
  if (intents.has('test') || (intents.has('schema') && intents.has('crud') && entities.length > 0)) {
    for (const entity of entities) {
      sections.push(entityTestBlock(entity));
    }
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
  'Composite': 'todo, blog, chat, shop, fullstack, board, crm, inventory, booking, sns',
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

// ── Project Generator ──────────────────────────────────────

export function generateProject(instruction, options = {}) {
  const result = generate(instruction, options);
  const files = [];
  const intents = new Set(result.intents);
  const entities = result.entities || [];
  const primaryName = (entities[0] || 'app').toLowerCase();
  const projectName = safeName(primaryName) + '-app';

  // Main app file
  files.push({ path: 'app.naide', content: result.code });

  // Package.json
  const deps = {};
  if (intents.has('server'))    deps.express = '^4.21.0';
  if (intents.has('websocket')) deps.ws = '^8.18.0';
  if (intents.has('auth')) {
    deps.jsonwebtoken = '^9.0.2';
    deps.bcryptjs = '^2.4.3';
  }
  if (intents.has('mail'))      deps.nodemailer = '^6.9.0';
  if (result.analysis.entities.some(() => true)) deps.naider = '^1.21.0';
  const pkg = {
    name: projectName,
    version: '1.0.0',
    type: 'module',
    scripts: {
      dev: 'naide app.naide',
      build: 'naide app.naide --emit -o dist/app.mjs',
      start: 'node dist/app.mjs',
      test: 'naide test app.naide',
      seed: 'naide app.naide --run-seed',
    },
    dependencies: deps,
  };
  files.push({ path: 'package.json', content: JSON.stringify(pkg, null, 2) + '\n' });

  // .env file
  const envL = [];
  envL.push(`PORT=${result.port}`);
  if (intents.has('auth')) envL.push('JWT_SECRET=change-me-in-production');
  if (intents.has('bot'))  envL.push(`${(options.platform || 'DISCORD').toUpperCase()}_TOKEN=your-bot-token`);
  if (intents.has('mail')) {
    envL.push('SMTP_HOST=smtp.example.com');
    envL.push('SMTP_USER=user@example.com');
    envL.push('SMTP_PASS=password');
  }
  if (intents.has('ai'))   envL.push('OPENAI_API_KEY=your-api-key');
  files.push({ path: '.env', content: envL.join('\n') + '\n' });

  // .gitignore
  files.push({ path: '.gitignore', content: 'node_modules/\ndist/\ndata/\n.env\n*.mjs\n' });

  // Dockerfile
  if (intents.has('server')) {
    const dockerfile = `FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
RUN npm install -g naider
COPY . .
RUN naide app.naide --emit -o dist/app.mjs
EXPOSE ${result.port}
CMD ["node", "dist/app.mjs"]
`;
    files.push({ path: 'Dockerfile', content: dockerfile });

    files.push({ path: '.dockerignore', content: 'node_modules\ndist\ndata\n.env\n.git\n' });
  }

  // README
  const readmeLines = [`# ${projectName}\n`];
  readmeLines.push(`Generated by NAIDE Agent Coder (~~)\n`);
  readmeLines.push(`## Features\n`);
  for (const step of result.analysis.plan) readmeLines.push(`- ${step}`);
  if (entities.length > 0) {
    readmeLines.push(`\n## Entities\n`);
    for (const e of result.analysis.entities) readmeLines.push(`- **${e.name}** (${e.fieldCount} fields)`);
  }
  if (result.analysis.relationships.length > 0) {
    readmeLines.push(`\n## Relationships\n`);
    for (const r of result.analysis.relationships) readmeLines.push(`- ${r.parent} → ${r.child} (${r.fk})`);
  }
  readmeLines.push(`\n## Quick Start\n`);
  readmeLines.push('```bash');
  readmeLines.push('npm install');
  readmeLines.push('npm run dev');
  readmeLines.push('```\n');
  if (intents.has('server')) {
    readmeLines.push(`## API Endpoints\n`);
    readmeLines.push(`- \`GET /api/health\` — Health check`);
    for (const e of entities) {
      const ep = pluralize(e.toLowerCase());
      readmeLines.push(`- \`GET /api/${ep}?page=1&limit=20&search=\` — List ${ep} (paginated)`);
      readmeLines.push(`- \`POST /api/${ep}\` — Create ${e.toLowerCase()}`);
      readmeLines.push(`- \`GET /api/${ep}/:id\` — Get ${e.toLowerCase()}`);
      readmeLines.push(`- \`PUT /api/${ep}/:id\` — Update ${e.toLowerCase()}`);
      readmeLines.push(`- \`DELETE /api/${ep}/:id\` — Delete ${e.toLowerCase()}`);
      readmeLines.push(`- \`DELETE /api/${ep}/:id/soft\` — Soft delete ${e.toLowerCase()}`);
      readmeLines.push(`- \`PUT /api/${ep}/:id/restore\` — Restore ${e.toLowerCase()}`);
      readmeLines.push(`- \`POST /api/${ep}/batch\` — Batch create ${ep}`);
      readmeLines.push(`- \`DELETE /api/${ep}/batch\` — Batch delete ${ep}`);
    }
    for (const r of result.analysis.relationships) {
      const parentPlural = pluralize(r.parent.toLowerCase());
      const childPlural = pluralize(r.child.toLowerCase());
      readmeLines.push(`- \`GET /api/${parentPlural}/:id/${childPlural}\` — ${r.child}s by ${r.parent}`);
    }
    readmeLines.push(`- \`POST /api/upload\` — File upload`);
    readmeLines.push(`- \`POST /api/webhooks\` — Register webhook`);
    readmeLines.push(`- \`GET /api/webhooks/health\` — Webhook health`);
    if (intents.has('auth')) {
      readmeLines.push(`- \`POST /api/auth/register\` — Register`);
      readmeLines.push(`- \`POST /api/auth/login\` — Login`);
      readmeLines.push(`- \`GET /api/auth/me\` — Current user`);
      readmeLines.push(`- \`GET /api/admin/stats\` — Admin stats (role: admin)`);
    }
  }
  if (intents.has('server')) {
    readmeLines.push(`\n## Docker\n`);
    readmeLines.push('```bash');
    readmeLines.push(`docker build -t ${projectName} .`);
    readmeLines.push(`docker run -p ${result.port}:${result.port} --env-file .env ${projectName}`);
    readmeLines.push('```');
  }
  files.push({ path: 'README.md', content: readmeLines.join('\n') + '\n' });

  // Build full entity objects for generators
  const entityObjs = entities.map(name => {
    const preset = SCHEMA_PRESETS[name.toLowerCase()];
    const fields = preset ? preset.map(f => ({ name: f[0], type: f[1], modifiers: f.slice(2) })) : defaultFields(name);
    if (!fields.some(f => f.name === 'deleted')) fields.push({ name: 'deleted', type: 'bool', modifiers: [] });
    return { name, fields };
  });

  // OpenAPI spec
  if (intents.has('server') && entityObjs.length > 0) {
    const spec = openApiSpec(entityObjs, intents, { port: result.port }, result.relationships || []);
    files.push({ path: 'openapi.json', content: JSON.stringify(spec, null, 2) + '\n' });
  }

  // Admin dashboard
  if (intents.has('server') && entityObjs.length > 0) {
    files.push({ path: 'admin.html', content: adminPage(entityObjs, intents) });
  }

  // API client
  if (intents.has('server')) {
    files.push({ path: 'client.mjs', content: apiClientCode(entityObjs, intents, result.port) });
  }

  return { ...result, files };
}

// ── Project Update Mode ───────────────────────────────────

export function updateProject(projectDir, instruction, options = {}) {
  const appPath = projectDir + '/app.naide';
  const existing = _existsFS(appPath) ? _readFS(appPath, 'utf-8') : '';

  const existingState = existing ? parseExistingProject(existing) : { entities: [], intents: [], port: 3000 };
  const newResult = generate(instruction, options);
  const newEntities = (newResult.entities || []).filter(e => !existingState.entities.includes(e));

  const allEntities = [...existingState.entities, ...newEntities];
  const combinedIntents = [...new Set([...existingState.intents, ...newResult.intents])];
  const extras = [];
  if (combinedIntents.includes('auth')) extras.push('auth');
  if (combinedIntents.includes('websocket')) extras.push('websocket');
  if (combinedIntents.includes('database')) extras.push('database');
  const fullInstruction = 'REST API for ' + allEntities.join(' and ') + (extras.length ? ' with ' + extras.join(' and ') : '');

  const combined = generate(fullInstruction, options);
  const finalCode = combined.code;

  const files = [];
  files.push({ path: 'app.naide', content: finalCode });

  const intents = new Set(combined.intents);
  const entities = combined.entities || allEntities;
  const relationships = combined.relationships || detectRelationships(entities);

  const primaryName = (entities[0] || 'app').toLowerCase();
  const projectName = safeName(primaryName) + '-app';
  const port = existingState.port || combined.port || 3000;

  const deps = {};
  if (intents.has('server'))    deps.express = '^4.21.0';
  if (intents.has('websocket')) deps.ws = '^8.18.0';
  if (intents.has('auth')) {
    deps.jsonwebtoken = '^9.0.2';
    deps.bcryptjs = '^2.4.3';
  }
  if (intents.has('mail'))      deps.nodemailer = '^6.9.0';
  if (entities.length > 0)     deps.naider = '^1.21.0';

  const existingPkgPath = projectDir + '/package.json';
  let pkg;
  if (_existsFS(existingPkgPath)) {
    pkg = JSON.parse(_readFS(existingPkgPath, 'utf-8'));
    pkg.dependencies = { ...pkg.dependencies, ...deps };
  } else {
    pkg = {
      name: projectName, version: '1.0.0', type: 'module',
      scripts: { dev: 'naide app.naide', build: 'naide app.naide --emit -o dist/app.mjs',
        start: 'node dist/app.mjs', test: 'naide test app.naide', seed: 'naide app.naide --run-seed' },
      dependencies: deps,
    };
  }
  files.push({ path: 'package.json', content: JSON.stringify(pkg, null, 2) + '\n' });

  const envL = [];
  envL.push(`PORT=${port}`);
  if (intents.has('auth')) envL.push('JWT_SECRET=change-me-in-production');
  if (intents.has('bot'))  envL.push(`${(options.platform || 'DISCORD').toUpperCase()}_TOKEN=your-bot-token`);
  if (intents.has('mail')) { envL.push('SMTP_HOST=smtp.example.com'); envL.push('SMTP_USER=user@example.com'); envL.push('SMTP_PASS=password'); }
  if (intents.has('ai'))   envL.push('OPENAI_API_KEY=your-api-key');
  const existingEnvPath = projectDir + '/.env';
  if (_existsFS(existingEnvPath)) {
    const existingEnv = _readFS(existingEnvPath, 'utf-8');
    const existingKeys = new Set(existingEnv.split('\n').map(l => l.split('=')[0]).filter(Boolean));
    const newEnvLines = envL.filter(l => !existingKeys.has(l.split('=')[0]));
    if (newEnvLines.length > 0) {
      files.push({ path: '.env', content: existingEnv.trimEnd() + '\n' + newEnvLines.join('\n') + '\n' });
    }
  } else {
    files.push({ path: '.env', content: envL.join('\n') + '\n' });
  }

  files.push({ path: '.gitignore', content: 'node_modules/\ndist/\ndata/\n.env\n*.mjs\n' });

  if (intents.has('server')) {
    files.push({ path: 'Dockerfile', content: `FROM node:22-slim\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --omit=dev\nRUN npm install -g naider\nCOPY . .\nRUN naide app.naide --emit -o dist/app.mjs\nEXPOSE ${port}\nCMD ["node", "dist/app.mjs"]\n` });
    files.push({ path: '.dockerignore', content: 'node_modules\ndist\ndata\n.env\n.git\n' });
  }

  const readmeLines = [`# ${projectName}\n`];
  readmeLines.push(`Generated by NAIDE Agent Coder (~~)\n`);
  readmeLines.push(`## Entities\n`);
  for (const e of entities) {
    const preset = SCHEMA_PRESETS[e.toLowerCase()];
    const fc = preset ? preset.length : 3;
    readmeLines.push(`- **${e}** (${fc} fields)`);
  }
  if (relationships.length > 0) {
    readmeLines.push(`\n## Relationships\n`);
    for (const r of relationships) readmeLines.push(`- ${r.parent} → ${r.child} (${r.fk})`);
  }
  readmeLines.push(`\n## Quick Start\n`);
  readmeLines.push('```bash\nnpm install\nnpm run dev\n```\n');
  if (intents.has('server')) {
    readmeLines.push(`## API Endpoints\n`);
    readmeLines.push(`- \`GET /api/health\` — Health check`);
    for (const e of entities) {
      const ep = pluralize(e.toLowerCase());
      readmeLines.push(`- \`GET /api/${ep}?page=1&limit=20&search=\` — List ${ep} (paginated)`);
      readmeLines.push(`- \`POST /api/${ep}\` — Create ${e.toLowerCase()}`);
      readmeLines.push(`- \`GET /api/${ep}/:id\` — Get ${e.toLowerCase()}`);
      readmeLines.push(`- \`PUT /api/${ep}/:id\` — Update ${e.toLowerCase()}`);
      readmeLines.push(`- \`DELETE /api/${ep}/:id\` — Delete ${e.toLowerCase()}`);
      readmeLines.push(`- \`DELETE /api/${ep}/:id/soft\` — Soft delete`);
      readmeLines.push(`- \`PUT /api/${ep}/:id/restore\` — Restore`);
      readmeLines.push(`- \`POST /api/${ep}/batch\` — Batch create`);
      readmeLines.push(`- \`DELETE /api/${ep}/batch\` — Batch delete`);
    }
    for (const r of relationships) {
      readmeLines.push(`- \`GET /api/${pluralize(r.parent.toLowerCase())}/:id/${pluralize(r.child.toLowerCase())}\` — ${r.child}s by ${r.parent}`);
    }
    readmeLines.push(`- \`POST /api/upload\` — File upload`);
    readmeLines.push(`- \`POST /api/webhooks\` — Register webhook`);
    if (intents.has('auth')) {
      readmeLines.push(`- \`POST /api/auth/register\` — Register`);
      readmeLines.push(`- \`POST /api/auth/login\` — Login`);
      readmeLines.push(`- \`GET /api/auth/me\` — Current user`);
      readmeLines.push(`- \`GET /api/admin/stats\` — Admin stats`);
    }
  }
  if (intents.has('server')) {
    readmeLines.push(`\n## Docker\n`);
    readmeLines.push('```bash');
    readmeLines.push(`docker build -t ${projectName} .`);
    readmeLines.push(`docker run -p ${port}:${port} --env-file .env ${projectName}`);
    readmeLines.push('```');
  }
  files.push({ path: 'README.md', content: readmeLines.join('\n') + '\n' });

  const entityObjs = entities.map(name => {
    const preset = SCHEMA_PRESETS[name.toLowerCase()];
    const fields = preset ? preset.map(f => ({ name: f[0], type: f[1], modifiers: f.slice(2) })) : defaultFields(name);
    if (!fields.some(f => f.name === 'deleted')) fields.push({ name: 'deleted', type: 'bool', modifiers: [] });
    return { name, fields };
  });

  if (intents.has('server') && entityObjs.length > 0) {
    files.push({ path: 'openapi.json', content: JSON.stringify(openApiSpec(entityObjs, intents, { port }, relationships), null, 2) + '\n' });
    files.push({ path: 'admin.html', content: adminPage(entityObjs, intents) });
  }
  if (intents.has('server')) {
    files.push({ path: 'client.mjs', content: apiClientCode(entityObjs, intents, port) });
  }

  const added = existing
    ? entities.filter(e => !existing.includes(`schema ${e}`))
    : entities;
  const analysis = {
    instruction,
    entities: entityObjs.map(e => ({ name: e.name, fieldCount: e.fields.length })),
    relationships,
    plan: [],
    added,
  };
  if (added.length > 0) analysis.plan.push(`Added: ${added.join(', ')}`);
  if (existing) analysis.plan.push('Merged with existing app.naide');
  analysis.plan.push(`Total entities: ${entities.length}`);
  analysis.plan.push(`Supporting files regenerated`);

  return {
    code: finalCode, valid: combined.valid, fixed: combined.fixed, repairs: combined.repairs,
    intents: [...intents], entities, relationships, port,
    files, analysis, action: existing ? 'updated' : 'created',
  };
}

function parseExistingProject(code) {
  const lines = code.split('\n');
  const entities = [];
  const intents = new Set();
  let port = 3000;

  for (const line of lines) {
    const sm = line.match(/^schema\s+(\w+)\s*:/);
    if (sm && sm[1] !== 'AuditLog') {
      entities.push(sm[1]);
      intents.add('schema');
    }
    if (line.match(/^server\s/))    intents.add('server');
    if (line.match(/\bcrud\b/))     intents.add('crud');
    if (line.match(/\bauth\b/))     intents.add('auth');
    if (line.match(/\bdb\b/))       intents.add('database');
    if (line.match(/\bws\b/))       intents.add('websocket');
    if (line.match(/\bbot\b/))      intents.add('bot');
    const pm = line.match(/port\s+(\d+)/);
    if (pm) port = parseInt(pm[1], 10);
  }

  return { entities, intents: [...intents], port };
}

// ── File Write Mode ────────────────────────────────────────

export function writeToFile(filePath, instruction, options = {}) {
  const result = generate(instruction, options);
  const code = result.code;

  if (!_existsFS(filePath)) {
    _writeFS(filePath, code, 'utf-8');
    return { ...result, action: 'created', path: filePath };
  }

  const existing = _readFS(filePath, 'utf-8');
  const mode = options.mode || 'append';

  if (mode === 'replace') {
    _writeFS(filePath, code, 'utf-8');
    return { ...result, action: 'replaced', path: filePath };
  }

  // Append mode: merge intelligently
  const merged = mergeCode(existing, code);
  const validated = validate(merged);
  _writeFS(filePath, validated.code, 'utf-8');
  return { ...result, code: validated.code, valid: validated.valid, fixed: validated.fixed,
    repairs: validated.repairs, action: 'merged', path: filePath };
}

function mergeCode(existing, generated) {
  const existingLines = existing.split('\n');
  const generatedLines = generated.split('\n');

  const existingSchemas = new Set();
  const existingServers = new Set();
  for (const line of existingLines) {
    const schemaMatch = line.match(/^schema\s+(\w+)\s*:/);
    if (schemaMatch) existingSchemas.add(schemaMatch[1]);
    const serverMatch = line.match(/^server\s+(\w+)\s/);
    if (serverMatch) existingServers.add(serverMatch[1]);
  }

  // Filter out duplicate top-level blocks from generated
  const filteredLines = [];
  let skipBlock = false;
  let blockIndent = -1;
  for (let i = 0; i < generatedLines.length; i++) {
    const line = generatedLines[i];
    const schemaMatch = line.match(/^schema\s+(\w+)\s*:/);
    const serverMatch = line.match(/^server\s+(\w+)\s/);

    if (schemaMatch && existingSchemas.has(schemaMatch[1])) {
      skipBlock = true;
      blockIndent = 0;
      continue;
    }
    if (serverMatch && existingServers.has(serverMatch[1])) {
      // For server blocks, extract only new routes
      skipBlock = true;
      blockIndent = 0;
      continue;
    }

    if (skipBlock) {
      const indent = line.match(/^(\s*)/)[1].length;
      if (line.trim() === '' || indent > blockIndent) continue;
      skipBlock = false;
    }

    filteredLines.push(line);
  }

  const newCode = filteredLines.join('\n').trim();
  if (!newCode) return existing;

  return existing.trimEnd() + '\n\n' + newCode + '\n';
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

// ── Analysis Builder ───────────────────────────────────────

function buildAnalysis(instruction, intents, params) {
  const plan = [];

  if (params.entities.length > 0) {
    for (const e of params.entities) {
      plan.push(`Schema "${e.name}" (${e.fields.map(f => f.name).join(', ')})`);
    }
  }

  if (params.relationships.length > 0) {
    for (const r of params.relationships) {
      plan.push(`Relation: ${r.parent} → ${r.child} (${r.fk})`);
    }
  }

  if (intents.has('database')) plan.push(`Database: ${params.dbType || 'file-based'}`);
  if (intents.has('server'))   plan.push(`Server on port ${params.port}`);
  if (intents.has('crud'))     plan.push(`CRUD endpoints for ${params.entities.map(e => pluralize(e.name.toLowerCase())).join(', ')} (paginated)`);
  if (intents.has('auth'))     plan.push('Auth: JWT + register/login/me + role-based admin');
  if (params.relationships.length > 0) plan.push(`Nested routes: ${params.relationships.map(r => `/${pluralize(r.parent.toLowerCase())}/:id/${pluralize(r.child.toLowerCase())}`).join(', ')}`);
  if (intents.has('websocket'))plan.push('WebSocket: real-time messaging');
  if (intents.has('ai'))       plan.push('AI endpoint: /api/ask');
  if (intents.has('bot'))      plan.push(`Bot: ${params.platform || 'discord'}`);
  if (intents.has('mail'))     plan.push('Mail: SMTP configuration');
  if (intents.has('graphql'))  plan.push('GraphQL endpoint');
  if (intents.has('page'))     plan.push('Page: HTML generation');
  if (intents.has('cli'))      plan.push('CLI app with flags');
  if (intents.has('database') && intents.has('schema')) plan.push('Seed: sample data function');
  plan.push(`Tests: ${params.entities.length} entity CRUD test suites`);

  return {
    instruction,
    entities: params.entities.map(e => ({ name: e.name, fieldCount: e.fields.length })),
    relationships: params.relationships,
    features: [...intents],
    plan,
  };
}

// ── Public API ──────────────────────────────────────────────

export function generate(instruction, options = {}) {
  const words = tokenize(instruction);
  const { intents, mods } = classify(words, instruction);
  const params = extractParams(words, instruction, intents, mods);

  if (options.port) params.port = options.port;
  if (options.schemaName) {
    params.schemaName = options.schemaName;
    if (params.entities.length > 0) params.entities[0].name = options.schemaName;
  }
  if (options.fields) {
    params.fields = options.fields;
    if (params.entities.length > 0) params.entities[0].fields = options.fields;
  }

  let code = compose(intents, params);
  const result = validate(code);
  const analysis = buildAnalysis(instruction, intents, params);

  return {
    code: result.code,
    valid: result.valid,
    fixed: result.fixed,
    repairs: result.repairs,
    intents: [...intents],
    schema: params.schemaName,
    entities: params.entities.map(e => e.name),
    relationships: params.relationships,
    port: params.port,
    suggestion: buildSuggestion(mods),
    fallback: !!mods.fallback,
    analysis,
  };
}
