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

## Current checkpoint

This is an evidence-based checkpoint, not a claim of overall product completeness. It records the state after adding TypeScript compile/runtime checks, packed-package installation coverage, API persistence verification across a server restart, and Windows test-suite coverage for all four supported Node versions.

| Area | Earned | Point breakdown |
| --- | ---: | --- |
| Compiler and runtime validation | 24 / 25 | 5/5 all-target generation; 8/8 representative runtime targets (8 points); 4/4 Rust compile/runtime; 3/3 Java compile/runtime; 4/5 compile or execution checks for remaining targets (TypeScript, PHP, Ruby, and Kotlin compile and execute). |
| End-to-end application workflows | 25 / 25 | 8/8 browser build/serve; 5/5 starter scaffold/type-check; 12/12 API flow over HTTP, including registration, login, protected CRUD, validation, rate limits, user isolation, file-store writes, and persistence across restart. |
| Security and safe defaults | 20 / 20 | 6/6 secure scaffold defaults; 4/4 source-level API checks; 5/5 HTTP auth/validation/rate-limit behavior; 5/5 independent review completed, with its single HIGH finding fixed and covered by traversal/symlink regression tests. |
| CI and installation reliability | 14 / 15 | 3/3 Node matrix coverage locally exercised on Windows and Linux (18, 20, 22, and 24); 4/4 Linux target checks exercised; 4/4 npm package contents and packed installation verified on both platforms; 3/4 full-suite platform evidence. The remaining point requires a green hosted CI run for this exact revision. |
| Developer experience and support clarity | 15 / 15 | MCP/LSP/project tooling tests, onboarding tests, and explicit documentation of support limits pass locally. |
| **Total** | **98 / 100** | **Local evidence reaches 98. The remaining points require all 15 runtime targets and the full CI workflow to pass on the hosted runner for this exact revision.** |

## Current evidence

| Check | Status | Evidence or remaining work |
| --- | --- | --- |
| 15 compiler targets produce source containing a sentinel | Pass | `npm run test:targets` |
| Node, Python, Bun, Go, C, and C++ execute a function/conditional smoke program | Pass locally | `npm run test:runtimes` |
| TypeScript output compiles under strict checks and executes | Pass locally | `npm run test:runtimes` |
| Rust generated function/conditional program compiles and executes | Pass locally on Linux | `npm run test:runtimes` in Linux; Windows metadata check passes, but local Windows executable linking needs an MSVC linker |
| Java generated program compiles and executes | Pass locally on Linux | `npm run test:runtimes` with OpenJDK 17; hosted CI is configured for Temurin 21 |
| PHP, Ruby, and Kotlin generated programs compile and execute | Pass locally on Linux | `npm run test:runtimes`; Kotlin top-level executable statements now emit inside `main`, and declared return types are preserved |
| Swift, Dart, and C# generated programs compile and execute | Pending local toolchains | A dedicated hosted `runtime-targets` job installs all three toolchains and sets `NAIDE_REQUIRE_RUNTIME_TOOLS=true` so missing tools cannot silently skip |
| npm package includes its required source, CLI, and linked release-readiness guide | Pass | `test/package-release.js` runs `npm pack --dry-run --json` and checks required/forbidden paths |
| Browser app build, serve, and safe output-path behavior | Pass | `test/native-meld.js` |
| Generated API starter exercised through real HTTP/auth/persistence flows | Pass | `test/onboarding-integration.js` starts the generated app and checks real HTTP responses |
| Secure scaffold defaults and source-level API protections | Pass | `test/onboarding.js` and `test/security.js` |
| Generated API registration, login, validation, auth, CRUD, rate-limit, and user-isolation behavior | Pass | `test/onboarding-integration.js` starts the generated starter and checks real HTTP responses |
| File-backed data is written by real API requests | Pass | The HTTP test checks the generated User and Item store files |
| File-backed updates survive a server restart | Pass | The HTTP test restarts the generated server and verifies the updated record is loaded |
| Independent security review and remediation | Pass | Review found one HIGH browser-bundle path escape; `bin/naide.js` now checks project containment and canonical paths, and `test/native-meld.js` verifies traversal and symlink escapes cannot modify external files |
| MCP, LSP, project tools, and onboarding checks | Pass | `npm run test:features` |
| Full suite on Node 24 | Pass locally on the latest revision | 580 pass, 0 fail, 8 skips |
| Full suite on Node 18, 20, 22, and 24 | Pass locally on Windows and Linux before the latest runtime-target changes | Windows: 580 pass, 0 fail, 2 platform-specific skips per version; Linux: 581 pass, 0 fail, 1 Windows-only skip per version, with Java, Rust, Go, Bun, Python, C, and C++ runtime checks enabled |
| Full supported Node-version CI matrix | Pending hosted confirmation | The latest observed GitHub run predates this worktree and did not complete green; Node 20 was cancelled and Node 18 failed during toolchain setup |
| Clean install from the packed artifact | Pass locally | `test/package-release.js` installs the tarball into a clean consumer directory and invokes its CLI on Windows and Linux |
| All 15 targets compile and execute representative programs | Pending hosted runtime job | Local Linux currently passes 12 executable targets; Swift, Dart, and C# are configured as mandatory checks in the new job |
| Windows/Linux full-suite release checks | Pass locally on the prior checkpoint / hosted confirmation pending | The latest revision's Node 24 full suite passes locally; the current uncommitted revision still needs the hosted matrix and runtime job green |

The weighted local evidence score is 98/100 and the reviewed HIGH finding has been fixed. Do not claim 100/100 or release certification until all 15 runtime targets and the full hosted CI matrix are green for this exact revision.
