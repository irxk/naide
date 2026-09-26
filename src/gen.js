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
  game:      ['game', 'arcade', 'play', 'score', 'highscore', 'player', 'level', 'gameover'],
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
  game:      ['ゲーム', 'アーケード', 'プレイ', 'スコア', 'ハイスコア', 'ゲームオーバー'],
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

const GAME_TYPES = {
  tapping:   ['tapping', 'tap', 'clicker', 'click', 'タップ', 'タッピング', 'クリッカー', '連打'],
  quiz:      ['quiz', 'trivia', 'question', 'クイズ', 'トリビア', '問題'],
  memory:    ['memory', 'matching', 'pairs', 'card', '神経衰弱', 'メモリー', 'カードゲーム'],
  typing:    ['typing', 'タイピング', 'タイプ'],
  reaction:  ['reaction', 'reflex', 'リアクション', '反射', '反応'],
  snake:     ['snake', 'スネーク', 'ヘビ'],
  breakout:  ['breakout', 'brick', 'block', 'ブロック崩し', 'ブレイクアウト'],
};

const NOISE = new Set([
  'a', 'an', 'the', 'for', 'with', 'and', 'or', 'on', 'at', 'to', 'of', 'in', 'by',
  'that', 'which', 'this', 'it', 'its', 'my', 'is', 'are', 'has', 'have', 'do', 'does',
  'make', 'create', 'build', 'generate', 'add', 'implement', 'simple', 'basic', 'new', 'remove', 'delete', 'drop',
  'please', 'want', 'need', 'like', 'just', 'some', 'using', 'use', 'based',
  'setup', 'set', 'up', 'get', 'should', 'can', 'could', 'would',
  'game', 'play', 'player', 'score', 'level', 'arcade', 'highscore',
  'tapping', 'tap', 'clicker', 'click', 'quiz', 'trivia', 'memory', 'matching', 'typing',
  'reaction', 'reflex', 'snake', 'breakout', 'brick', 'block', 'pong', 'puzzle',
  'の', 'を', 'に', 'で', 'は', 'が', 'と', 'も', 'から', 'まで', 'より', 'って',
  'な', 'ような', 'みたいな', 'っぽい', 'ような感じ',
  '作って', '作る', '作成', '生成', '追加', '実装', 'ください', 'して', 'つけて',
  '付き', '付きの', 'ある', 'ない', 'する', 'できる', 'ほしい', 'したい',
  '機能', '仕組み', 'もの', 'こと', 'やつ', '感じ', '的な',
  '簡単な', 'シンプルな', '基本的な', '新しい',
]);

function detectGameType(words, raw) {
  const lower = raw.toLowerCase();
  for (const [type, kws] of Object.entries(GAME_TYPES)) {
    for (const kw of kws) {
      if (lower.includes(kw)) return type;
    }
  }
  return 'tapping';
}

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

// ── Many-to-Many Relationships ────────────────────────────

const MANY_TO_MANY = {
  'User-Product': { junction: 'Favorite', fkLeft: 'user_id', fkRight: 'product_id' },
  'User-Team':    { junction: 'TeamMember', fkLeft: 'user_id', fkRight: 'team_id' },
  'Post-Category':{ junction: 'PostTag', fkLeft: 'post_id', fkRight: 'category_id' },
  'Product-Category':{ junction: 'ProductCategory', fkLeft: 'product_id', fkRight: 'category_id' },
  'User-Group':   { junction: 'GroupMember', fkLeft: 'user_id', fkRight: 'group_id' },
};

function detectManyToMany(entityNames) {
  const rels = [];
  for (let i = 0; i < entityNames.length; i++) {
    for (let j = i + 1; j < entityNames.length; j++) {
      const key1 = entityNames[i] + '-' + entityNames[j];
      const key2 = entityNames[j] + '-' + entityNames[i];
      const match = MANY_TO_MANY[key1] || MANY_TO_MANY[key2];
      if (match) rels.push({ left: entityNames[i], right: entityNames[j], ...match });
    }
  }
  return rels;
}

function junctionSchemaBlock(rel) {
  return `schema ${rel.junction}:\n  id        auto\n  ${rel.fkLeft.padEnd(10)}int required\n  ${rel.fkRight.padEnd(10)}int required\n  created   auto`;
}

function manyToManyRoutes(rel) {
  const leftPlural = pluralize(rel.left.toLowerCase());
  const rightPlural = pluralize(rel.right.toLowerCase());
  const store = rel.junction + 'Store';
  return [
    `get "/api/${leftPlural}/:id/${rightPlural}" (req, res):`,
    `  list links = ${store}.findAll("${rel.fkLeft}", req.params.id)`,
    `  ret links`,
    ``,
    `post "/api/${leftPlural}/:id/${rightPlural}" (req, res):`,
    `  any link = ${store}.create({${rel.fkLeft}: req.params.id, ${rel.fkRight}: req.body.${rel.fkRight}})`,
    `  ret ok(link, null)`,
    ``,
    `del "/api/${leftPlural}/:id/${rightPlural}/:linkId" (req, res):`,
    `  ${store}.remove(req.params.linkId)`,
    `  ret ok({removed: true}, null)`,
    ``,
    `get "/api/${rightPlural}/:id/${leftPlural}" (req, res):`,
    `  list links = ${store}.findAll("${rel.fkRight}", req.params.id)`,
    `  ret links`,
  ];
}

// ── Enum Fields ───────────────────────────────────────────

const ENUM_VALUES = {
  status:     ['pending', 'active', 'completed', 'cancelled'],
  priority:   ['low', 'medium', 'high', 'critical'],
  role:       ['user', 'admin', 'moderator'],
  visibility: ['public', 'private', 'unlisted'],
};

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

  // Entity removal detection (B8)
  if (/(?:remove|delete|drop|取り除|削除)\s+/i.test(raw)) {
    mods.removal = true;
  }

  // API versioning detection (B13)
  if (/(?:version|v\d|versioning|バージョン)/i.test(raw)) {
    mods.apiVersion = 'v1';
  }

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

  // Game intent: don't auto-cascade into server/crud unless explicitly requested
  if (intents.has('game') && !intents.has('server') && !intents.has('crud')) {
    mods.gameType = detectGameType(words, raw);
    mods.isGame = true;
  }

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

  if (mods.isGame) {
    params.gameType = mods.gameType;
    params.gameTitle = raw.replace(/\b(make|create|build|generate|simple|basic|new|a|an|the)\b/gi, '').trim();
    return params;
  }

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
    params.m2mRelationships = detectManyToMany(params.entities.map(e => e.name));
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
    `  int page = req.query.page or 1`,
    `  int limit = req.query.limit or 20`,
    `  str search = req.query.search or ""`,
    `  str sortBy = req.query.sort or "id"`,
    `  str order = req.query.order or "desc"`,
    `  mut list rows = ${store}.all()`,
    `  if search:`,
    `    rows = rows.filter((item) => JSON.stringify(item).toLowerCase().includes(search.toLowerCase()))`,
    `  each key in Object.keys(req.query):`,
    `    if key.endsWith("_gte"):`,
    `      str field = key.replace("_gte", "")`,
    `      rows = rows.filter((item) => item[field] >= Number(req.query[key]))`,
    `    if key.endsWith("_lte"):`,
    `      str field = key.replace("_lte", "")`,
    `      rows = rows.filter((item) => item[field] <= Number(req.query[key]))`,
    `    if key.endsWith("_eq"):`,
    `      str field = key.replace("_eq", "")`,
    `      rows = rows.filter((item) => String(item[field]) == req.query[key])`,
    `  if order == "asc":`,
    `    rows = rows.sort((a, b) => String(a[sortBy]).localeCompare(String(b[sortBy])))`,
    `  else:`,
    `    rows = rows.sort((a, b) => String(b[sortBy]).localeCompare(String(a[sortBy])))`,
    `  int total = rows.length`,
    `  int offset = page - 1`,
    `  int start = offset * limit`,
    `  list items = rows.slice(start, start + limit)`,
    `  ret {items, total, page, limit, sort: sortBy, order}`,
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
        { name: 'sort', in: 'query', schema: { type: 'string' }, description: 'Field to sort by' },
        { name: 'order', in: 'query', schema: { type: 'string', enum: ['asc','desc'], default: 'asc' } },
      ], responses: { '200': { description: `List of ${plural} with pagination` } } },
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
    paths['/api/auth/register'] = { post: { summary: 'Register', requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['email','password'], properties: { email:{type:'string'}, password:{type:'string'}, name:{type:'string'} } } } } }, responses: { '200': { description: 'Token + user' }, '400': { description: 'Validation error' } } } };
    paths['/api/auth/login'] = { post: { summary: 'Login', requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['email','password'], properties: { email:{type:'string'}, password:{type:'string'} } } } } }, responses: { '200': { description: 'Token + user' }, '401': { description: 'Invalid credentials' } } } };
    paths['/api/auth/me'] = { get: { summary: 'Current user', security: [{ bearerAuth: [] }], responses: { '200': { description: 'User' } } } };
    paths['/api/auth/forgot-password'] = { post: { summary: 'Request password reset', requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['email'], properties: { email:{type:'string'} } } } } }, responses: { '200': { description: 'Reset token sent' } } } };
    paths['/api/auth/reset-password'] = { post: { summary: 'Reset password with token', requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['token','password'], properties: { token:{type:'string'}, password:{type:'string'} } } } } }, responses: { '200': { description: 'Password reset' }, '400': { description: 'Invalid token' } } } };
    paths['/api/auth/change-password'] = { post: { summary: 'Change password (authenticated)', security: [{ bearerAuth: [] }], requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['oldPassword','newPassword'], properties: { oldPassword:{type:'string'}, newPassword:{type:'string'} } } } } }, responses: { '200': { description: 'Password changed' }, '401': { description: 'Wrong password' } } } };
  }
  const m2m = detectManyToMany(entities.map(e => e.name));
  for (const rel of m2m) {
    const lp = pluralize(rel.left.toLowerCase());
    const rp = pluralize(rel.right.toLowerCase());
    paths[`/api/${lp}/{id}/${rp}`] = { get: { summary: `${rel.right}s for ${rel.left}`, responses: { '200': { description: `List of ${rp}` } } } };
    paths[`/api/${rp}/{id}/${lp}`] = { get: { summary: `${rel.left}s for ${rel.right}`, responses: { '200': { description: `List of ${lp}` } } } };
    paths[`/api/${rel.junction.toLowerCase()}`] = { post: { summary: `Link ${rel.left}↔${rel.right}`, responses: { '201': { description: 'Linked' } } }, delete: { summary: `Unlink ${rel.left}↔${rel.right}`, responses: { '200': { description: 'Unlinked' } } } };
  }
  paths['/api/health'] = { get: { summary: 'Health check', responses: { '200': { description: 'Status' } } } };
  paths['/api/upload'] = { post: { summary: 'Upload file', responses: { '200': { description: 'File info' } } } };
  paths['/docs'] = { get: { summary: 'Swagger UI documentation', responses: { '200': { description: 'HTML page' } } } };

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

// ── Input Validation (A4) ──────────────────────────────────

function validationBlock(entity) {
  const lines = [];
  lines.push(`fn validate${entity.name}(any body):`);
  lines.push(`  list errors = []`);
  for (const f of entity.fields) {
    if (f.type === 'auto') continue;
    if (f.modifiers.includes('required')) {
      lines.push(`  if not body.${f.name}:`);
      lines.push(`    errors.push("${f.name} is required")`);
    }
    if (f.modifiers.includes('email')) {
      lines.push(`  if body.${f.name} and not body.${f.name}.includes("@"):`);
      lines.push(`    errors.push("${f.name} must be a valid email")`);
    }
    const minMod = f.modifiers.find(m => m.startsWith('min('));
    if (minMod) {
      const minVal = minMod.match(/\d+/)[0];
      if (f.type === 'str') {
        lines.push(`  if body.${f.name} and body.${f.name}.length < ${minVal}:`);
        lines.push(`    errors.push("${f.name} must be at least ${minVal} characters")`);
      }
    }
    const maxMod = f.modifiers.find(m => m.startsWith('max('));
    if (maxMod) {
      const maxVal = maxMod.match(/\d+/)[0];
      if (f.type === 'str') {
        lines.push(`  if body.${f.name} and body.${f.name}.length > ${maxVal}:`);
        lines.push(`    errors.push("${f.name} must be at most ${maxVal} characters")`);
      }
    }
    if (ENUM_VALUES[f.name]) {
      const vals = ENUM_VALUES[f.name].map(v => `"${v}"`).join(', ');
      lines.push(`  if body.${f.name} and not [${vals}].includes(body.${f.name}):`);
      lines.push(`    errors.push("${f.name} must be one of: ${ENUM_VALUES[f.name].join(', ')}")`);
    }
  }
  lines.push(`  ret errors`);
  return lines.join('\n');
}

function validatedCreateRoute(entity) {
  const lower = entity.name.toLowerCase();
  const plural = pluralize(lower);
  const store = entity.name + 'Store';
  return [
    `post "/api/${plural}" (req, res):`,
    `  list errors = validate${entity.name}(req.body)`,
    `  if errors.length > 0:`,
    `    ret.status(400) {ok: false, errors}`,
    `  any created = ${store}.create(req.body)`,
    `  ret.status(201) ok(created, null)`,
    ``,
    `put "/api/${plural}/:id" (req, res):`,
    `  list errors = validate${entity.name}(req.body)`,
    `  if errors.length > 0:`,
    `    ret.status(400) {ok: false, errors}`,
    `  any updated = ${store}.update(req.params.id, req.body)`,
    `  ret ok(updated, null)`,
  ];
}

// ── Swagger UI Route (A5) ──────────────────────────────────

function swaggerUIRoute() {
  return [
    `get "/docs" (req, res):`,
    `  str swaggerOpts = JSON.stringify({url:"/api/openapi.json",dom_id:"#swagger-ui"})`,
    `  str html = "<!DOCTYPE html><html><head><title>API Docs</title><link rel=stylesheet href=https://unpkg.com/swagger-ui-dist/swagger-ui.css></head><body><div id=swagger-ui></div><script src=https://unpkg.com/swagger-ui-dist/swagger-ui-bundle.js></script><script>SwaggerUIBundle(" + swaggerOpts + ")</script></body></html>"`,
    `  res.type("html")`,
    `  ret html`,
  ];
}

// ── Password Reset Routes (A6) ─────────────────────────────

function passwordResetRoutes() {
  return [
    `post "/api/auth/forgot-password" (req, res):`,
    `  any user = UserStore.findBy("email", req.body.email)`,
    `  if not user:`,
    `    ret ok({message: "If the email exists, a reset link has been sent"}, null)`,
    `  str resetToken = crypto.randomUUID()`,
    `  UserStore.update(user.id, {resetToken})`,
    `  log("Password reset requested for: " + req.body.email)`,
    `  ret ok({message: "If the email exists, a reset link has been sent"}, null)`,
    ``,
    `post "/api/auth/reset-password" (req, res):`,
    `  if not req.body.token or not req.body.password:`,
    `    ret.status(400) err("Token and password are required", 400)`,
    `  any user = UserStore.findBy("resetToken", req.body.token)`,
    `  if not user:`,
    `    ret.status(400) err("Invalid or expired token", 400)`,
    `  str hashed = await hash(req.body.password)`,
    `  UserStore.update(user.id, {password: hashed, resetToken: null})`,
    `  ret ok({message: "Password has been reset"}, null)`,
    ``,
    `post "/api/auth/change-password" (req, res):`,
    `  if not req.body.oldPassword or not req.body.newPassword:`,
    `    ret.status(400) err("Old and new passwords are required", 400)`,
    `  bool valid = await verify(req.body.oldPassword, req.user.password)`,
    `  if not valid:`,
    `    ret.status(401) err("Invalid old password", 401)`,
    `  str hashed = await hash(req.body.newPassword)`,
    `  UserStore.update(req.user.id, {password: hashed})`,
    `  ret ok({message: "Password changed"}, null)`,
  ];
}

// ── WebSocket Rooms (B11) ──────────────────────────────────

function wsRoomsBlock(hasAuth) {
  const lines = [
    `ws "/ws":`,
    `  on "connection" (socket, req):`,
  ];
  if (hasAuth) {
    lines.push(
      `    # WS auth: verify token from query string`,
      `    str wsToken = ""`,
      `    if req.url and req.url.includes("token="):`,
      `      str qs = req.url.split("token=")[1] or ""`,
      `      int ampIdx = qs.indexOf("&")`,
      `      if ampIdx > 0:`,
      `        wsToken = qs.slice(0, ampIdx)`,
      `      else:`,
      `        wsToken = qs`,
      `    if wsToken:`,
      `      any wsDecoded = jwt.verify(wsToken, JWT_SECRET)`,
      `      if wsDecoded:`,
      `        socket.user = wsDecoded`,
      `        socket.authenticated = true`,
      `      else:`,
      `        socket.authenticated = false`,
      `        socket.send(JSON.stringify({type: "error", message: "Invalid token"}))`,
      `        socket.close()`,
      `    else:`,
      `      socket.authenticated = false`,
    );
  }
  lines.push(
    `    socket.room = "general"`,
    `    log("Client connected to room: general")`,
    `  on "message" (data, socket):`,
  );
  if (hasAuth) {
    lines.push(
      `    if not socket.authenticated:`,
      `      socket.send(JSON.stringify({type: "error", message: "Not authenticated"}))`,
      `      ret`,
    );
  }
  lines.push(
    `    any msg = JSON.parse(data)`,
    `    if msg.type == "join":`,
    `      socket.room = msg.room`,
    `      socket.send(JSON.stringify({type: "joined", room: msg.room}))`,
    `    if msg.type == "leave":`,
    `      socket.room = "general"`,
    `    if msg.type == "message":`,
    `      broadcast({type: "message", room: socket.room, data: msg.data, sender: msg.sender}, socket.room)`,
    `    if msg.type == "broadcast":`,
    `      broadcast(msg.data)`,
    `  on "close" (socket):`,
    `    log("Client disconnected")`,
  );
  return lines;
}

// ── Rate Limiting (B12) ────────────────────────────────────

function rateLimitBlock() {
  return `fn rateLimit(int windowMs, int maxReqs):
  map hits = {}
  ret fn(req, res, next):
    str key = req.ip
    int now = Date.now()
    if not hits[key] or now - hits[key].start > windowMs:
      hits[key] = {count: 1, start: now}
    else:
      hits[key].count = hits[key].count + 1
    if hits[key].count > maxReqs:
      ret.status(429) {error: "Too many requests"}
    next()`;
}

// ── Logging Middleware (C17) ───────────────────────────────

function loggingBlock() {
  return `fn requestLogger(req, res, next):
  int startTime = Date.now()
  log("[" + req.method + "] " + req.path)
  next()`;
}

// ── RBAC Middleware (D1) ──────────────────────────────────

function rbacBlock() {
  return `fn requireRole(list allowed):
  ret fn(req, res, next):
    if not req.user:
      ret.status(401) {error: "Not authenticated"}
    str userRole = req.user.role or "user"
    if not allowed.includes(userRole):
      ret.status(403) {error: "Insufficient permissions"}
    next()`;
}

function rbacRouteGuards(entity) {
  const lower = entity.name.toLowerCase();
  const plural = pluralize(lower);
  return [
    `# Role guards for ${plural}`,
    `del "/api/${plural}/:id" (req, res):`,
    `  str role = req.user.role or "user"`,
    `  if role != "admin" and role != "moderator":`,
    `    ret.status(403) {error: "Only admin/moderator can delete"}`,
    `  ${entity.name}Store.remove(req.params.id)`,
    `  ret {deleted: true}`,
  ];
}

// ── Caching Headers (C18) ─────────────────────────────────

function cachingRoute() {
  return [
    `get "/api/cache-headers" (req, res):`,
    `  res.set("Cache-Control", "public, max-age=60")`,
    `  ret {cached: true, ttl: 60}`,
  ];
}

// ── Frontend SPA (S2) ─────────────────────────────────────

function frontendSPA(entities, intents, port) {
  const L = [];
  L.push('<!DOCTYPE html>');
  L.push('<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">');
  L.push('<title>App</title>');
  L.push(`<style>
:root{--bg:#f8fafc;--card:#fff;--primary:#2563eb;--danger:#dc2626;--text:#1e293b;--muted:#64748b;--border:#e2e8f0;--radius:8px}
*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);line-height:1.6}
nav{background:var(--primary);color:#fff;padding:1rem 2rem;display:flex;gap:1rem;align-items:center;box-shadow:0 2px 4px rgba(0,0,0,.1)}
nav a{color:#fff;text-decoration:none;padding:.4rem 1rem;border-radius:var(--radius);opacity:.8;cursor:pointer}nav a:hover,nav a.active{opacity:1;background:rgba(255,255,255,.15)}
.container{max-width:1200px;margin:2rem auto;padding:0 1rem}
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:1.5rem;margin-bottom:1rem;box-shadow:0 1px 3px rgba(0,0,0,.05)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:1rem}
.form-group{margin-bottom:1rem}
.form-group label{display:block;font-weight:500;margin-bottom:.25rem;font-size:.875rem}
.form-group input,.form-group textarea,.form-group select{width:100%;padding:.5rem .75rem;border:1px solid var(--border);border-radius:var(--radius);font-size:.875rem}
.form-group textarea{min-height:80px;resize:vertical}
.btn{padding:.5rem 1rem;border:none;border-radius:var(--radius);cursor:pointer;font-size:.875rem;font-weight:500;transition:opacity .2s}
.btn-primary{background:var(--primary);color:#fff}.btn-danger{background:var(--danger);color:#fff}
.btn:hover{opacity:.85}.btn-sm{padding:.25rem .5rem;font-size:.75rem}
table{width:100%;border-collapse:collapse}th,td{padding:.75rem;text-align:left;border-bottom:1px solid var(--border)}
th{background:var(--bg);font-weight:600;font-size:.875rem;color:var(--muted)}
.search{display:flex;gap:.5rem;margin-bottom:1rem}
.search input{flex:1;padding:.5rem .75rem;border:1px solid var(--border);border-radius:var(--radius)}
.pagination{display:flex;gap:.5rem;justify-content:center;margin-top:1rem;align-items:center}
.toast{position:fixed;top:1rem;right:1rem;background:#22c55e;color:#fff;padding:.75rem 1.5rem;border-radius:var(--radius);opacity:0;transition:opacity .3s;z-index:999}
.toast.show{opacity:1}.toast.error{background:var(--danger)}.toast.warn{background:#f59e0b}
.loading{text-align:center;padding:2rem;color:var(--muted)}.loading::after{content:"";display:inline-block;width:1.5rem;height:1.5rem;border:2px solid var(--border);border-top-color:var(--primary);border-radius:50%;animation:spin .6s linear infinite;margin-left:.5rem}
@keyframes spin{to{transform:rotate(360deg)}}
.error-banner{background:#fef2f2;border:1px solid #fecaca;color:#991b1b;padding:.75rem 1rem;border-radius:var(--radius);margin-bottom:1rem;font-size:.875rem}
.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:100}
.modal{background:var(--card);border-radius:var(--radius);padding:2rem;width:90%;max-width:500px;box-shadow:0 20px 60px rgba(0,0,0,.2)}
.modal h3{margin-bottom:1rem}.modal-actions{display:flex;gap:.5rem;justify-content:flex-end;margin-top:1.5rem}
.badge{display:inline-block;padding:.15rem .5rem;border-radius:99px;font-size:.75rem;font-weight:500;background:var(--border)}
.hidden{display:none}
</style></head><body>`);
  L.push('<div id="toast" class="toast"></div>');
  const hasAuth = intents.has('auth');
  const navLinks = entities.map(e => `<a onclick="showSection('${e.name.toLowerCase()}')" id="nav-${e.name.toLowerCase()}">${pluralize(e.name)}</a>`).join('');
  const authNav = hasAuth ? `<a onclick="showSection('auth')" id="nav-auth">Login</a><span id="user-info" class="hidden" style="margin-left:auto;font-size:.875rem"></span><a id="logout-btn" class="hidden" onclick="doLogout()">Logout</a>` : '';
  L.push(`<nav><strong style="font-size:1.25rem">App</strong>${navLinks}${authNav}</nav>`);
  L.push('<div class="container">');
  if (hasAuth) {
    L.push(`<div id="section-auth"><div class="card" style="max-width:400px;margin:2rem auto"><h2 id="auth-title">Login</h2>`);
    L.push(`<div class="form-group"><label>Email</label><input type="email" id="auth-email" placeholder="email@example.com"></div>`);
    L.push(`<div class="form-group"><label>Password</label><input type="password" id="auth-password" placeholder="password"></div>`);
    L.push(`<div id="auth-name-group" class="form-group hidden"><label>Name</label><input type="text" id="auth-name" placeholder="Your name"></div>`);
    L.push(`<button class="btn btn-primary" style="width:100%" onclick="doAuth()">Login</button>`);
    L.push(`<p style="text-align:center;margin-top:1rem;font-size:.875rem">Don't have an account? <a onclick="toggleAuthMode()" style="color:var(--primary);cursor:pointer">Register</a></p>`);
    L.push(`</div></div>`);
  }
  for (const entity of entities) {
    const lower = entity.name.toLowerCase();
    const plural = pluralize(lower);
    const fields = entity.fields.filter(f => f.type !== 'auto');
    L.push(`<div id="section-${lower}" class="hidden">`);
    L.push(`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem"><h2>${pluralize(entity.name)}</h2><button class="btn btn-primary" onclick="${lower}ShowModal()">+ New ${entity.name}</button></div>`);
    L.push(`<div class="search"><input id="${lower}-search" placeholder="Search ${plural}..." oninput="${lower}Load()"><select id="${lower}-sort" onchange="${lower}Load()">`);
    for (const f of entity.fields) L.push(`<option value="${f.name}">${f.name}</option>`);
    L.push(`</select><select id="${lower}-order" onchange="${lower}Load()"><option value="desc">Newest</option><option value="asc">Oldest</option></select></div>`);
    L.push(`<div class="card"><table><thead><tr>${entity.fields.map(f => `<th>${f.name}</th>`).join('')}<th>Actions</th></tr></thead><tbody id="${lower}-tbody"></tbody></table>`);
    L.push(`<div class="pagination" id="${lower}-pager"></div></div>`);
    L.push(`<div id="${lower}-modal" class="modal-bg hidden" onclick="if(event.target===this)this.classList.add('hidden')"><div class="modal"><h3 id="${lower}-modal-title">New ${entity.name}</h3>`);
    L.push(`<input type="hidden" id="${lower}-edit-id">`);
    for (const f of fields) {
      if (f.type === 'bool') {
        L.push(`<div class="form-group"><label><input type="checkbox" id="${lower}-f-${f.name}"> ${f.name}</label></div>`);
      } else {
        const inputType = f.type === 'int' ? 'number' : f.name === 'password' ? 'password' : f.name === 'email' ? 'email' : 'text';
        const tag = f.name === 'body' || f.name === 'content' || f.name === 'description' ? 'textarea' : 'input';
        L.push(`<div class="form-group"><label>${f.name}${f.modifiers.includes('required') ? ' *' : ''}</label><${tag} ${tag === 'input' ? `type="${inputType}" ` : ''}id="${lower}-f-${f.name}" placeholder="${f.name}"></${tag}></div>`);
      }
    }
    L.push(`<div class="modal-actions"><button class="btn" onclick="document.getElementById('${lower}-modal').classList.add('hidden')">Cancel</button><button class="btn btn-primary" onclick="${lower}Save()">Save</button></div></div></div>`);
    L.push('</div>');
  }
  L.push('</div>');
  L.push('<script>');
  L.push(`const API="";let currentPage={};let _token=null;let _isRegister=false;`);
  L.push(`function authHeaders(){const h={"Content-Type":"application/json"};if(_token)h.Authorization="Bearer "+_token;return h}`);
  L.push(`function toast(m,type){const t=document.getElementById("toast");t.textContent=m;t.className="toast show"+(type?" "+type:"");setTimeout(()=>{t.classList.remove("show")},2500)}`);
  L.push(`function showError(msg){toast(msg,"error")}`);
  L.push(`async function apiFetch(url,opts){try{const r=await fetch(url,opts||{headers:authHeaders()});if(r.status===401){${hasAuth?'showError("Session expired — please log in again");doLogout();':''} return null}if(!r.ok){const e=await r.json().catch(()=>({error:"Request failed"}));showError(e.error||"Error "+r.status);return null}return await r.json()}catch(e){showError("Network error: "+e.message);return null}}`);
  L.push(`function setLoading(id,on){const el=document.getElementById(id);if(el)el.innerHTML=on?'<div class="loading">Loading...</div>':""}`);
  L.push(`function showBanner(containerId,msg){const el=document.getElementById(containerId);if(!el)return;let b=el.querySelector(".error-banner");if(!b){b=document.createElement("div");b.className="error-banner";el.prepend(b)}b.textContent=msg;setTimeout(()=>b.remove(),5000)}`);
  L.push(`function showSection(name){document.querySelectorAll('[id^="section-"]').forEach(s=>s.classList.add("hidden"));const el=document.getElementById("section-"+name);if(el)el.classList.remove("hidden");document.querySelectorAll("nav a").forEach(a=>a.classList.remove("active"));const n=document.getElementById("nav-"+name);if(n)n.classList.add("active");if(window[name+"Load"])window[name+"Load"]()}`);
  if (hasAuth) {
    L.push(`function toggleAuthMode(){_isRegister=!_isRegister;document.getElementById("auth-title").textContent=_isRegister?"Register":"Login";document.getElementById("auth-name-group").classList.toggle("hidden",!_isRegister)}`);
    L.push(`async function doAuth(){const email=document.getElementById("auth-email").value;const password=document.getElementById("auth-password").value;if(!email||!password){showError("Email and password are required");return}const url=_isRegister?"/api/auth/register":"/api/auth/login";const body=_isRegister?{name:document.getElementById("auth-name").value,email,password}:{email,password};try{const r=await fetch(API+url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const d=await r.json();if(!r.ok){showError(d.error||"Auth failed ("+r.status+")");return}if(d.token){_token=d.token;localStorage.setItem("_token",d.token);document.getElementById("user-info").textContent="Hi, "+(d.user?.name||email);document.getElementById("user-info").classList.remove("hidden");document.getElementById("logout-btn").classList.remove("hidden");document.getElementById("nav-auth").classList.add("hidden");toast(_isRegister?"Registered!":"Logged in!");showSection("${entities[0].name.toLowerCase()}")}else{showError(d.error||"No token received")}}catch(e){showError("Network error: "+e.message)}}`);
    L.push(`function doLogout(){_token=null;localStorage.removeItem("_token");document.getElementById("user-info").classList.add("hidden");document.getElementById("logout-btn").classList.add("hidden");document.getElementById("nav-auth").classList.remove("hidden");toast("Logged out");showSection("auth")}`);
    L.push(`(function(){const t=localStorage.getItem("_token");if(t){_token=t;document.getElementById("user-info").textContent="Logged in";document.getElementById("user-info").classList.remove("hidden");document.getElementById("logout-btn").classList.remove("hidden");document.getElementById("nav-auth").classList.add("hidden")}})()`);
  }
  for (const entity of entities) {
    const lower = entity.name.toLowerCase();
    const plural = pluralize(lower);
    const fields = entity.fields.filter(f => f.type !== 'auto');
    L.push(`async function ${lower}Load(page){page=page||1;currentPage["${lower}"]=page;const s=document.getElementById("${lower}-search").value;const sort=document.getElementById("${lower}-sort").value;const ord=document.getElementById("${lower}-order").value;`);
    L.push(`setLoading("${lower}-tbody",true);`);
    L.push(`const d=await apiFetch(API+"/api/${plural}?page="+page+"&limit=10&search="+encodeURIComponent(s)+"&sort="+sort+"&order="+ord);if(!d){setLoading("${lower}-tbody",false);return}const items=d.items||d;`);
    L.push(`document.getElementById("${lower}-tbody").innerHTML=items.map(i=>"<tr>${entity.fields.map(f => `<td>"+(i.${f.name}!=null?i.${f.name}:"")+"</td>`).join('')}<td><button class='btn btn-sm btn-primary' onclick='${lower}Edit("+i.id+")'>Edit</button> <button class='btn btn-sm btn-danger' onclick='${lower}Del("+i.id+")'>Del</button></td></tr>").join("");`);
    L.push(`const tp=Math.ceil((d.total||items.length)/10);let pg="";for(let p=1;p<=tp;p++)pg+="<button class='btn btn-sm "+(p===page?"btn-primary":"")+"' onclick='${lower}Load("+p+")'>"+p+"</button>";document.getElementById("${lower}-pager").innerHTML=pg}`);
    L.push(`function ${lower}ShowModal(id){document.getElementById("${lower}-edit-id").value=id||"";document.getElementById("${lower}-modal-title").textContent=id?"Edit ${entity.name}":"New ${entity.name}";${fields.map(f => f.type === 'bool' ? `document.getElementById("${lower}-f-${f.name}").checked=false` : `document.getElementById("${lower}-f-${f.name}").value=""`).join(';')};document.getElementById("${lower}-modal").classList.remove("hidden")}`);
    L.push(`async function ${lower}Edit(id){const d=await apiFetch(API+"/api/${plural}/"+id);if(!d)return;const i=d.data||d;${lower}ShowModal(id);${fields.map(f => f.type === 'bool' ? `document.getElementById("${lower}-f-${f.name}").checked=!!i.${f.name}` : `document.getElementById("${lower}-f-${f.name}").value=i.${f.name}||""`).join(';')}}`);
    L.push(`async function ${lower}Save(){const id=document.getElementById("${lower}-edit-id").value;const body={${fields.map(f => {
      if (f.type === 'bool') return `${f.name}:document.getElementById("${lower}-f-${f.name}").checked`;
      if (f.type === 'int') return `${f.name}:+document.getElementById("${lower}-f-${f.name}").value`;
      return `${f.name}:document.getElementById("${lower}-f-${f.name}").value`;
    }).join(',')}};`);
    L.push(`const method=id?"PUT":"POST";const url=API+"/api/${plural}"+(id?"/"+id:"");const d=await apiFetch(url,{method,headers:authHeaders(),body:JSON.stringify(body)});if(!d){showBanner("section-${lower}","Save failed — check required fields");return}document.getElementById("${lower}-modal").classList.add("hidden");toast(id?"Updated!":"Created!");${lower}Load()}`);
    L.push(`async function ${lower}Del(id){if(!confirm("Delete this ${lower}?"))return;const d=await apiFetch(API+"/api/${plural}/"+id,{method:"DELETE",headers:authHeaders()});if(!d)return;toast("Deleted!");${lower}Load()}`);
  }
  const initSection = hasAuth ? 'auth' : entities[0].name.toLowerCase();
  L.push(`showSection("${initSection}")`);
  L.push('</script></body></html>');
  return L.join('\n');
}

// ── Docker Compose (B14) ──────────────────────────────────

function dockerCompose(projectName, port, intents) {
  const lines = ['version: "3.8"', '', 'services:'];
  lines.push(`  app:`);
  lines.push(`    build: .`);
  lines.push(`    ports:`);
  lines.push(`      - "${port}:${port}"`);
  lines.push(`    env_file: .env`);
  lines.push(`    volumes:`);
  lines.push(`      - app-data:/app/data`);
  if (intents.has('database')) {
    lines.push(`    depends_on:`);
    lines.push(`      - db`);
    lines.push('');
    lines.push(`  db:`);
    lines.push(`    image: postgres:16-alpine`);
    lines.push(`    environment:`);
    lines.push(`      POSTGRES_DB: ${projectName.replace(/-/g, '_')}`);
    lines.push(`      POSTGRES_USER: app`);
    lines.push(`      POSTGRES_PASSWORD: changeme`);
    lines.push(`    ports:`);
    lines.push(`      - "5432:5432"`);
    lines.push(`    volumes:`);
    lines.push(`      - db-data:/var/lib/postgresql/data`);
  }
  lines.push('');
  lines.push('volumes:');
  lines.push('  app-data:');
  if (intents.has('database')) lines.push('  db-data:');
  return lines.join('\n') + '\n';
}

// ── GitHub Actions CI (C16) ────────────────────────────────

function githubActionsCI(projectName) {
  return `name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [20, 22]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: \${{ matrix.node-version }}
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: npm test

  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx naide app.naide --check
`;
}

// ── Environment Files (C15) ───────────────────────────────

function envDevelopment(port, intents) {
  const lines = ['NODE_ENV=development', `PORT=${port}`, 'LOG_LEVEL=debug'];
  if (intents.has('auth')) lines.push('JWT_SECRET=dev-secret-do-not-use-in-prod');
  if (intents.has('database')) lines.push('DATABASE_URL=postgres://app:changeme@localhost:5432/app_dev');
  return lines.join('\n') + '\n';
}

function envProduction(port, intents) {
  const lines = ['NODE_ENV=production', `PORT=${port}`, 'LOG_LEVEL=warn'];
  if (intents.has('auth')) lines.push('JWT_SECRET=CHANGE_ME_TO_RANDOM_SECRET');
  if (intents.has('database')) lines.push('DATABASE_URL=postgres://user:pass@db-host:5432/app_prod');
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

// ── Test Runner (D2) ─────────────────────────────────────

function testRunnerFile(entities, intents, port) {
  const lines = [];
  lines.push(`import { describe, it } from 'node:test';`);
  lines.push(`import assert from 'node:assert/strict';`);
  lines.push('');
  lines.push(`const BASE = process.env.TEST_URL || 'http://localhost:${port}';`);
  lines.push(`const headers = {'Content-Type': 'application/json'};`);
  lines.push(`let authToken = null;`);
  lines.push('');
  lines.push(`async function api(path, opts = {}) {`);
  lines.push(`  const h = {...headers};`);
  lines.push(`  if (authToken) h.Authorization = 'Bearer ' + authToken;`);
  lines.push(`  const r = await fetch(BASE + path, {...opts, headers: {...h, ...opts.headers}});`);
  lines.push(`  const body = await r.json().catch(() => null);`);
  lines.push(`  return {status: r.status, body, ok: r.ok};`);
  lines.push(`}`);
  lines.push('');
  lines.push(`describe('Health', () => {`);
  lines.push(`  it('GET /api/health returns ok', async () => {`);
  lines.push(`    const r = await api('/api/health');`);
  lines.push(`    assert.equal(r.status, 200);`);
  lines.push(`    assert.equal(r.body.status, 'ok');`);
  lines.push(`  });`);
  lines.push(`});`);
  lines.push('');
  if (intents.has('auth')) {
    lines.push(`describe('Auth', () => {`);
    lines.push(`  const email = 'test' + Date.now() + '@test.com';`);
    lines.push(`  it('POST /api/auth/register creates user', async () => {`);
    lines.push(`    const r = await api('/api/auth/register', {method: 'POST', body: JSON.stringify({name: 'Test', email, password: 'test1234'})});`);
    lines.push(`    assert.equal(r.status, 200);`);
    lines.push(`    assert.ok(r.body.token);`);
    lines.push(`    authToken = r.body.token;`);
    lines.push(`  });`);
    lines.push(`  it('POST /api/auth/login returns token', async () => {`);
    lines.push(`    const r = await api('/api/auth/login', {method: 'POST', body: JSON.stringify({email, password: 'test1234'})});`);
    lines.push(`    assert.equal(r.status, 200);`);
    lines.push(`    assert.ok(r.body.token);`);
    lines.push(`    authToken = r.body.token;`);
    lines.push(`  });`);
    lines.push(`  it('GET /api/auth/me returns current user', async () => {`);
    lines.push(`    const r = await api('/api/auth/me');`);
    lines.push(`    assert.equal(r.status, 200);`);
    lines.push(`    assert.equal(r.body.email || r.body.data?.email, email);`);
    lines.push(`  });`);
    lines.push(`  it('rejects invalid login', async () => {`);
    lines.push(`    const r = await api('/api/auth/login', {method: 'POST', body: JSON.stringify({email: 'no@no.com', password: 'wrong'})});`);
    lines.push(`    assert.equal(r.status, 401);`);
    lines.push(`  });`);
    lines.push(`});`);
    lines.push('');
  }
  for (const entity of entities) {
    const lower = entity.name.toLowerCase();
    const plural = pluralize(lower);
    const requiredFields = entity.fields.filter(f => f.modifiers.includes('required') && f.type !== 'auto');
    const sampleData = {};
    for (const f of requiredFields) {
      if (f.type === 'int') sampleData[f.name] = 1;
      else if (f.type === 'bool') sampleData[f.name] = true;
      else sampleData[f.name] = 'test_' + f.name;
    }
    if (Object.keys(sampleData).length === 0) {
      const first = entity.fields.find(f => f.type !== 'auto' && f.type !== 'bool');
      if (first) sampleData[first.name] = first.type === 'int' ? 1 : 'test';
    }
    lines.push(`describe('${entity.name} CRUD', () => {`);
    lines.push(`  let createdId;`);
    lines.push(`  it('POST /api/${plural} creates', async () => {`);
    lines.push(`    const r = await api('/api/${plural}', {method: 'POST', body: JSON.stringify(${JSON.stringify(sampleData)})});`);
    lines.push(`    assert.ok(r.ok, 'status ' + r.status);`);
    lines.push(`    createdId = r.body.id || r.body.data?.id;`);
    lines.push(`    assert.ok(createdId, 'has id');`);
    lines.push(`  });`);
    lines.push(`  it('GET /api/${plural} lists', async () => {`);
    lines.push(`    const r = await api('/api/${plural}');`);
    lines.push(`    assert.equal(r.status, 200);`);
    lines.push(`    const items = r.body.items || r.body;`);
    lines.push(`    assert.ok(Array.isArray(items));`);
    lines.push(`  });`);
    lines.push(`  it('GET /api/${plural}/:id finds', async () => {`);
    lines.push(`    const r = await api('/api/${plural}/' + createdId);`);
    lines.push(`    assert.equal(r.status, 200);`);
    lines.push(`  });`);
    lines.push(`  it('PUT /api/${plural}/:id updates', async () => {`);
    lines.push(`    const r = await api('/api/${plural}/' + createdId, {method: 'PUT', body: JSON.stringify(${JSON.stringify(sampleData)})});`);
    lines.push(`    assert.ok(r.ok);`);
    lines.push(`  });`);
    lines.push(`  it('DELETE /api/${plural}/:id deletes', async () => {`);
    lines.push(`    const r = await api('/api/${plural}/' + createdId, {method: 'DELETE'});`);
    lines.push(`    assert.ok(r.ok);`);
    lines.push(`  });`);
    lines.push(`});`);
    lines.push('');
  }
  return lines.join('\n');
}

// ── DB Migration (D3) ───────────────────────────────────────

function migrationFile(entities, relationships, m2mRels) {
  const lines = [];
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  lines.push(`# Migration: ${ts}`);
  lines.push(`# Auto-generated by NAIDE ~~ engine`);
  lines.push(`# Run: naide migrate.naide`);
  lines.push('');
  lines.push('use "node:fs"');
  lines.push('');
  lines.push(`fn migrate():`);
  for (const entity of entities) {
    const lower = entity.name.toLowerCase();
    const plural = pluralize(lower);
    lines.push(`  log("Creating table: ${plural}")`);
    const cols = entity.fields.map(f => {
      let col = f.name;
      if (f.type === 'auto') col += ' INTEGER PRIMARY KEY AUTOINCREMENT';
      else if (f.type === 'int') col += ' INTEGER';
      else if (f.type === 'bool') col += ' BOOLEAN DEFAULT false';
      else col += ' TEXT';
      if (f.modifiers.includes('required') && f.type !== 'auto') col += ' NOT NULL';
      if (f.modifiers.includes('unique')) col += ' UNIQUE';
      return col;
    });
    lines.push(`  str sql_${lower} = "CREATE TABLE IF NOT EXISTS ${plural} (${cols.join(', ')}"`);
    const fks = relationships.filter(r => r.child === entity.name);
    if (fks.length > 0) {
      for (const fk of fks) {
        const parentPlural = pluralize(fk.parent.toLowerCase());
        lines.push(`  sql_${lower} = sql_${lower} + ", FOREIGN KEY (${fk.fk}) REFERENCES ${parentPlural}(id)"`);
      }
    }
    lines.push(`  sql_${lower} = sql_${lower} + ")"`);
    lines.push(`  log(sql_${lower})`);
    lines.push('');
  }
  for (const rel of m2mRels) {
    const jLower = rel.junction.toLowerCase();
    lines.push(`  log("Creating junction table: ${jLower}")`);
    const lp = pluralize(rel.left.toLowerCase());
    const rp = pluralize(rel.right.toLowerCase());
    lines.push(`  str sql_${jLower} = "CREATE TABLE IF NOT EXISTS ${jLower} (id INTEGER PRIMARY KEY AUTOINCREMENT, ${rel.fkLeft} INTEGER NOT NULL, ${rel.fkRight} INTEGER NOT NULL, created TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (${rel.fkLeft}) REFERENCES ${lp}(id), FOREIGN KEY (${rel.fkRight}) REFERENCES ${rp}(id), UNIQUE(${rel.fkLeft}, ${rel.fkRight}))"`);
    lines.push(`  log(sql_${jLower})`);
    lines.push('');
  }
  lines.push('  log("Migration complete")');
  lines.push('');
  lines.push(`fn rollback():`);
  for (const entity of [...entities].reverse()) {
    const plural = pluralize(entity.name.toLowerCase());
    lines.push(`  log("Dropping table: ${plural}")`);
    lines.push(`  str drop_${entity.name.toLowerCase()} = "DROP TABLE IF EXISTS ${plural}"`);
    lines.push(`  log(drop_${entity.name.toLowerCase()})`);
  }
  for (const rel of m2mRels) {
    const jLower = rel.junction.toLowerCase();
    lines.push(`  str drop_${jLower} = "DROP TABLE IF EXISTS ${jLower}"`);
    lines.push(`  log(drop_${jLower})`);
  }
  lines.push('  log("Rollback complete")');
  lines.push('');
  lines.push('migrate()');
  return lines.join('\n') + '\n';
}

// ── Code Composer ───────────────────────────────────────────

// ── Game HTML Generators ──────────────────────────────────

const GAME_CSS_BASE = `*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0a0a1a;--surface:#141428;--primary:#6C63FF;--secondary:#FF6584;--accent:#00D4AA;--text:#f0f0f0;--muted:#888}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}
.container{width:min(420px,92vw);text-align:center}
h1{font-size:1.8rem;margin-bottom:.5rem;background:linear-gradient(135deg,var(--primary),var(--secondary));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.score{font-size:3rem;font-weight:800;margin:.5rem 0;font-variant-numeric:tabular-nums}
.btn{display:inline-block;padding:.75rem 2rem;border:none;border-radius:12px;font-size:1.1rem;font-weight:600;cursor:pointer;transition:transform .1s,box-shadow .2s;color:#fff;background:linear-gradient(135deg,var(--primary),#8B5CF6)}
.btn:active{transform:scale(.95)}
.btn:hover{box-shadow:0 0 20px rgba(108,99,255,.4)}
.stats{display:flex;gap:1.5rem;justify-content:center;margin:.75rem 0;font-size:.9rem;color:var(--muted)}
.stats span{display:flex;flex-direction:column;align-items:center;gap:.2rem}
.stats b{color:var(--text);font-size:1.1rem}
.hidden{display:none!important}
.high{color:var(--accent)}
@keyframes pop{0%{transform:scale(1)}50%{transform:scale(1.15)}100%{transform:scale(1)}}
@keyframes fadeUp{0%{opacity:1;transform:translateY(0)}100%{opacity:0;transform:translateY(-60px)}}`;

function tappingGameHTML(title) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0,user-scalable=no"><title>${title || 'Tapping Game'}</title>
<style>${GAME_CSS_BASE}
.tap-area{width:min(320px,80vw);height:min(320px,80vw);border-radius:50%;background:radial-gradient(circle,var(--primary),#4338CA);display:flex;align-items:center;justify-content:center;margin:1.5rem auto;cursor:pointer;position:relative;transition:box-shadow .15s;font-size:4rem;font-weight:900}
.tap-area:active{box-shadow:0 0 60px rgba(108,99,255,.6)}
.tap-area.go{animation:pulse 1s infinite}
@keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(108,99,255,.5)}50%{box-shadow:0 0 0 20px rgba(108,99,255,0)}}
.ripple{position:absolute;border-radius:50%;background:rgba(255,255,255,.3);animation:rippleAnim .5s ease-out forwards;pointer-events:none}
@keyframes rippleAnim{0%{width:0;height:0;opacity:.6}100%{width:200px;height:200px;opacity:0}}
.combo{position:fixed;font-weight:800;font-size:1.5rem;color:var(--accent);pointer-events:none;animation:fadeUp .6s ease-out forwards}
.timer-bar{width:100%;height:6px;background:var(--surface);border-radius:3px;margin:.5rem 0;overflow:hidden}
.timer-bar .fill{height:100%;background:linear-gradient(90deg,var(--accent),var(--primary));transition:width .1s linear;border-radius:3px}
.result{font-size:1.2rem;line-height:2}
</style></head><body>
<div class="container">
<h1>${title || 'Tapping Game'}</h1>
<div id="state-menu">
<p style="color:var(--muted);margin-bottom:1.5rem">Tap as fast as you can!</p>
<div class="stats"><span>Best<b id="best">0</b></span><span>Last<b id="last">-</b></span></div>
<button class="btn" onclick="startGame()">Start</button>
</div>
<div id="state-play" class="hidden">
<div class="timer-bar"><div class="fill" id="bar" style="width:100%"></div></div>
<div class="score" id="count">0</div>
<div class="tap-area go" id="tap" ontouchstart="doTap(event)" onmousedown="doTap(event)">TAP</div>
<div class="stats"><span>Combo<b id="combo">x1</b></span><span>TPS<b id="tps">0</b></span></div>
</div>
<div id="state-result" class="hidden">
<div class="score" id="final">0</div>
<div class="result" id="summary"></div>
<button class="btn" style="margin-top:1rem" onclick="startGame()">Play Again</button>
</div>
</div>
<script>
const DURATION=10000;
let taps,startT,timer,comboN,lastTap,best=+(localStorage.getItem('tap_best')||0);
document.getElementById('best').textContent=best;
function show(id){document.querySelectorAll('[id^=state-]').forEach(e=>e.classList.add('hidden'));document.getElementById('state-'+id).classList.remove('hidden')}
function startGame(){taps=0;comboN=1;lastTap=0;startT=Date.now();document.getElementById('count').textContent='0';document.getElementById('combo').textContent='x1';document.getElementById('bar').style.width='100%';show('play');timer=requestAnimationFrame(tick)}
function tick(){const el=Date.now()-startT,pct=Math.max(0,1-el/DURATION)*100;document.getElementById('bar').style.width=pct+'%';const sec=Math.max(0,(DURATION-el)/1000);document.getElementById('tps').textContent=(taps/Math.max(.1,(el/1000))).toFixed(1);if(el>=DURATION)return endGame();timer=requestAnimationFrame(tick)}
function doTap(e){e.preventDefault();if(Date.now()-startT>DURATION)return;taps++;const now=Date.now(),gap=now-lastTap;if(gap<200)comboN=Math.min(comboN+1,99);else if(gap>500)comboN=1;lastTap=now;document.getElementById('count').textContent=taps;document.getElementById('combo').textContent='x'+comboN;document.getElementById('count').style.animation='none';void document.getElementById('count').offsetWidth;document.getElementById('count').style.animation='pop .15s';const r=document.createElement('div');r.className='ripple';const rect=document.getElementById('tap').getBoundingClientRect();const x=(e.touches?e.touches[0].clientX:e.clientX)-rect.left;const y=(e.touches?e.touches[0].clientY:e.clientY)-rect.top;r.style.left=x-100+'px';r.style.top=y-100+'px';document.getElementById('tap').appendChild(r);setTimeout(()=>r.remove(),500);if(comboN>=3){const c=document.createElement('div');c.className='combo';c.textContent='x'+comboN;c.style.left=Math.random()*60+20+'%';c.style.top=Math.random()*30+20+'%';document.body.appendChild(c);setTimeout(()=>c.remove(),600)}}
function endGame(){cancelAnimationFrame(timer);const tps=(taps/(DURATION/1000)).toFixed(1);if(taps>best){best=taps;localStorage.setItem('tap_best',best);document.getElementById('best').textContent=best}document.getElementById('last').textContent=taps;document.getElementById('final').textContent=taps;const r=taps>=100?'Insane!':taps>=70?'Amazing!':taps>=50?'Great!':taps>=30?'Nice!':'Keep trying!';document.getElementById('summary').innerHTML=r+'<br>'+tps+' taps/sec'+(taps>=best?' <span class="high">★ New Best!</span>':'');show('result')}
</script></body></html>`;
}

function quizGameHTML(title) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0,user-scalable=no"><title>${title || 'Quiz Game'}</title>
<style>${GAME_CSS_BASE}
.question{font-size:1.3rem;margin:1.5rem 0;min-height:3em;line-height:1.5}
.choices{display:flex;flex-direction:column;gap:.75rem;margin:1rem 0}
.choice{padding:1rem;border:2px solid var(--surface);border-radius:12px;background:var(--surface);cursor:pointer;font-size:1rem;text-align:left;transition:border-color .2s,background .2s}
.choice:hover{border-color:var(--primary)}
.choice.correct{border-color:var(--accent);background:rgba(0,212,170,.15)}
.choice.wrong{border-color:var(--secondary);background:rgba(255,101,132,.15)}
.progress{display:flex;gap:4px;justify-content:center;margin-bottom:1rem}
.dot{width:10px;height:10px;border-radius:50%;background:var(--surface)}
.dot.done{background:var(--accent)}.dot.fail{background:var(--secondary)}.dot.cur{background:var(--primary);box-shadow:0 0 8px var(--primary)}
.timer{font-size:2.5rem;font-weight:800;font-variant-numeric:tabular-nums}
</style></head><body>
<div class="container">
<h1>${title || 'Quiz Game'}</h1>
<div id="state-menu">
<p style="color:var(--muted);margin:1rem 0">Test your knowledge — 10 questions, 15 seconds each</p>
<div class="stats"><span>Best<b id="best">0</b></span><span>Last<b id="last">-</b></span></div>
<button class="btn" onclick="startGame()">Start Quiz</button>
</div>
<div id="state-play" class="hidden">
<div class="progress" id="dots"></div>
<div class="timer" id="timer">15</div>
<div class="question" id="question"></div>
<div class="choices" id="choices"></div>
</div>
<div id="state-result" class="hidden">
<div class="score" id="final">0/10</div>
<div class="result" id="summary" style="font-size:1.1rem;margin:1rem 0"></div>
<button class="btn" onclick="startGame()">Play Again</button>
</div>
</div>
<script>
const QUESTIONS=[
{q:"What does HTML stand for?",a:["HyperText Markup Language","High Tech Modern Language","Home Tool Markup Language","Hyper Transfer Markup Language"],c:0},
{q:"Which planet is closest to the Sun?",a:["Mercury","Venus","Mars","Earth"],c:0},
{q:"What is the largest ocean on Earth?",a:["Pacific","Atlantic","Indian","Arctic"],c:0},
{q:"In JavaScript, which keyword declares a constant?",a:["const","let","var","static"],c:0},
{q:"What year did the World Wide Web become public?",a:["1991","1989","1995","2000"],c:0},
{q:"What is the chemical symbol for gold?",a:["Au","Ag","Go","Gd"],c:0},
{q:"How many bits are in a byte?",a:["8","4","16","32"],c:0},
{q:"Which language is NAIDE designed to replace for AI coding?",a:["JavaScript","Python","Ruby","Go"],c:0},
{q:"What does CSS stand for?",a:["Cascading Style Sheets","Computer Style Sheets","Creative Style System","Coded Style Sheets"],c:0},
{q:"What is the speed of light (approx km/s)?",a:["300,000","150,000","500,000","1,000,000"],c:0},
{q:"Which data structure uses FIFO?",a:["Queue","Stack","Tree","Graph"],c:0},
{q:"What is the square root of 144?",a:["12","14","10","16"],c:0},
{q:"Who painted the Mona Lisa?",a:["Da Vinci","Picasso","Van Gogh","Monet"],c:0},
{q:"What gas do plants absorb?",a:["CO2","O2","N2","H2"],c:0},
{q:"Which protocol is used for secure web browsing?",a:["HTTPS","FTP","SMTP","SSH"],c:0}
];
let cur,score,answers,tmr,timeLeft,best=+(localStorage.getItem('quiz_best')||0),pool;
document.getElementById('best').textContent=best;
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function show(id){document.querySelectorAll('[id^=state-]').forEach(e=>e.classList.add('hidden'));document.getElementById('state-'+id).classList.remove('hidden')}
function startGame(){pool=shuffle([...QUESTIONS]).slice(0,10);cur=0;score=0;answers=[];document.getElementById('dots').innerHTML=pool.map((_,i)=>'<div class="dot" id="d'+i+'"></div>').join('');show('play');showQ()}
function showQ(){if(cur>=pool.length)return endGame();document.getElementById('d'+cur).classList.add('cur');const q=pool[cur];const mixed=q.a.map((t,i)=>({t,ok:i===q.c}));shuffle(mixed);document.getElementById('question').textContent=q.q;const ch=document.getElementById('choices');ch.innerHTML='';mixed.forEach((m,i)=>{const d=document.createElement('div');d.className='choice';d.textContent=m.t;d.onclick=()=>pick(d,m.ok,ch);ch.appendChild(d)});timeLeft=15;document.getElementById('timer').textContent=timeLeft;clearInterval(tmr);tmr=setInterval(()=>{timeLeft--;document.getElementById('timer').textContent=Math.max(0,timeLeft);if(timeLeft<=0){clearInterval(tmr);timeout()}},1000)}
function pick(el,ok,ch){clearInterval(tmr);ch.querySelectorAll('.choice').forEach(c=>{c.onclick=null;if(c===el)c.classList.add(ok?'correct':'wrong');else if(!ok){const t=pool[cur].a[pool[cur].c];if(c.textContent===t)c.classList.add('correct')}});const d=document.getElementById('d'+cur);d.classList.remove('cur');if(ok){score++;d.classList.add('done')}else{d.classList.add('fail')}answers.push(ok);cur++;setTimeout(showQ,800)}
function timeout(){const ch=document.getElementById('choices');ch.querySelectorAll('.choice').forEach(c=>{c.onclick=null;const t=pool[cur].a[pool[cur].c];if(c.textContent===t)c.classList.add('correct')});document.getElementById('d'+cur).classList.remove('cur');document.getElementById('d'+cur).classList.add('fail');answers.push(false);cur++;setTimeout(showQ,800)}
function endGame(){clearInterval(tmr);if(score>best){best=score;localStorage.setItem('quiz_best',best);document.getElementById('best').textContent=best}document.getElementById('last').textContent=score;document.getElementById('final').textContent=score+'/'+pool.length;const pct=Math.round(score/pool.length*100);const r=pct===100?'Perfect!':pct>=80?'Excellent!':pct>=60?'Good!':pct>=40?'Not bad!':'Study more!';document.getElementById('summary').innerHTML=r+'<br>'+pct+'% correct'+(score>=best?' <span class="high">★ New Best!</span>':'');show('result')}
</script></body></html>`;
}

function memoryGameHTML(title) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0,user-scalable=no"><title>${title || 'Memory Game'}</title>
<style>${GAME_CSS_BASE}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:1rem auto;width:min(360px,88vw)}
.card{aspect-ratio:1;border-radius:12px;cursor:pointer;perspective:600px;-webkit-perspective:600px}
.card .inner{position:relative;width:100%;height:100%;transition:transform .4s;transform-style:preserve-3d;-webkit-transform-style:preserve-3d}
.card.flip .inner{transform:rotateY(180deg)}
.card .front,.card .back{position:absolute;width:100%;height:100%;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:2rem;backface-visibility:hidden;-webkit-backface-visibility:hidden}
.card .front{background:linear-gradient(135deg,var(--primary),#4338CA)}
.card .back{background:var(--surface);transform:rotateY(180deg);border:2px solid var(--primary)}
.card.matched .front{background:linear-gradient(135deg,var(--accent),#059669)}
.card.matched{pointer-events:none}
.moves{font-size:2.5rem;font-weight:800}
</style></head><body>
<div class="container">
<h1>${title || 'Memory Game'}</h1>
<div id="state-menu">
<p style="color:var(--muted);margin:1rem 0">Match all pairs with fewest moves</p>
<div class="stats"><span>Best<b id="best">-</b></span></div>
<button class="btn" onclick="startGame()">Start</button>
</div>
<div id="state-play" class="hidden">
<div class="stats"><span>Moves<b id="moves">0</b></span><span>Pairs<b id="pairs">0/8</b></span><span>Time<b id="time">0s</b></span></div>
<div class="grid" id="grid"></div>
</div>
<div id="state-result" class="hidden">
<div class="moves" id="finalMoves">0</div>
<p style="font-size:1.2rem;margin:.5rem 0">moves</p>
<div id="summary" style="font-size:1.1rem;margin:1rem 0"></div>
<button class="btn" onclick="startGame()">Play Again</button>
</div>
</div>
<script>
const EMOJIS=['🎮','🎯','🚀','💎','🔥','⚡','🌟','🎵','🎨','🏆','🍕','🌈','🦊','🐙','🎃','🍀'];
let cards,flipped,matched,moves,pairsN,tmr,startT,best=localStorage.getItem('mem_best');
document.getElementById('best').textContent=best||'-';
function show(id){document.querySelectorAll('[id^=state-]').forEach(e=>e.classList.add('hidden'));document.getElementById('state-'+id).classList.remove('hidden')}
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function startGame(){const pick=shuffle([...EMOJIS]).slice(0,8);cards=shuffle([...pick,...pick]);flipped=[];matched=0;moves=0;pairsN=8;document.getElementById('moves').textContent=0;document.getElementById('pairs').textContent='0/'+pairsN;const g=document.getElementById('grid');g.innerHTML='';cards.forEach((em,i)=>{const d=document.createElement('div');d.className='card';d.innerHTML='<div class="inner"><div class="front">?</div><div class="back">'+em+'</div></div>';d.onclick=()=>flipCard(d,i);g.appendChild(d)});startT=Date.now();tmr=setInterval(()=>{document.getElementById('time').textContent=Math.floor((Date.now()-startT)/1000)+'s'},200);show('play')}
function flipCard(el,i){if(flipped.length>=2||el.classList.contains('flip')||el.classList.contains('matched'))return;el.classList.add('flip');flipped.push({el,i,val:cards[i]});if(flipped.length===2){moves++;document.getElementById('moves').textContent=moves;const[a,b]=flipped;if(a.val===b.val){a.el.classList.add('matched');b.el.classList.add('matched');matched++;document.getElementById('pairs').textContent=matched+'/'+pairsN;flipped=[];if(matched===pairsN)endGame()}else{setTimeout(()=>{a.el.classList.remove('flip');b.el.classList.remove('flip');flipped=[]},700)}}}
function endGame(){clearInterval(tmr);const sec=Math.floor((Date.now()-startT)/1000);if(!best||moves<+best){best=moves;localStorage.setItem('mem_best',best);document.getElementById('best').textContent=best}document.getElementById('finalMoves').textContent=moves;const r=moves<=pairsN+2?'Perfect memory!':moves<=pairsN*2?'Great!':moves<=pairsN*3?'Good!':'Keep practicing!';document.getElementById('summary').innerHTML=r+'<br>Completed in '+sec+'s'+(moves<=+best?' <span class="high">★ New Best!</span>':'');show('result')}
</script></body></html>`;
}

function snakeGameHTML(title) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0,user-scalable=no"><title>${title || 'Snake Game'}</title>
<style>${GAME_CSS_BASE}
canvas{border-radius:12px;background:var(--surface);display:block;margin:1rem auto;image-rendering:pixelated;touch-action:none}
.controls{display:grid;grid-template-columns:repeat(3,56px);grid-template-rows:repeat(2,56px);gap:6px;justify-content:center;margin:1rem auto}
.controls button{border:none;border-radius:10px;background:var(--surface);color:var(--text);font-size:1.4rem;cursor:pointer;display:flex;align-items:center;justify-content:center}
.controls button:active{background:var(--primary)}
</style></head><body>
<div class="container">
<h1>${title || 'Snake'}</h1>
<div id="state-menu">
<p style="color:var(--muted);margin:1rem 0">Arrow keys or swipe to control</p>
<div class="stats"><span>Best<b id="best">0</b></span></div>
<button class="btn" onclick="startGame()">Play</button>
</div>
<div id="state-play" class="hidden">
<div class="stats"><span>Score<b id="score">0</b></span><span>Best<b id="hiscore">0</b></span></div>
<canvas id="cv" width="320" height="320"></canvas>
<div class="controls">
<div></div><button ontouchstart="setDir(0,-1)" onclick="setDir(0,-1)">▲</button><div></div>
<button ontouchstart="setDir(-1,0)" onclick="setDir(-1,0)">◀</button><button ontouchstart="setDir(0,1)" onclick="setDir(0,1)">▼</button><button ontouchstart="setDir(1,0)" onclick="setDir(1,0)">▶</button>
</div>
</div>
<div id="state-result" class="hidden">
<div class="score" id="final">0</div>
<div id="summary" style="font-size:1.1rem;margin:1rem 0"></div>
<button class="btn" onclick="startGame()">Play Again</button>
</div>
</div>
<script>
const S=20,W=16,cv=document.getElementById('cv'),ctx=cv.getContext('2d');
let snake,dir,food,sc,best=+(localStorage.getItem('snake_best')||0),loop,nextDir;
document.getElementById('best').textContent=best;document.getElementById('hiscore').textContent=best;
function show(id){document.querySelectorAll('[id^=state-]').forEach(e=>e.classList.add('hidden'));document.getElementById('state-'+id).classList.remove('hidden')}
function rand(){let p;do{p={x:Math.floor(Math.random()*W),y:Math.floor(Math.random()*W)}}while(snake.some(s=>s.x===p.x&&s.y===p.y));return p}
function startGame(){snake=[{x:8,y:8},{x:7,y:8},{x:6,y:8}];dir={x:1,y:0};nextDir={x:1,y:0};food=rand();sc=0;document.getElementById('score').textContent=0;show('play');clearInterval(loop);loop=setInterval(tick,120)}
function setDir(x,y){if(x===-dir.x&&y===-dir.y)return;nextDir={x,y}}
function tick(){dir=nextDir;const h={x:snake[0].x+dir.x,y:snake[0].y+dir.y};if(h.x<0||h.x>=W||h.y<0||h.y>=W||snake.some(s=>s.x===h.x&&s.y===h.y))return endGame();snake.unshift(h);if(h.x===food.x&&h.y===food.y){sc++;document.getElementById('score').textContent=sc;food=rand()}else{snake.pop()}draw()}
function draw(){ctx.fillStyle='#141428';ctx.fillRect(0,0,320,320);ctx.fillStyle='#FF6584';ctx.beginPath();ctx.arc(food.x*S+S/2,food.y*S+S/2,S/2-2,0,Math.PI*2);ctx.fill();snake.forEach((s,i)=>{const t=i/snake.length;ctx.fillStyle=i===0?'#6C63FF':'hsl('+(260+t*40)+',70%,'+(60-t*15)+'%)';ctx.beginPath();ctx.roundRect(s.x*S+1,s.y*S+1,S-2,S-2,4);ctx.fill()})}
function endGame(){clearInterval(loop);if(sc>best){best=sc;localStorage.setItem('snake_best',best);document.getElementById('best').textContent=best;document.getElementById('hiscore').textContent=best}document.getElementById('final').textContent=sc;const r=sc>=30?'Legend!':sc>=20?'Amazing!':sc>=10?'Great!':sc>=5?'Good!':'Try again!';document.getElementById('summary').innerHTML=r+(sc>=best&&sc>0?' <span class="high">★ New Best!</span>':'');show('result')}
document.addEventListener('keydown',e=>{if(e.key==='ArrowUp')setDir(0,-1);if(e.key==='ArrowDown')setDir(0,1);if(e.key==='ArrowLeft')setDir(-1,0);if(e.key==='ArrowRight')setDir(1,0)});
let tx,ty;cv.addEventListener('touchstart',e=>{tx=e.touches[0].clientX;ty=e.touches[0].clientY},{passive:true});
cv.addEventListener('touchend',e=>{const dx=e.changedTouches[0].clientX-tx,dy=e.changedTouches[0].clientY-ty;if(Math.abs(dx)>Math.abs(dy)){setDir(dx>0?1:-1,0)}else{setDir(0,dy>0?1:-1)}},{passive:true});
</script></body></html>`;
}

function reactionGameHTML(title) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0,user-scalable=no"><title>${title || 'Reaction Test'}</title>
<style>${GAME_CSS_BASE}
.zone{width:min(340px,85vw);height:min(340px,85vw);border-radius:24px;display:flex;align-items:center;justify-content:center;margin:1.5rem auto;cursor:pointer;font-size:1.2rem;font-weight:600;transition:background .2s}
.zone.wait{background:var(--surface)}
.zone.ready{background:var(--secondary);color:#fff}
.zone.go{background:var(--accent);color:var(--bg)}
.zone.early{background:#EF4444}
.times{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin:1rem 0}
.times span{background:var(--surface);padding:.3rem .6rem;border-radius:6px;font-size:.85rem;font-variant-numeric:tabular-nums}
.ms{font-size:3.5rem;font-weight:900;font-variant-numeric:tabular-nums}
</style></head><body>
<div class="container">
<h1>${title || 'Reaction Test'}</h1>
<div id="state-menu">
<p style="color:var(--muted);margin:1rem 0">Tap when the color turns green — 5 rounds</p>
<div class="stats"><span>Best Avg<b id="best">-</b></span></div>
<button class="btn" onclick="startGame()">Start</button>
</div>
<div id="state-play" class="hidden">
<div class="stats"><span>Round<b id="round">1/5</b></span><span>Avg<b id="avg">-</b></span></div>
<div class="zone wait" id="zone" onmousedown="tap()" ontouchstart="tap()">
<span id="zoneText">Wait...</span>
</div>
<div class="times" id="times"></div>
</div>
<div id="state-result" class="hidden">
<div class="ms" id="finalMs">0</div>
<p style="font-size:1.2rem;margin:.5rem 0">ms average</p>
<div id="summary" style="margin:1rem 0"></div>
<div class="times" id="finalTimes"></div>
<button class="btn" style="margin-top:1rem" onclick="startGame()">Try Again</button>
</div>
</div>
<script>
const ROUNDS=5;
let round,results,phase,greenAt,tmr,best=localStorage.getItem('react_best');
document.getElementById('best').textContent=best?best+'ms':'-';
function show(id){document.querySelectorAll('[id^=state-]').forEach(e=>e.classList.add('hidden'));document.getElementById('state-'+id).classList.remove('hidden')}
function startGame(){round=0;results=[];document.getElementById('times').innerHTML='';show('play');nextRound()}
function nextRound(){if(round>=ROUNDS)return endGame();document.getElementById('round').textContent=(round+1)+'/'+ROUNDS;const z=document.getElementById('zone');z.className='zone ready';document.getElementById('zoneText').textContent='Wait for green...';phase='wait';const delay=1500+Math.random()*3000;clearTimeout(tmr);tmr=setTimeout(()=>{z.className='zone go';document.getElementById('zoneText').textContent='TAP NOW!';greenAt=Date.now();phase='go'},delay)}
function tap(){if(phase==='wait'){clearTimeout(tmr);const z=document.getElementById('zone');z.className='zone early';document.getElementById('zoneText').textContent='Too early! Tap to retry';phase='early'}else if(phase==='early'){nextRound()}else if(phase==='go'){const ms=Date.now()-greenAt;results.push(ms);const t=document.createElement('span');t.textContent=ms+'ms';document.getElementById('times').appendChild(t);const avg=Math.round(results.reduce((a,b)=>a+b,0)/results.length);document.getElementById('avg').textContent=avg+'ms';round++;phase='done';setTimeout(nextRound,600)}}
function endGame(){const avg=Math.round(results.reduce((a,b)=>a+b,0)/results.length);if(!best||avg<+best){best=avg;localStorage.setItem('react_best',best);document.getElementById('best').textContent=best+'ms'}document.getElementById('finalMs').textContent=avg;document.getElementById('finalTimes').innerHTML=results.map((r,i)=>'<span>R'+(i+1)+': '+r+'ms</span>').join('');const r=avg<=200?'Superhuman!':avg<=250?'Lightning!':avg<=300?'Fast!':avg<=400?'Average':'Keep practicing!';document.getElementById('summary').innerHTML='<span style="font-size:1.2rem">'+r+'</span>'+(avg<=+best?' <span class="high">★ New Best!</span>':'');show('result')}
</script></body></html>`;
}

function typingGameHTML(title) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0,user-scalable=no"><title>${title || 'Typing Game'}</title>
<style>${GAME_CSS_BASE}
.word-display{font-size:2rem;font-weight:700;letter-spacing:.1em;margin:1.5rem 0;min-height:3rem;display:flex;justify-content:center;gap:2px;flex-wrap:wrap}
.word-display .ch{transition:color .1s}
.word-display .correct{color:var(--accent)}
.word-display .wrong{color:var(--secondary)}
.word-display .cursor{border-bottom:3px solid var(--primary);animation:blink 1s step-end infinite}
@keyframes blink{50%{border-color:transparent}}
input.type-input{background:var(--surface);border:2px solid var(--primary);border-radius:12px;padding:.75rem 1rem;font-size:1.2rem;color:var(--text);width:100%;text-align:center;outline:none;caret-color:var(--primary)}
.word-queue{color:var(--muted);font-size:1rem;margin:.5rem 0;height:2em;overflow:hidden;display:flex;gap:1rem;justify-content:center;flex-wrap:wrap}
</style></head><body>
<div class="container">
<h1>${title || 'Typing Speed'}</h1>
<div id="state-menu">
<p style="color:var(--muted);margin:1rem 0">Type as many words as you can in 30 seconds</p>
<div class="stats"><span>Best WPM<b id="best">0</b></span></div>
<button class="btn" onclick="startGame()">Start</button>
</div>
<div id="state-play" class="hidden">
<div class="stats"><span>Time<b id="timer">30</b></span><span>Words<b id="words">0</b></span><span>WPM<b id="wpm">0</b></span></div>
<div class="timer-bar"><div class="fill" id="bar" style="width:100%"></div></div>
<div class="word-display" id="display"></div>
<div class="word-queue" id="queue"></div>
<input class="type-input" id="inp" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Type here...">
</div>
<div id="state-result" class="hidden">
<div class="score" id="finalWpm">0</div>
<p style="font-size:1.2rem;margin:.5rem 0">WPM</p>
<div id="summary" style="font-size:1.1rem;margin:1rem 0"></div>
<button class="btn" onclick="startGame()">Play Again</button>
</div>
</div>
<script>
const WORDS=["the","be","to","of","and","in","that","have","it","for","not","on","with","he","as","you","do","at","this","but","his","by","from","they","we","say","her","she","or","an","will","my","one","all","would","there","their","what","so","up","out","if","about","who","get","which","go","me","when","make","can","like","time","no","just","him","know","take","people","into","year","your","good","some","could","them","see","other","than","then","now","look","only","come","its","over","think","also","back","after","use","two","how","our","work","first","well","way","even","new","want","give","most","find","here","thing","many","code","fast","type","game","play","next","open","read","test","data","file","line","word","text","long","name","part","best","help","made","move","hand","high","keep","last","same","tell","does","set","each","much","head","turn","real","show","full","form","left","start","might","run","need","home","life","old","big","end","point","still","call","live","away","right","hard","plan","team","late","mind","wait","stop","must","land","close","draw","press","mark","step","pick","rock","blue","deep","dark","hold","four","week","room","free","fall","base","rest","less","note","hear","ever"];
const DUR=30000;let pool,cur,pos,done,startT,tmr,best=+(localStorage.getItem('type_best')||0);
document.getElementById('best').textContent=best;
function show(id){document.querySelectorAll('[id^=state-]').forEach(e=>e.classList.add('hidden'));document.getElementById('state-'+id).classList.remove('hidden')}
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function startGame(){pool=shuffle([...WORDS]);cur=0;pos=0;done=0;startT=Date.now();document.getElementById('words').textContent=0;document.getElementById('wpm').textContent=0;const inp=document.getElementById('inp');inp.value='';show('play');inp.focus();renderWord();tmr=setInterval(tick,100)}
function renderWord(){const w=pool[cur%pool.length];const d=document.getElementById('display');d.innerHTML=w.split('').map((c,i)=>{let cls=i<pos?(document.getElementById('inp').value[i]===c?'correct':'wrong'):'';if(i===pos)cls+=' cursor';return '<span class="ch '+cls+'">'+c+'</span>'}).join('');const q=document.getElementById('queue');q.innerHTML='';for(let i=1;i<=5;i++){const nw=pool[(cur+i)%pool.length];q.innerHTML+='<span>'+nw+'</span>'}}
function tick(){const el=Date.now()-startT;const pct=Math.max(0,1-el/DUR)*100;document.getElementById('bar').style.width=pct+'%';document.getElementById('timer').textContent=Math.max(0,Math.ceil((DUR-el)/1000));if(el>=DUR)endGame()}
document.getElementById('inp').addEventListener('input',function(){if(Date.now()-startT>DUR)return;const w=pool[cur%pool.length];const v=this.value;pos=v.length;if(v.endsWith(' ')||v.length>=w.length){if(v.trim()===w){done++;document.getElementById('words').textContent=done;const wpm=Math.round(done/((Date.now()-startT)/60000));document.getElementById('wpm').textContent=wpm}cur++;pos=0;this.value=''}renderWord()});
function endGame(){clearInterval(tmr);document.getElementById('inp').blur();const wpm=Math.round(done/((DUR)/60000));if(wpm>best){best=wpm;localStorage.setItem('type_best',best);document.getElementById('best').textContent=best}document.getElementById('finalWpm').textContent=wpm;const r=wpm>=80?'Blazing fast!':wpm>=60?'Excellent!':wpm>=40?'Good!':wpm>=20?'Decent!':'Keep practicing!';document.getElementById('summary').innerHTML=r+'<br>'+done+' words in 30s'+(wpm>=best&&wpm>0?' <span class="high">★ New Best!</span>':'');show('result')}
</script></body></html>`;
}

function breakoutGameHTML(title) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0,user-scalable=no"><title>${title || 'Breakout'}</title>
<style>${GAME_CSS_BASE}
canvas{border-radius:12px;background:var(--surface);display:block;margin:1rem auto;touch-action:none}
</style></head><body>
<div class="container">
<h1>${title || 'Breakout'}</h1>
<div id="state-menu">
<p style="color:var(--muted);margin:1rem 0">Move the paddle to break all blocks</p>
<div class="stats"><span>Best<b id="best">0</b></span></div>
<button class="btn" onclick="startGame()">Play</button>
</div>
<div id="state-play" class="hidden">
<div class="stats"><span>Score<b id="score">0</b></span><span>Lives<b id="lives">3</b></span></div>
<canvas id="cv" width="360" height="480"></canvas>
</div>
<div id="state-result" class="hidden">
<div class="score" id="final">0</div>
<div id="summary" style="font-size:1.1rem;margin:1rem 0"></div>
<button class="btn" onclick="startGame()">Play Again</button>
</div>
</div>
<script>
const cv=document.getElementById('cv'),ctx=cv.getContext('2d'),W=360,H=480;
const COLS=8,ROWS=5,BW=W/COLS-4,BH=18,PAD_W=70,PAD_H=12,BR=6;
let px,ball,dx,dy,bricks,sc,lives,best=+(localStorage.getItem('brk_best')||0),raf;
document.getElementById('best').textContent=best;
function show(id){document.querySelectorAll('[id^=state-]').forEach(e=>e.classList.add('hidden'));document.getElementById('state-'+id).classList.remove('hidden')}
const COLORS=['#6C63FF','#8B5CF6','#A78BFA','#FF6584','#00D4AA'];
function initBricks(){bricks=[];for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++)bricks.push({x:c*(BW+4)+2,y:r*(BH+4)+40,w:BW,h:BH,color:COLORS[r],alive:true})}
function startGame(){px=W/2;ball={x:W/2,y:H-60};dx=3*(Math.random()>.5?1:-1);dy=-3.5;sc=0;lives=3;initBricks();document.getElementById('score').textContent=0;document.getElementById('lives').textContent=3;show('play');cancelAnimationFrame(raf);tick()}
function tick(){update();draw();if(lives>0&&bricks.some(b=>b.alive))raf=requestAnimationFrame(tick);else endGame()}
function update(){ball.x+=dx;ball.y+=dy;if(ball.x<=BR||ball.x>=W-BR)dx=-dx;if(ball.y<=BR)dy=-dy;if(ball.y>=H-PAD_H-BR-8&&ball.y<=H-8&&ball.x>=px-PAD_W/2&&ball.x<=px+PAD_W/2){dy=-Math.abs(dy);dx+=((ball.x-px)/(PAD_W/2))*2}if(ball.y>H){lives--;document.getElementById('lives').textContent=lives;if(lives>0){ball={x:W/2,y:H-60};dx=3*(Math.random()>.5?1:-1);dy=-3.5}}for(const b of bricks){if(!b.alive)continue;if(ball.x+BR>b.x&&ball.x-BR<b.x+b.w&&ball.y+BR>b.y&&ball.y-BR<b.y+b.h){b.alive=false;dy=-dy;sc+=10;document.getElementById('score').textContent=sc}}}
function draw(){ctx.clearRect(0,0,W,H);for(const b of bricks){if(!b.alive)continue;ctx.fillStyle=b.color;ctx.beginPath();ctx.roundRect(b.x,b.y,b.w,b.h,4);ctx.fill()}ctx.fillStyle='#6C63FF';ctx.beginPath();ctx.roundRect(px-PAD_W/2,H-PAD_H-8,PAD_W,PAD_H,6);ctx.fill();ctx.fillStyle='#FF6584';ctx.beginPath();ctx.arc(ball.x,ball.y,BR,0,Math.PI*2);ctx.fill()}
function endGame(){cancelAnimationFrame(raf);const won=!bricks.some(b=>b.alive);if(sc>best){best=sc;localStorage.setItem('brk_best',best);document.getElementById('best').textContent=best}document.getElementById('final').textContent=sc;document.getElementById('summary').innerHTML=(won?'You cleared it!':'Game Over')+(sc>=best&&sc>0?' <span class="high">★ New Best!</span>':'');show('result')}
cv.addEventListener('mousemove',e=>{const r=cv.getBoundingClientRect();px=Math.max(PAD_W/2,Math.min(W-PAD_W/2,(e.clientX-r.left)*(W/r.width)))});
cv.addEventListener('touchmove',e=>{e.preventDefault();const r=cv.getBoundingClientRect();px=Math.max(PAD_W/2,Math.min(W-PAD_W/2,(e.touches[0].clientX-r.left)*(W/r.width)))},{passive:false});
document.addEventListener('keydown',e=>{if(e.key==='ArrowLeft')px=Math.max(PAD_W/2,px-20);if(e.key==='ArrowRight')px=Math.min(W-PAD_W/2,px+20)});
</script></body></html>`;
}

const GAME_GENERATORS = {
  tapping: tappingGameHTML,
  quiz: quizGameHTML,
  memory: memoryGameHTML,
  snake: snakeGameHTML,
  reaction: reactionGameHTML,
  typing: typingGameHTML,
  breakout: breakoutGameHTML,
};

function gameHTML(type, title) {
  const gen = GAME_GENERATORS[type] || tappingGameHTML;
  return gen(title);
}

function gameNaideCode(title, port) {
  return `server game port ${port}:
  cors "*"

  get "/" (req, res):
    res.sendFile("index.html", {root: "."})

  get "/api/health" (req, res):
    ret {status: "ok", game: "${title || 'game'}"}
`;
}

function compose(intents, params) {
  // Game intent: generate minimal server code (game HTML is generated separately in project mode)
  if (params.gameType && intents.has('game') && !intents.has('crud')) {
    return gameNaideCode(params.gameTitle || params.gameType, params.port);
  }

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

  // Rate limiting & logging middleware (B12, C17)
  if (intents.has('server')) {
    sections.push(rateLimitBlock());
    sections.push(loggingBlock());
  }

  // RBAC middleware (D1)
  if (hasAuth) {
    sections.push(rbacBlock());
  }

  // Input validation functions (A4)
  if (intents.has('schema') && intents.has('crud')) {
    for (const entity of entities) {
      sections.push(validationBlock(entity));
    }
  }

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
    // M:N junction table schemas (S3)
    const m2mRels = detectManyToMany(entities.map(e => e.name));
    for (const rel of m2mRels) {
      sections.push(junctionSchemaBlock(rel));
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
      body.push('  public "/docs"');
      body.push('  public "/api/openapi.json"');
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

      // Password reset routes (A6)
      if (userEntity) {
        body.push('');
        body.push(...passwordResetRoutes());
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

    // Validated create/update routes (A4)
    if (intents.has('crud') && intents.has('schema')) {
      for (const entity of entities) {
        body.push(...validatedCreateRoute(entity));
        body.push('');
      }
    }

    // Nested routes for relationships
    for (const rel of relationships) {
      body.push(...nestedRouteBlock(rel.parent, rel.child, rel.fk));
      body.push('');
    }

    // M:N routes (S3)
    const m2mRels = detectManyToMany(entities.map(e => e.name));
    for (const rel of m2mRels) {
      body.push(...manyToManyRoutes(rel));
      body.push('');
    }

    // WebSocket with rooms + auth (B11, D4)
    if (intents.has('websocket')) {
      body.push(...wsRoomsBlock(hasAuth));
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

    // RBAC role-guarded delete routes (D1)
    if (hasAuth && intents.has('crud') && intents.has('schema')) {
      for (const entity of entities) {
        body.push(...rbacRouteGuards(entity));
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

    // Swagger UI (A5)
    body.push(...swaggerUIRoute());
    body.push('');

    // Cache control (C18)
    body.push(...cachingRoute());
    body.push('');

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
  'Intent':    'server, api, rest, bot, cli, page, test, database, ai, crud, auth, websocket, mail, graphql, game',
  'Composite': 'todo, blog, chat, shop, fullstack, board, crm, inventory, booking, sns',
  'Game':      'tapping, quiz, memory, snake, typing, reaction, breakout',
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

  // Game project: generate standalone HTML game
  if (intents.has('game') && result.analysis && result.analysis.gameType) {
    const gt = result.analysis.gameType;
    const title = result.analysis.gameTitle || gt;
    const projectName = safeName(gt) + '-game';
    const html = gameHTML(gt, title);

    files.push({ path: 'index.html', content: html });
    files.push({ path: 'app.naide', content: result.code });
    files.push({ path: 'package.json', content: JSON.stringify({
      name: projectName, version: '1.0.0', type: 'module',
      scripts: { dev: 'naide app.naide', start: 'naide app.naide', open: 'start index.html' },
      dependencies: { express: '^4.21.0', naider: '^1.21.0' },
    }, null, 2) + '\n' });
    files.push({ path: '.gitignore', content: 'node_modules/\n' });
    files.push({ path: 'README.md', content: `# ${title}\n\nGenerated by NAIDE Agent Coder (~~)\n\n## Play\n\nOpen \`index.html\` directly in a browser, or:\n\n\`\`\`bash\nnpm install && npm run dev\n\`\`\`\n\nThen visit http://localhost:${result.port}\n` });

    return {
      ...result,
      files,
      analysis: { ...result.analysis, plan: [`Game: ${gt}`, `Standalone HTML + CSS + JS`, `High scores saved in localStorage`, `Touch & keyboard support`, `Server on port ${result.port}`] },
    };
  }

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
      test: 'node --test test.mjs',
      'test:unit': 'naide test app.naide',
      seed: 'naide app.naide --run-seed',
      migrate: 'naide migrate.naide',
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
    readmeLines.push(`- \`GET /docs\` — Swagger UI`);
    for (const e of entities) {
      const ep = pluralize(e.toLowerCase());
      readmeLines.push(`- \`GET /api/${ep}?page=1&limit=20&search=&sort=id&order=desc\` — List (paginated, sortable, filterable)`);
      readmeLines.push(`- \`POST /api/${ep}\` — Create (validated)`, `- \`PUT /api/${ep}/:id\` — Update (validated)`);
      readmeLines.push(`- \`GET /api/${ep}/:id\` — Get`, `- \`DELETE /api/${ep}/:id\` — Delete`);
      readmeLines.push(`- \`DELETE /api/${ep}/:id/soft\` — Soft delete`, `- \`PUT /api/${ep}/:id/restore\` — Restore`);
      readmeLines.push(`- \`POST /api/${ep}/batch\` — Batch create`, `- \`DELETE /api/${ep}/batch\` — Batch delete`);
    }
    for (const r of result.analysis.relationships) {
      readmeLines.push(`- \`GET /api/${pluralize(r.parent.toLowerCase())}/:id/${pluralize(r.child.toLowerCase())}\` — ${r.child}s by ${r.parent}`);
    }
    readmeLines.push(`- \`POST /api/upload\` — File upload`, `- \`POST /api/webhooks\` — Webhook`);
    if (intents.has('auth')) {
      readmeLines.push(`- \`POST /api/auth/register\` — Register`, `- \`POST /api/auth/login\` — Login`, `- \`GET /api/auth/me\` — Current user`);
      readmeLines.push(`- \`POST /api/auth/forgot-password\` — Forgot password`, `- \`POST /api/auth/reset-password\` — Reset password`);
      readmeLines.push(`- \`POST /api/auth/change-password\` — Change password`, `- \`GET /api/admin/stats\` — Admin stats`);
    }
  }
  if (intents.has('server')) {
    readmeLines.push(`\n## Docker\n`, '```bash', `docker-compose up -d`, '```');
  }
  readmeLines.push(`\n## Generated Files\n`);
  readmeLines.push('| File | Purpose |', '|------|---------|');
  readmeLines.push('| app.naide | Main application |', '| index.html | Frontend SPA |', '| admin.html | Admin dashboard |');
  readmeLines.push('| client.mjs | API client library |', '| openapi.json | OpenAPI 3.0 spec |');
  readmeLines.push('| docker-compose.yml | Docker orchestration |', '| .github/workflows/ci.yml | CI/CD pipeline |');
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

  // Frontend SPA (S2)
  if (intents.has('server') && entityObjs.length > 0) {
    files.push({ path: 'index.html', content: frontendSPA(entityObjs, intents, result.port) });
  }

  // Docker Compose (B14)
  if (intents.has('server')) {
    files.push({ path: 'docker-compose.yml', content: dockerCompose(projectName, result.port, intents) });
  }

  // Environment files (C15)
  files.push({ path: '.env.development', content: envDevelopment(result.port, intents) });
  files.push({ path: '.env.production', content: envProduction(result.port, intents) });

  // GitHub Actions CI (C16)
  files.push({ path: '.github/workflows/ci.yml', content: githubActionsCI(projectName) });

  // Test runner (D2)
  if (intents.has('server') && entityObjs.length > 0) {
    files.push({ path: 'test.mjs', content: testRunnerFile(entityObjs, intents, result.port) });
  }

  // DB migration (D3)
  if (intents.has('database') && entityObjs.length > 0) {
    const m2mRels = detectManyToMany(entities.map(e => e));
    files.push({ path: 'migrate.naide', content: migrationFile(entityObjs, result.relationships || [], m2mRels) });
  }

  return { ...result, files };
}

// ── Project Update Mode ───────────────────────────────────

export function updateProject(projectDir, instruction, options = {}) {
  const appPath = projectDir + '/app.naide';
  const existing = _existsFS(appPath) ? _readFS(appPath, 'utf-8') : '';

  const existingState = existing ? parseExistingProject(existing) : { entities: [], intents: [], port: 3000 };
  const newResult = generate(instruction, options);

  // Entity removal detection (B8)
  const isRemoval = /(?:remove|delete|drop|取り除|削除)\s+/i.test(instruction);
  let removedEntities = [];
  if (isRemoval) {
    const removeTargets = (newResult.entities || []);
    removedEntities = existingState.entities.filter(e => removeTargets.includes(e));
    const allEntities = existingState.entities.filter(e => !removeTargets.includes(e));
    if (allEntities.length === 0) {
      return { code: '', valid: true, fixed: false, repairs: [], intents: [], entities: [], relationships: [], port: existingState.port,
        files: [{ path: 'app.naide', content: '' }], analysis: { instruction, entities: [], relationships: [], plan: [`Removed: ${removedEntities.join(', ')}`], added: [] },
        action: 'removed', removed: removedEntities };
    }
    const combinedIntents = existingState.intents.filter(i => i !== 'schema' || allEntities.length > 0);
    const extras = [];
    if (combinedIntents.includes('auth')) extras.push('auth');
    if (combinedIntents.includes('websocket')) extras.push('websocket');
    if (combinedIntents.includes('database')) extras.push('database');
    const fullInstruction = 'REST API for ' + allEntities.join(' and ') + (extras.length ? ' with ' + extras.join(' and ') : '');
    const combined = generate(fullInstruction, options);
    const result = buildUpdateFiles(projectDir, combined, allEntities, existingState, options);
    result.action = 'removed';
    result.removed = removedEntities;
    result.analysis.plan.unshift(`Removed: ${removedEntities.join(', ')}`);
    return result;
  }

  const newEntities = (newResult.entities || []).filter(e => !existingState.entities.includes(e));
  const allEntities = [...existingState.entities, ...newEntities];
  const combinedIntents = [...new Set([...existingState.intents, ...newResult.intents])];
  const extras = [];
  if (combinedIntents.includes('auth')) extras.push('auth');
  if (combinedIntents.includes('websocket')) extras.push('websocket');
  if (combinedIntents.includes('database')) extras.push('database');
  const fullInstruction = 'REST API for ' + allEntities.join(' and ') + (extras.length ? ' with ' + extras.join(' and ') : '');

  const combined = generate(fullInstruction, options);
  return buildUpdateFiles(projectDir, combined, allEntities, existingState, options);
}

function buildUpdateFiles(projectDir, combined, allEntities, existingState, options) {
  const existing = _existsFS(projectDir + '/app.naide') ? _readFS(projectDir + '/app.naide', 'utf-8') : '';
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
  if (intents.has('auth')) { deps.jsonwebtoken = '^9.0.2'; deps.bcryptjs = '^2.4.3'; }
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

  const envL = [`PORT=${port}`];
  if (intents.has('auth')) envL.push('JWT_SECRET=change-me-in-production');
  if (intents.has('bot'))  envL.push(`${(options.platform || 'DISCORD').toUpperCase()}_TOKEN=your-bot-token`);
  if (intents.has('mail')) { envL.push('SMTP_HOST=smtp.example.com'); envL.push('SMTP_USER=user@example.com'); envL.push('SMTP_PASS=password'); }
  if (intents.has('ai'))   envL.push('OPENAI_API_KEY=your-api-key');
  const existingEnvPath = projectDir + '/.env';
  if (_existsFS(existingEnvPath)) {
    const existingEnv = _readFS(existingEnvPath, 'utf-8');
    const existingKeys = new Set(existingEnv.split('\n').map(l => l.split('=')[0]).filter(Boolean));
    const newEnvLines = envL.filter(l => !existingKeys.has(l.split('=')[0]));
    if (newEnvLines.length > 0) files.push({ path: '.env', content: existingEnv.trimEnd() + '\n' + newEnvLines.join('\n') + '\n' });
  } else {
    files.push({ path: '.env', content: envL.join('\n') + '\n' });
  }

  files.push({ path: '.gitignore', content: 'node_modules/\ndist/\ndata/\n.env\n*.mjs\n' });

  if (intents.has('server')) {
    files.push({ path: 'Dockerfile', content: `FROM node:22-slim\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --omit=dev\nRUN npm install -g naider\nCOPY . .\nRUN naide app.naide --emit -o dist/app.mjs\nEXPOSE ${port}\nCMD ["node", "dist/app.mjs"]\n` });
    files.push({ path: '.dockerignore', content: 'node_modules\ndist\ndata\n.env\n.git\n' });
    files.push({ path: 'docker-compose.yml', content: dockerCompose(projectName, port, intents) });
  }

  files.push({ path: '.env.development', content: envDevelopment(port, intents) });
  files.push({ path: '.env.production', content: envProduction(port, intents) });
  files.push({ path: '.github/workflows/ci.yml', content: githubActionsCI(projectName) });

  const readmeLines = [`# ${projectName}\n`, `Generated by NAIDE Agent Coder (~~)\n`, `## Entities\n`];
  for (const e of entities) {
    const fc = SCHEMA_PRESETS[e.toLowerCase()]?.length || 3;
    readmeLines.push(`- **${e}** (${fc} fields)`);
  }
  if (relationships.length > 0) {
    readmeLines.push(`\n## Relationships\n`);
    for (const r of relationships) readmeLines.push(`- ${r.parent} → ${r.child} (${r.fk})`);
  }
  readmeLines.push(`\n## Quick Start\n`, '```bash', 'npm install', 'npm run dev', '```\n');
  if (intents.has('server')) {
    readmeLines.push(`## API Endpoints\n`, `- \`GET /api/health\` — Health check`, `- \`GET /docs\` — Swagger UI`);
    for (const e of entities) {
      const ep = pluralize(e.toLowerCase());
      readmeLines.push(`- \`GET /api/${ep}?page=1&limit=20&search=&sort=id&order=desc\` — List (paginated, sortable, filterable)`);
      readmeLines.push(`- \`POST /api/${ep}\` — Create (validated)`, `- \`PUT /api/${ep}/:id\` — Update (validated)`);
      readmeLines.push(`- \`GET /api/${ep}/:id\` — Get`, `- \`DELETE /api/${ep}/:id\` — Delete`);
      readmeLines.push(`- \`DELETE /api/${ep}/:id/soft\` — Soft delete`, `- \`PUT /api/${ep}/:id/restore\` — Restore`);
      readmeLines.push(`- \`POST /api/${ep}/batch\` — Batch create`, `- \`DELETE /api/${ep}/batch\` — Batch delete`);
    }
    readmeLines.push(`- \`POST /api/upload\` — File upload`, `- \`POST /api/webhooks\` — Webhook`);
    if (intents.has('auth')) {
      readmeLines.push(`- \`POST /api/auth/register\` — Register`, `- \`POST /api/auth/login\` — Login`, `- \`GET /api/auth/me\` — Current user`);
      readmeLines.push(`- \`POST /api/auth/forgot-password\` — Forgot password`, `- \`POST /api/auth/reset-password\` — Reset password`);
      readmeLines.push(`- \`POST /api/auth/change-password\` — Change password`, `- \`GET /api/admin/stats\` — Admin stats`);
    }
  }
  if (intents.has('server')) {
    readmeLines.push(`\n## Docker\n`, '```bash', `docker-compose up -d`, '```');
  }
  readmeLines.push(`\n## Generated Files\n`);
  readmeLines.push('| File | Purpose |', '|------|---------|');
  readmeLines.push('| app.naide | Main application |', '| index.html | Frontend SPA |', '| admin.html | Admin dashboard |');
  readmeLines.push('| client.mjs | API client library |', '| openapi.json | OpenAPI 3.0 spec |');
  readmeLines.push('| docker-compose.yml | Docker orchestration |', '| .github/workflows/ci.yml | CI/CD pipeline |');
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
    files.push({ path: 'index.html', content: frontendSPA(entityObjs, intents, port) });
  }
  if (intents.has('server')) {
    files.push({ path: 'client.mjs', content: apiClientCode(entityObjs, intents, port) });
  }

  const added = existing ? entities.filter(e => !existing.includes(`schema ${e}`)) : entities;
  const analysis = {
    instruction: '', entities: entityObjs.map(e => ({ name: e.name, fieldCount: e.fields.length })),
    relationships, plan: [], added,
  };
  if (added.length > 0) analysis.plan.push(`Added: ${added.join(', ')}`);
  if (existing) analysis.plan.push('Merged with existing app.naide');
  analysis.plan.push(`Total entities: ${entities.length}`, `Supporting files regenerated (${files.length} files)`);

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

  if (params.gameType) {
    plan.push(`Game: ${params.gameType}`);
    plan.push('Standalone HTML + CSS + JS');
    plan.push('High scores saved in localStorage');
    plan.push('Touch & keyboard support');
    return {
      instruction,
      entities: [],
      relationships: [],
      features: [...intents],
      plan,
      gameType: params.gameType,
      gameTitle: params.gameTitle,
    };
  }

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
  if (intents.has('server'))   plan.push(`Server on port ${params.port} (rate-limited, request logging)`);
  if (intents.has('crud'))     plan.push(`CRUD endpoints for ${params.entities.map(e => pluralize(e.name.toLowerCase())).join(', ')} (paginated, sortable, filterable)`);
  if (intents.has('crud'))     plan.push(`Input validation: ${params.entities.map(e => `validate${e.name}()`).join(', ')}`);
  if (intents.has('auth'))     plan.push('Auth: JWT + register/login/me + forgot/reset/change password + role-based admin');
  if (params.relationships.length > 0) plan.push(`Nested routes: ${params.relationships.map(r => `/${pluralize(r.parent.toLowerCase())}/:id/${pluralize(r.child.toLowerCase())}`).join(', ')}`);
  const m2m = detectManyToMany(params.entities.map(e => e.name));
  if (m2m.length > 0) plan.push(`M:N relations: ${m2m.map(r => `${r.left}↔${r.right} via ${r.junction}`).join(', ')}`);
  if (intents.has('auth'))     plan.push('RBAC: requireRole() middleware for admin/moderator/user');
  if (intents.has('websocket'))plan.push('WebSocket: rooms + broadcast' + (intents.has('auth') ? ' (token auth)' : ''));
  if (intents.has('ai'))       plan.push('AI endpoint: /api/ask');
  if (intents.has('bot'))      plan.push(`Bot: ${params.platform || 'discord'}`);
  if (intents.has('mail'))     plan.push('Mail: SMTP configuration');
  if (intents.has('graphql'))  plan.push('GraphQL endpoint');
  if (intents.has('page'))     plan.push('Page: HTML generation');
  if (intents.has('cli'))      plan.push('CLI app with flags');
  if (intents.has('server'))   plan.push('Swagger UI at /docs');
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

// ── Multi-Target Generation (D6) ─────────────────────────────

const TARGET_EXTENSIONS = {
  node: '.mjs', python: '.py', bun: '.mjs', typescript: '.ts',
  go: '.go', java: '.java', rust: '.rs', cpp: '.cpp', c: '.c',
  csharp: '.cs', kotlin: '.kt', swift: '.swift', dart: '.dart',
  php: '.php', ruby: '.rb',
};

const ALL_TARGETS = Object.keys(TARGET_EXTENSIONS);

export async function generateForTarget(instruction, target, options = {}) {
  const result = generate(instruction, options);
  if (!result.valid) return { ...result, compiled: null, target };

  let compiled;
  try {
    const { compile, compileAsync } = await import('./index.js');
    if (target === 'node') {
      const r = compile(result.code);
      compiled = r.js;
    } else {
      const r = await compileAsync(result.code, { target });
      compiled = r.code;
    }
  } catch (e) {
    compiled = null;
    result.compileError = e.message;
  }

  return { ...result, compiled, target, extension: TARGET_EXTENSIONS[target] || '.txt' };
}

export async function generateAllTargets(instruction, options = {}) {
  const result = generate(instruction, options);
  if (!result.valid) return { ...result, targets: {} };

  const targets = {};
  try {
    const { compile, compileAsync } = await import('./index.js');
    for (const target of ALL_TARGETS) {
      try {
        if (target === 'node') {
          targets[target] = { code: compile(result.code).js, ext: '.mjs' };
        } else {
          const r = await compileAsync(result.code, { target });
          targets[target] = { code: r.code, ext: TARGET_EXTENSIONS[target] };
        }
      } catch (e) {
        targets[target] = { error: e.message, ext: TARGET_EXTENSIONS[target] };
      }
    }
  } catch (e) {
    return { ...result, targets: {}, importError: e.message };
  }

  return { ...result, targets };
}
