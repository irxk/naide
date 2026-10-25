const classify = (status, names) => Object.fromEntries(names.split(/\s+/).filter(Boolean).map(name => [name, status]));

export const NATIVE_AST_SUPPORT = Object.freeze({
  ...classify('supported', `
    Array ArrowFn AssertStmt Assignment Binary Bool Break Call ClassDecl CompoundAssign
    Continue Destructure DoWhile Each EnumDecl ExprStatement For ForEach Function
    Identifier If IndexAccess Lambda Log Match MemberAccess Model New Null Number Object
    OptionalAccess OptionalCall OptionalIndexAccess Pipe Program RegExp Return Self
    Spread String Swap Ternary Throw Try TypeOf TypedVar Unary Update Use UseDestructured
    While QueueDecl
  `),
  ...classify('contextual', `
    AuthDecl Await AwaitAll AwaitAllExpr CacheDecl Computed CookieDecl CorsDecl CrudDecl DbDir DynamicImport
    CsvDecl     DefaultPattern EnvDecl ErrorHandler GroupDecl LimitDecl Middleware MiddlewareRef OpenapiDecl PromptDecl UploadDecl
    ReturnDownload ReturnMethod ReturnRedirect ReturnRender ReturnStatus Route SchemaDecl Server SessionDecl SseDecl
    StaticDecl TestDecl ValidateDecl ViewDecl
    Yield
  `),
  ...classify('supported', `
    CliApp EveryDecl I18nDecl LoggingDecl On Page Screen SearchDecl WatchDecl
  `),
  ...classify('contextual', 'Bot DbConnect DbSql MailConfig PushDecl StorageDecl BotEvent BotSlashCmd PageElement ScreenElement'),
  ...classify('contextual', `
    BlockchainDecl DesktopApp GraphqlDecl GrpcDecl ImageDecl
    MigrateDecl OauthDecl PayDecl PdfDecl
    WebrtcDecl WsDecl
  `),
});

export const NATIVE_SERVER_SUPPORT = Object.freeze({
  Route: Object.freeze({ status: 'supported' }),
  CrudDecl: Object.freeze({ status: 'supported' }),
  AuthDecl: Object.freeze({ status: 'supported' }),
  CorsDecl: Object.freeze({ status: 'supported' }),
  LimitDecl: Object.freeze({ status: 'supported' }),
  StaticDecl: Object.freeze({ status: 'supported' }),
  Middleware: Object.freeze({ status: 'supported' }),
  MiddlewareRef: Object.freeze({ status: 'supported' }),
  GroupDecl: Object.freeze({ status: 'supported' }),
  CookieDecl: Object.freeze({ status: 'supported' }),
  ErrorHandler: Object.freeze({ status: 'supported' }),
  ValidateDecl: Object.freeze({ status: 'supported' }),
  SessionDecl: Object.freeze({ status: 'supported' }),
  UploadDecl: Object.freeze({ status: 'supported' }),
  SseDecl: Object.freeze({ status: 'supported' }),
  WsDecl: Object.freeze({
    status: 'contextual',
    reason: 'Native WebSocket upgrade handling requires a nativeServices.websocket host adapter.',
  }),
  CacheDecl: Object.freeze({ status: 'supported' }),
  ViewDecl: Object.freeze({ status: 'supported' }),
  OpenapiDecl: Object.freeze({ status: 'supported' }),
  QueueDecl: Object.freeze({ status: 'supported' }),
  GraphqlDecl: Object.freeze({
    status: 'contextual',
    reason: 'Native GraphQL request handling requires a nativeServices.graphql host adapter.',
  }),
});
