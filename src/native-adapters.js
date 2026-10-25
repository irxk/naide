import { createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, realpath, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const NATIVE_ADAPTER_DEPENDENCIES = Object.freeze({
  image: Object.freeze(['sharp']),
  pdf: Object.freeze(['pdfkit']),
  graphql: Object.freeze(['graphql']),
  websocket: Object.freeze(['ws']),
});

export const NATIVE_ADAPTER_INSTALL_SPECS = Object.freeze({
  image: Object.freeze(['sharp@^0.33.5']),
  pdf: Object.freeze(['pdfkit@^0.16.0']),
  graphql: Object.freeze(['graphql@^16.10.0']),
  websocket: Object.freeze(['ws@^8.18.0']),
});

const OAUTH_PROVIDERS = Object.freeze({
  google: {
    authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    profileEndpoint: 'https://openidconnect.googleapis.com/v1/userinfo',
    defaultScope: 'openid email profile',
  },
  github: {
    authorizationEndpoint: 'https://github.com/login/oauth/authorize',
    tokenEndpoint: 'https://github.com/login/oauth/access_token',
    profileEndpoint: 'https://api.github.com/user',
    defaultScope: 'read:user user:email',
  },
});

function projectRequire(projectDirectory) {
  return createRequire(resolve(projectDirectory, '__naide_adapter__.cjs'));
}

function assertContained(root, target, label) {
  const path = resolve(target);
  const pathFromRoot = relative(root, path);
  if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw new Error(`Native ${label} path escapes the project directory.`);
  }
  return path;
}

async function loadProjectDependency(packageName, adapterName, requireFromProject) {
  let resolvedPath;
  try {
    resolvedPath = requireFromProject.resolve(packageName);
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    throw new Error(
      `The native ${adapterName} adapter requires npm package '${packageName}'. Install it with 'naide adapter install ${adapterName}'.`,
      { cause: error },
    );
  }
  return import(pathToFileURL(resolvedPath).href);
}

function createOAuthAdapter(config, fetcher) {
  const provider = OAUTH_PROVIDERS[config.provider.toLowerCase()];
  if (!provider) {
    throw new Error(`Native OAuth does not support provider '${config.provider}'. Supported providers: google, github.`);
  }
  if (typeof fetcher !== 'function') throw new TypeError('Native OAuth requires a Fetch-compatible HTTP implementation.');

  const pendingStates = new Map();
  const callbackPath = config.callback || '/auth/callback';
  const scope = config.scope || provider.defaultScope;
  const createRedirectUri = origin => {
    if (typeof origin !== 'string' || origin.length === 0) {
      throw new TypeError('OAuth origin must be a non-empty URL origin.');
    }
    const base = new URL(origin);
    if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) {
      throw new TypeError('OAuth redirect origins must use HTTPS, except for loopback development hosts.');
    }
    const redirect = new URL(callbackPath, base);
    if (redirect.origin !== base.origin) throw new TypeError('OAuth callback must stay on the configured origin.');
    return redirect.href;
  };

  const pruneStates = () => {
    const now = Date.now();
    for (const [state, entry] of pendingStates) {
      if (entry.expiresAt <= now) pendingStates.delete(state);
    }
    if (pendingStates.size >= 1000) {
      throw new Error('Too many pending OAuth authorization states; retry after existing requests expire.');
    }
  };

  return Object.freeze({
    begin: ({ origin, scope: requestedScope } = {}) => {
      pruneStates();
      const state = randomBytes(32).toString('base64url');
      const verifier = randomBytes(32).toString('base64url');
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      const redirectUri = createRedirectUri(origin);
      pendingStates.set(state, { verifier, redirectUri, expiresAt: Date.now() + 10 * 60 * 1000 });
      const authorizationUrl = new URL(provider.authorizationEndpoint);
      authorizationUrl.search = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: requestedScope || scope,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      }).toString();
      return Object.freeze({ url: authorizationUrl.href, state });
    },
    exchange: async ({ code, state, origin } = {}) => {
      if (typeof code !== 'string' || code.length === 0 || typeof state !== 'string' || state.length === 0) {
        throw new TypeError('OAuth code exchange requires non-empty code and state values.');
      }
      const pending = pendingStates.get(state);
      pendingStates.delete(state);
      if (!pending || pending.expiresAt <= Date.now()) {
        throw new Error('OAuth state is invalid, expired, or has already been used.');
      }
      if (origin && createRedirectUri(origin) !== pending.redirectUri) {
        throw new Error('OAuth callback origin does not match the authorization request.');
      }
      const response = await fetcher(provider.tokenEndpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code,
          redirect_uri: pending.redirectUri,
          code_verifier: pending.verifier,
          grant_type: 'authorization_code',
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`OAuth token exchange failed with HTTP ${response.status}.`);
      const tokens = await response.json();
      if (typeof tokens.access_token !== 'string' || tokens.access_token.length === 0) {
        throw new Error('OAuth provider response did not include an access token.');
      }
      const profileResponse = await fetcher(provider.profileEndpoint, {
        headers: {
          authorization: `Bearer ${tokens.access_token}`,
          accept: 'application/json',
          'user-agent': 'NAIDE',
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!profileResponse.ok) throw new Error(`OAuth profile request failed with HTTP ${profileResponse.status}.`);
      const profile = await profileResponse.json();
      return Object.freeze({ provider: config.provider.toLowerCase(), tokens, profile });
    },
  });
}

function toStripeFormData(items, prefix = '') {
  const result = new URLSearchParams();
  const append = (value, key) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => append(item, `${key}[${index}]`));
    } else if (typeof value === 'object') {
      for (const [childKey, childValue] of Object.entries(value)) {
        append(childValue, key ? `${key}[${childKey}]` : childKey);
      }
    } else {
      result.append(key, String(value));
    }
  };
  append(items, prefix);
  return result;
}

function createStripeAdapter(config, fetcher) {
  if (config.provider.toLowerCase() !== 'stripe') {
    throw new Error(`Native payments currently supports provider 'stripe', not '${config.provider}'.`);
  }
  if (typeof fetcher !== 'function') throw new TypeError('Native payments requires a Fetch-compatible HTTP implementation.');

  const apiRequest = async (path, parameters) => {
    const response = await fetcher(`https://api.stripe.com/v1/${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.secretKey}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: toStripeFormData(parameters),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json();
    if (!response.ok) {
      const code = body?.error?.code;
      throw new Error(`Stripe ${path} request failed with HTTP ${response.status}${code ? ` (${code})` : ''}.`);
    }
    return body;
  };

  return Object.freeze({
    createCheckoutSession: async ({ items, mode = 'payment', successUrl, cancelUrl, customerEmail } = {}) => {
      if (!Array.isArray(items) || items.length === 0) {
        throw new TypeError('Stripe checkout requires a non-empty items array.');
      }
      const resolvedSuccessUrl = successUrl ?? config.successUrl;
      const resolvedCancelUrl = cancelUrl ?? config.cancelUrl;
      if (typeof resolvedSuccessUrl !== 'string' || typeof resolvedCancelUrl !== 'string') {
        throw new TypeError('Stripe checkout requires success and cancellation URLs.');
      }
      for (const [label, url] of [['success', resolvedSuccessUrl], ['cancel', resolvedCancelUrl]]) {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))) {
          throw new TypeError(`Stripe ${label} URL must use HTTPS, except for loopback development hosts.`);
        }
      }
      if (!['payment', 'subscription', 'setup'].includes(mode)) {
        throw new TypeError("Stripe checkout mode must be 'payment', 'subscription', or 'setup'.");
      }
      for (const [index, item] of items.entries()) {
        if (!item || typeof item !== 'object' || typeof item.name !== 'string' || item.name.length === 0
          || !Number.isSafeInteger(item.unitAmount) || item.unitAmount < 0
          || !Number.isSafeInteger(item.quantity) || item.quantity < 1
          || typeof item.currency !== 'string' || !/^[a-z]{3}$/i.test(item.currency)) {
          throw new TypeError(`Stripe checkout item ${index} must contain name, non-negative unitAmount, positive quantity, and 3-letter currency.`);
        }
      }
      return apiRequest('checkout/sessions', {
        mode,
        success_url: resolvedSuccessUrl,
        cancel_url: resolvedCancelUrl,
        customer_email: customerEmail,
        line_items: items.map(item => ({
          quantity: item.quantity,
          price_data: {
            currency: item.currency.toLowerCase(),
            unit_amount: item.unitAmount,
            product_data: { name: item.name },
          },
        })),
      });
    },
    verifyWebhook: (rawBody, signature, toleranceSeconds = 300) => {
      if (typeof config.webhookSecret !== 'string' || config.webhookSecret.length === 0) {
        throw new Error("Stripe webhook verification requires the declaration's 'webhook-secret' value.");
      }
      if (!Buffer.isBuffer(rawBody) && typeof rawBody !== 'string') {
        throw new TypeError('Stripe webhook verification requires the exact raw request body.');
      }
      if (typeof signature !== 'string' || !Number.isSafeInteger(toleranceSeconds) || toleranceSeconds < 1) {
        throw new TypeError('Stripe webhook verification requires a signature and a positive tolerance.');
      }
      const fields = signature.split(',').map(field => field.split('=', 2));
      const timestamp = fields.find(([key]) => key === 't')?.[1];
      const signatures = fields.filter(([key]) => key === 'v1').map(([, value]) => value);
      if (!timestamp || !/^\d+$/.test(timestamp) || signatures.length === 0) {
        throw new TypeError('Stripe webhook signature header is malformed.');
      }
      const signedAt = Number(timestamp);
      if (!Number.isSafeInteger(signedAt) || Math.abs(Date.now() / 1000 - signedAt) > toleranceSeconds) {
        throw new Error('Stripe webhook signature timestamp is outside the allowed tolerance.');
      }
      const expected = createHmac('sha256', config.webhookSecret)
        .update(`${timestamp}.${rawBody}`)
        .digest();
      const valid = signatures.some(signatureValue => {
        if (!/^[0-9a-f]{64}$/i.test(signatureValue)) return false;
        return timingSafeEqual(Buffer.from(signatureValue, 'hex'), expected);
      });
      if (!valid) throw new Error('Stripe webhook signature is invalid.');
      try {
        return JSON.parse(rawBody.toString());
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        throw new TypeError('Stripe webhook body is not valid JSON.', { cause: error });
      }
    },
  });
}

async function createImageAdapter(config, loadPackage) {
  const module = await loadPackage('sharp', 'image');
  const sharp = module.default ?? module;
  if (typeof sharp !== 'function') throw new TypeError("The installed 'sharp' package does not export an image processor.");
  const processor = sharp(config.input);
  for (const operation of config.operations) {
    const [first, second, third, fourth] = operation.args;
    switch (operation.op) {
      case 'resize':
        processor.resize(first, second);
        break;
      case 'crop':
        if (![first, second, third ?? 0, fourth ?? 0].every(Number.isSafeInteger)) {
          throw new TypeError('Image crop requires integer width, height, left, and top values.');
        }
        processor.extract({ width: first, height: second, left: third ?? 0, top: fourth ?? 0 });
        break;
      case 'rotate':
        processor.rotate(first);
        break;
      case 'blur':
        processor.blur(first);
        break;
      case 'grayscale':
      case 'greyscale':
        processor.grayscale();
        break;
      case 'flip':
        processor.flip();
        break;
      case 'format':
        if (typeof first !== 'string') throw new TypeError('Image format requires a format name.');
        processor.toFormat(first);
        break;
      case 'watermark': {
        if (typeof first !== 'string' || first.length === 0) throw new TypeError('Image watermark requires a project-relative image path.');
        const root = await realpath(config.projectDirectory);
        const candidate = assertContained(root, resolve(root, first), 'image watermark');
        const watermark = await realpath(candidate);
        assertContained(root, watermark, 'image watermark');
        await access(watermark);
        processor.composite([{ input: watermark }]);
        break;
      }
      default:
        throw new Error(`Native image adapter does not support operation '${operation.op}'.`);
    }
  }
  return processor.toFile(config.output);
}

async function createPdfAdapter(config, loadPackage) {
  const module = await loadPackage('pdfkit', 'pdf');
  const PDFDocument = module.default ?? module;
  if (typeof PDFDocument !== 'function') throw new TypeError("The installed 'pdfkit' package does not export a PDFDocument constructor.");
  const document = new PDFDocument();
  const output = createWriteStream(config.filename, { flags: 'wx' });
  let outputOpened = false;
  output.once('open', () => { outputOpened = true; });
  const opened = new Promise((resolveOpened, rejectOpened) => {
    output.once('open', resolveOpened);
    output.once('error', rejectOpened);
  });
  const completed = new Promise((resolveCompletion, rejectCompletion) => {
    output.once('finish', resolveCompletion);
    output.once('error', rejectCompletion);
    output.once('close', () => {
      if (!output.writableFinished) rejectCompletion(new Error('PDF output stream closed before completion.'));
    });
    document.once('error', rejectCompletion);
  });
  document.pipe(output);
  try {
    await opened;
    for (const element of config.elements) {
      const [value] = element.args;
      switch (element.tag) {
        case 'title':
          document.fontSize(24).text(String(value ?? ''), { align: 'center' });
          document.moveDown();
          break;
        case 'heading':
          document.fontSize(18).text(String(value ?? ''));
          document.moveDown(0.5);
          break;
        case 'text':
        case 'paragraph':
          document.fontSize(12).text(typeof value === 'string' ? value : JSON.stringify(value ?? ''));
          document.moveDown();
          break;
        case 'page':
          document.addPage();
          break;
        default:
          throw new Error(`Native PDF adapter does not support element '${element.tag}'.`);
      }
    }
    document.end();
    await completed;
  } catch (error) {
    document.destroy();
    output.destroy();
    await completed.catch(() => {});
    if (outputOpened) await rm(config.filename, { force: true });
    throw error;
  }
  return Object.freeze({ filename: config.filename });
}

function decodeWebSocketMessage(data, isBinary) {
  if (isBinary) return Buffer.from(data);
  const text = Buffer.from(data).toString('utf8');
  try {
    return JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return text;
  }
}

async function createWebSocketAdapter(config, loadPackage) {
  const module = await loadPackage('ws', 'websocket');
  const WebSocketServer = module.WebSocketServer ?? module.default?.WebSocketServer;
  const WebSocket = module.WebSocket ?? module.default?.WebSocket;
  if (typeof WebSocketServer !== 'function' || !WebSocket) {
    throw new TypeError("The installed 'ws' package must export WebSocketServer and WebSocket.");
  }
  const server = new WebSocketServer({ noServer: true, maxPayload: 1_048_576, perMessageDeflate: false });
  const handler = (request, socket, head) => {
    server.handleUpgrade(request, socket, head, connection => {
      const api = Object.freeze({
        send: value => {
          if (connection.readyState !== WebSocket.OPEN) throw new Error('Cannot send on a closed WebSocket connection.');
          connection.send(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value));
        },
        close: (code = 1000, reason = '') => connection.close(code, reason),
        get readyState() { return connection.readyState; },
      });
      connection.on('message', (data, isBinary) => {
        const message = decodeWebSocketMessage(data, isBinary);
        Promise.resolve(config.events.message?.(message, api)).catch(error => {
          try {
            connection.close(1011, 'NAIDE handler failed');
          } finally {
            reportWebSocketHandlerError(config.events, error, api);
          }
        });
      });
      connection.on('close', (code, reason) => {
        Promise.resolve(config.events.close?.({ code, reason: reason.toString() }, api))
          .catch(error => reportWebSocketHandlerError(config.events, error, api));
      });
      connection.on('error', error => {
        Promise.resolve(config.events.error?.({ message: error.message }, api))
          .catch(handlerError => reportWebSocketHandlerError(config.events, handlerError, api));
      });
      for (const eventName of Object.keys(config.events)) {
        if (['message', 'close', 'error'].includes(eventName)) continue;
        connection.on(eventName, payload => {
          Promise.resolve(config.events[eventName](payload, api)).catch(error => {
            try {
              connection.close(1011, 'NAIDE handler failed');
            } finally {
              reportWebSocketHandlerError(config.events, error, api);
            }
          });
        });
      }
    });
  };
  const close = async () => {
    for (const connection of server.clients) connection.close(1001, 'Server shutting down');
    const timeout = setTimeout(() => {
      for (const connection of server.clients) connection.terminate();
    }, 5000);
    timeout.unref?.();
    try {
      await new Promise((resolveCompletion, rejectCompletion) => {
        server.close(error => error ? rejectCompletion(error) : resolveCompletion());
      });
    } finally {
      clearTimeout(timeout);
    }
  };
  return Object.freeze({ handler, close });
}

function reportWebSocketHandlerError(events, error, connection) {
  if (!events.error) {
    console.error('Native WebSocket event handler failed:', error);
    return;
  }
  Promise.resolve(events.error({ message: error.message }, connection)).catch(reportError => {
    console.error('Native WebSocket error handler failed:', reportError);
  });
}

async function createGraphqlAdapter(config, loadPackage) {
  const module = await loadPackage('graphql', 'graphql');
  const api = module.default && typeof module.default === 'object'
    ? { ...module.default, ...module }
    : module;
  if (typeof api.buildSchema !== 'function' || typeof api.graphql !== 'function') {
    throw new TypeError("The installed 'graphql' package must export buildSchema and graphql.");
  }
  const schemaDefinitions = [];
  const queryFields = [];
  const rootValue = {};
  const queryNames = new Set();
  const types = Object.entries(config.schemas || {});
  for (const [name, schema] of types) {
    if (!/^[A-Za-z_]\w*$/.test(name) || !schema?.fields || typeof schema.fields !== 'object') {
      throw new TypeError(`Native GraphQL received an invalid NAIDE schema '${name}'.`);
    }
    const typeFields = [];
    for (const [fieldName, field] of Object.entries(schema.fields)) {
      const graphType = {
        id: 'ID',
        timestamp: 'String',
        string: 'String',
        integer: 'Int',
        number: 'Float',
        boolean: 'Boolean',
        enum: 'String',
      }[field.type];
      if (!graphType) throw new Error(`Native GraphQL does not support NAIDE field type '${field.type}' on '${name}.${fieldName}'.`);
      typeFields.push(`  ${fieldName}: ${graphType}`);
    }
    if (typeFields.length === 0) throw new Error(`Native GraphQL schema '${name}' has no fields.`);
    schemaDefinitions.push(`type ${name} {\n${typeFields.join('\n')}\n}`);

    const plural = `${name.toLowerCase()}s`;
    const singular = name.toLowerCase();
    if (queryNames.has(plural) || queryNames.has(singular)) {
      throw new Error(`Native GraphQL schema '${name}' creates a duplicate query field.`);
    }
    queryNames.add(plural);
    queryNames.add(singular);
    queryFields.push(`  ${plural}: [${name}]`, `  ${singular}(id: ID): ${name}`);
    const store = config.stores?.[name];
    if (!store || typeof store.getAll !== 'function' || typeof store.getById !== 'function') {
      throw new TypeError(`Native GraphQL requires the native ${name} store with getAll() and getById(id).`);
    }
    rootValue[plural] = () => store.getAll();
    rootValue[singular] = ({ id }) => store.getById(id);
  }
  if (types.length === 0) {
    schemaDefinitions.push('type Query { hello: String }');
    rootValue.hello = () => 'Hello from NAIDE GraphQL';
  } else {
    schemaDefinitions.push(`type Query {\n${queryFields.join('\n')}\n}`);
  }
  const schema = api.buildSchema(schemaDefinitions.join('\n\n'));
  const handler = async (request, response) => {
    const body = request.method === 'get' ? request.query : request.body;
    if (!body || typeof body !== 'object' || typeof body.query !== 'string' || body.query.length === 0) {
      return response.status(400).json({ errors: [{ message: 'A GraphQL query string is required.' }] });
    }
    let variables = body.variables;
    if (typeof variables === 'string') {
      try {
        variables = JSON.parse(variables);
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        return response.status(400).json({ errors: [{ message: 'GraphQL variables must be valid JSON.' }] });
      }
    }
    if (variables !== undefined && (!variables || typeof variables !== 'object' || Array.isArray(variables))) {
      return response.status(400).json({ errors: [{ message: 'GraphQL variables must be an object.' }] });
    }
    const result = await api.graphql({
      schema,
      source: body.query,
      rootValue,
      variableValues: variables,
      operationName: body.operationName,
    });
    return response.json(result);
  };
  return handler;
}

async function createWebrtcAdapter(config, loadPackage, isElectron) {
  const module = await loadPackage('werift', 'webrtc');
  const api = module.default && typeof module.default === 'object'
    ? { ...module.default, ...module }
    : module;
  const RTCPeerConnection = api.RTCPeerConnection;
  if (typeof RTCPeerConnection !== 'function') {
    throw new TypeError("The installed 'werift' package does not export RTCPeerConnection.");
  }
  const iceServers = [{ urls: config.stun }];
  if (config.turn) {
    const turnServer = { urls: config.turn };
    if (config.turnUsername) turnServer.username = config.turnUsername;
    if (config.turnPassword) turnServer.credential = config.turnPassword;
    iceServers.push(turnServer);
  }
  const peer = new RTCPeerConnection({ iceServers });
  const reportEvent = (name, payload, connection = null) => {
    const handler = config.events[name];
    if (!handler) return;
    Promise.resolve(handler(payload, connection)).catch(error => {
      console.error(`Native WebRTC '${name}' event handler failed:`, error);
      void peer.close();
    });
  };
  const channels = new Set();
  const wrapChannel = channel => {
    channels.add(channel);
    const connection = Object.freeze({
      label: channel.label,
      send: value => {
        if (channel.readyState !== 'open') throw new Error('Cannot send on a closed WebRTC data channel.');
        channel.send(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value));
      },
      close: () => channel.close(),
      get readyState() { return channel.readyState; },
    });
    channel.onmessage = event => reportEvent('message', { data: event.data, label: channel.label }, connection);
    channel.onopen = () => reportEvent('open', { label: channel.label }, connection);
    channel.onclose = () => {
      channels.delete(channel);
      reportEvent('close', { label: channel.label }, connection);
    };
    return connection;
  };
  peer.onicecandidate = event => reportEvent('icecandidate', { candidate: event.candidate });
  peer.onconnectionstatechange = () => reportEvent('connectionstatechange', { state: peer.connectionState });
  peer.ondatachannel = event => wrapChannel(event.channel);

  const validateDescription = (description, expectedType) => {
    if (!description || typeof description !== 'object' || typeof description.sdp !== 'string'
      || !['offer', 'answer'].includes(description.type)
      || (expectedType && description.type !== expectedType)) {
      throw new TypeError(`WebRTC requires a valid ${expectedType || 'offer or answer'} session description.`);
    }
    return { type: description.type, sdp: description.sdp };
  };

  return Object.freeze({
    createDataChannel: label => {
      if (typeof label !== 'string' || label.length === 0) throw new TypeError('WebRTC data channel label must be a non-empty string.');
      return wrapChannel(peer.createDataChannel(label));
    },
    createOffer: async () => {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const description = peer.localDescription ?? offer;
      reportEvent('offer', description);
      return description;
    },
    acceptOffer: async offer => {
      await peer.setRemoteDescription(validateDescription(offer, 'offer'));
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      const description = peer.localDescription ?? answer;
      reportEvent('answer', description);
      return description;
    },
    acceptAnswer: async answer => {
      await peer.setRemoteDescription(validateDescription(answer, 'answer'));
      return Object.freeze({ state: peer.connectionState });
    },
    addIceCandidate: async candidate => {
      if (!candidate || typeof candidate !== 'object' || typeof candidate.candidate !== 'string') {
        throw new TypeError('WebRTC ICE candidates must contain a candidate string.');
      }
      await peer.addIceCandidate(candidate);
    },
    close: async () => {
      for (const channel of channels) channel.close();
      channels.clear();
      await peer.close();
    },
    get connectionState() { return peer.connectionState; },
  });
}

async function createDesktopAdapter(config, loadPackage, isElectron, platform) {
  if (!isElectron) {
    throw new Error("The native desktop adapter requires Electron's main process. Start the project with 'naide desktop <file.naide>'.");
  }
  const module = await loadPackage('electron', 'desktop');
  const api = module.default && typeof module.default === 'object'
    ? { ...module.default, ...module }
    : module;
  if (!api.app || typeof api.app.whenReady !== 'function' || typeof api.BrowserWindow !== 'function') {
    throw new TypeError("The installed 'electron' package is not running in an Electron main process.");
  }
  await api.app.whenReady();
  const window = new api.BrowserWindow({
    title: config.title,
    width: config.width,
    height: config.height,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.once('ready-to-show', () => window.show());
  await window.loadFile(config.load);
  api.app.once('window-all-closed', () => {
    if (platform !== 'darwin') api.app.quit();
  });
  return Object.freeze({
    close: () => {
      if (!window.isDestroyed()) window.close();
    },
    isDestroyed: () => window.isDestroyed(),
  });
}

export function createNativeServices(projectDirectory, options = {}) {
  if (typeof projectDirectory !== 'string' || projectDirectory.length === 0) {
    throw new TypeError('Native adapter setup requires a project directory.');
  }
  const directory = resolve(projectDirectory);
  const requireFromProject = projectRequire(directory);
  const fetcher = options.fetch ?? globalThis.fetch;
  if (typeof fetcher !== 'function') throw new TypeError('Native service adapters require a Fetch-compatible HTTP implementation.');
  const loadPackage = options.loadPackage ?? ((name, adapter) => loadProjectDependency(name, adapter, requireFromProject));
  const isElectron = options.isElectron ?? Boolean(process.versions.electron);
  const platform = options.platform ?? process.platform;

  return Object.freeze({
    oauth: config => createOAuthAdapter(config, fetcher),
    payments: config => createStripeAdapter(config, fetcher),
    image: config => createImageAdapter({ ...config, projectDirectory: directory }, loadPackage),
    pdf: config => createPdfAdapter(config, loadPackage),
    graphql: config => createGraphqlAdapter(config, loadPackage),
    websocket: config => createWebSocketAdapter(config, loadPackage),
    webrtc: config => createWebrtcAdapter(config, loadPackage),
    desktop: config => createDesktopAdapter(config, loadPackage, isElectron, platform),
  });
}
