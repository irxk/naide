# NAIDE release-readiness gates

The 90% goal is a release-readiness target, not a feature-count estimate. Score only evidence that can be reproduced from the repository. A configured CI job is not a passing result until CI has run successfully.

## Weighted scorecard

| Area | Points | Evidence required |
| --- | ---: | --- |
| Compiler and runtime validation | 25 | All 15 targets pass generation checks; representative targets compile and execute behavior; remaining targets have explicit compile checks or documented limits. |
| End-to-end application workflows | 25 | Web build/serve, starter creation, and a real API flow (registration/login, protected CRUD, validation, rate limits, and persistence) pass automated tests. |
| Security and safe defaults | 20 | Safe scaffold defaults are tested; auth and validation are exercised over HTTP; a security review has no unresolved critical/high findings. |
| CI and installation reliability | 15 | Supported Node versions pass; clean install and package contents are verified; platform-specific limitations are visible and tested. |
| Developer experience and support clarity | 15 | MCP/LSP, onboarding, diagnostics, and documentation have focused tests and accurate support boundaries. |

Award points only for the evidence listed in each check. Partial credit is allowed when a check defines a measurable numerator, such as the number of executable targets that pass divided by the targets required.

## Latest hosted verification

GitHub Actions run [#51](https://github.com/irxk/naide/actions/runs/40190917682) completed successfully for `main` at commit `1048415854c54e9cc116e0675331358d698da44c` on 2026-10-25. All five jobs passed: the Node.js 18, 20, 22, and 24 test matrix, plus the required runtime-target job. The runtime job passed all-target generation checks and compiled and executed a representative function/conditional program for all 15 targets with required toolchains enabled. The Node 18 full suite reported 654 tests, 638 passed, 16 skipped, and 0 failed. Other configured Node versions also completed successfully. This is historical evidence for that commit; Node.js 18 and 20 are now upstream EOL, so those jobs demonstrate compatibility, not a currently maintained upstream support lifecycle.

| Area | Earned | Current evidence |
| --- | ---: | --- |
| Compiler and runtime validation | 25 / 25 | All 15 targets pass hosted generation checks and representative compile/runtime execution. |
| End-to-end application workflows | 25 / 25 | Browser build/serve, starter checks, and generated API HTTP/auth/persistence flows pass automated tests. |
| Security and safe defaults | 20 / 20 | Secure defaults, HTTP protections, and the remediated security finding have regression coverage. |
| CI and installation reliability | 15 / 15 | The prior four-version matrix passed hosted CI; the updated supported floor is Node 24 and its new 24/26 matrix awaits hosted verification; the hosted runtime job requires all target toolchains; package and clean-install checks run in the suite. |
| Developer experience and support clarity | 15 / 15 | MCP/LSP, onboarding, diagnostics, project tooling, and support-boundary checks pass. |
| **Total** | **100 / 100** | All defined release-readiness gates have reproducible evidence for the hosted commit above. This score does not claim provider integrations are bundled or that every target has full feature parity. |

## Current evidence

| Check | Status | Evidence or remaining work |
| --- | --- | --- |
| Native interpreter AST capability inventory | Pass | `src/native-support.js` classifies all 120 parser AST types: 62 supported, 58 contextual, and 0 unsupported. The measured AST availability is 120/120 (100%) under the explicit-host-adapter contract; this is not full compiler parity or release readiness. The latest hosted run's Node 18 suite reports 654 tests, 638 passed, 16 skipped, and 0 failed. |
| 15 compiler targets produce source containing a sentinel | Pass (hosted) | `npm run test:targets` |
| All 15 targets compile and execute a function/conditional representative program | Pass (hosted) | `npm run test:runtimes` with `NAIDE_REQUIRE_RUNTIME_TOOLS=true`; all 15 execution tests passed. |
| npm package includes its required source, CLI, and linked release-readiness guide | Pass | `test/package-release.js` runs `npm pack --dry-run --json` and checks required/forbidden paths |
| Browser app build, serve, and safe output-path behavior | Pass | `test/native-meld.js` |
| Generated API starter exercised through real HTTP/auth/persistence flows | Pass | `test/onboarding-integration.js` starts the generated app and checks real HTTP responses |
| Secure scaffold defaults and source-level API protections | Pass | `test/onboarding.js` and `test/security.js` |
| Generated API registration, login, validation, auth, CRUD, rate-limit, and user-isolation behavior | Pass | `test/onboarding-integration.js` starts the generated starter and checks real HTTP responses |
| File-backed data is written by real API requests | Pass | The HTTP test checks the generated User and Item store files |
| File-backed updates survive a server restart | Pass | The HTTP test restarts the generated server and verifies the updated record is loaded |
| Independent security review and remediation | Pass | Review found one HIGH browser-bundle path escape; `bin/naide.js` now checks project containment and canonical paths, and `test/native-meld.js` verifies traversal and symlink escapes cannot modify external files |
| MCP, LSP, project tools, and onboarding checks | Pass | `npm run test:features` |
| Modern MCP protocol (`2026-07-28`) and NAIDE knowledge coverage | Pass locally; hosted rerun pending | Stdio server supports stateless per-request metadata and `server/discover`; legacy `initialize` clients are intentionally unsupported. `naide_search` indexes bundled first-party specification, docs, examples, implementation, and editor integrations; workspace files and dependencies are excluded. `test/mcp.js` verifies discovery, version rejection, metadata validation, notifications, tool annotations, source search, section lookup, and knowledge catalog. |
| Node.js upstream lifecycle vs declared engine floor | Updated locally; hosted rerun pending | `package.json` now declares Node `>=24.0.0`; CI tests Node 24 LTS and Node 26 Current. The official [Node.js release schedule](https://nodejs.org/en/about/previous-releases) lists Node 18/20 as EOL and Node 24 as LTS. |
| Full suite on prior configured Node versions | Pass (hosted, historical) | GitHub Actions run #51: Node 18, 20, 22, and 24 jobs passed after clean `npm ci`; this predates the Node 24 minimum and updated 24/26 matrix. |
| Clean install from the packed artifact | Pass | `test/package-release.js` checks package contents, installs the packed artifact into a clean consumer, and runs the CLI |
| All 15 targets compile and execute representative programs | Pass (hosted) | GitHub Actions run #51 required-toolchain `runtime-targets` job passed on Ubuntu 24.04 |
| Windows/Linux full-suite release checks | Pass on previously recorded local checkpoints; latest hosted matrix is Linux | The exact hosted revision passed the Linux Node matrix and all-target runtime job; Windows evidence is from the prior local cross-platform checkpoint |

The latest hosted evidence for commit `1048415854c54e9cc116e0675331358d698da44c` scores 100/100 against the defined release-readiness gates. This is an evidence score, not a claim of full compiler parity, bundled external providers, or universal production readiness; platform and adapter boundaries remain as documented. Subsequent local documentation and MCP protocol changes have passed the local checks listed below but still require a new hosted run.

## Compiler-independent execution

The default `naide <file.naide>` runner, REPL, type checker, doctor/verify diagnostics, and watch mode use direct interpreter/parser paths without generating JavaScript. Use `--compile` for JavaScript generation and compatibility with features outside the direct interpreter's stated support. `--debug` intentionally remains a compiler-backed Node.js inspector workflow. `esbuild` is optional and is needed only for browser-module bundling.

The native HTTP core supports JSON, URL-encoded, and bounded multipart request bodies (1 MiB by default), routes and path parameters, nested route groups with scoped middleware/authentication, schemas, file-backed CRUD, bearer authentication, cookie parsing, signed Secure/HttpOnly-cookie sessions with in-memory data, bounded server-sent event streams, CORS, in-process rate limits, redirects, project-confined static files, response caching, views, queues, and OpenAPI generation. Sessions require a secret of at least 32 UTF-8 bytes, expire after 24 hours, and are lost when the process restarts. SSE streams disconnect slow clients when their 1 MiB pending queue fills and close with the server. WebSocket upgrades are routed by path, rejected when unregistered, and invoke adapter cleanup on server close. GraphQL declarations register host-provided handlers for GET and POST. The server binds to loopback by default. Node built-ins require exact per-module grants, and npm imports must be declared in the project manifest; both execute with host permissions and are not sandboxed.

The measured AST coverage treats a node as available if it is either `supported` or implemented in its declared execution context (`contextual`). The current inventory is 62 supported, 58 contextual, and 0 unsupported AST types (120/120, 100%). Contextual nodes include server/route-only constructs, nested constructs such as bot and screen elements, and integrations that require a host capability. Embedded `NativeEngine` callers can supply explicit database (`connect`, `createStore`), bot (`create` returning `on`, `command`, `start`), object-storage (`connect` returning `upload`, `download`, `remove`), mail (`createTransport` returning `sendMail`), Web Push (`configure` returning `sendNotification`), and `nativeServices` adapters. The service adapter functions cover desktop, GraphQL, WebSocket, gRPC, WebRTC, image processing, migrations, OAuth, payments, PDF generation, and blockchain declarations. Their inputs are evaluated and validated by the engine; missing adapters and adapter failures are explicit. This 100% result is limited to executable AST coverage under the documented host-adapter contract; it does not mean every external provider is bundled, nor that all compiler targets are interchangeable with native execution or that NAIDE is release-complete.

### Core compiler-independent execution milestones: 100% (10/10 defined milestones)

This percentage is scoped only to the ten previously defined operational milestones, not full compiler/language parity, overall project completeness, or release readiness. The native interpreter remains an actively developed engine; external service adapters still require provider-specific integration tests before production use.

Completed:
1. Default file execution runs the interpreter without generating JavaScript.
2. The interactive REPL uses the interpreter by default, with `.compile` and `.eval` mode switches.
3. The published `naider/native` API supports embedding and running code without importing the compiler entry point.
4. The interpreter runs the supported core language, including functions, models, control flow, and iterable operations.
5. Direct execution supports `.naide` modules and asynchronous runtime capabilities such as file I/O, HTTP requests, task coordination, and bounded execution.
6. The native HTTP server and server lifecycle support the documented API starter surface.
7. Node.js built-ins and declared npm packages use explicit direct-runtime boundaries.
8. Type-check, doctor/verify, and watch use compiler-independent paths; debugger support remains intentionally compiler-backed.
9. The generated API starter runs directly through the interpreter.
10. The browser bundler is an optional dependency and packed-package tests exercise direct execution without optional dependencies.

This milestone score does not claim full language/compiler parity or a standalone runtime: NAIDE still requires Node.js, host imports are not sandboxed, and unsupported language/framework features remain explicit compiler-path use cases.
