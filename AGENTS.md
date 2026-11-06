# API Studio — AI Agent Development Instructions

This document defines mandatory development rules for AI coding agents working
on API Studio.

All agents must follow these instructions when creating, modifying, reviewing,
or refactoring code.

## 1. Project Overview

API Studio is a browser-based API testing application inspired by Postman.

The application must initially operate entirely in the browser.

There must be no mandatory backend server.

All application data must be persisted locally using IndexedDB.

## 2. Primary Technology Stack

Use:

- Angular.
- TypeScript.
- Angular Material.
- SCSS.
- Angular Signals.
- RxJS.
- Monaco Editor.
- Dexie.js.
- Fetch API.
- XMLHttpRequest where appropriate (upload progress only, implemented as a
  second executor behind the same `RequestExecutionService` interface).

Do not introduce additional frameworks or libraries without a clear technical
justification.

## 3. Architecture Rules

Use modular, feature-oriented architecture.

Organize functionality into:

- Core.
- Shared.
- Features.

Core contains application-wide services, models, database infrastructure, and
utilities.

Shared contains reusable UI components, pipes, and directives.

Features contain independent application functionality.

Avoid putting business logic inside Angular components.

Components should primarily handle:

- User interaction.
- Input/output communication.
- UI state.
- Presentation.

Business logic belongs in services.

Dependency direction:

- Features may import from Core and Shared.
- Features must not import from other Features. Share code via Core or Shared.
- Exception: `features/workspace` is the composition root and may import the
  other features to assemble the application shell.
- Shared may import from Core, never from Features.
- Core must not import from Features or Shared.
- Enforce these rules with lint restrictions once the project is scaffolded.

File conventions: `*.component.ts`, `*.service.ts`, `*.model.ts`, `*.pipe.ts`,
`*.directive.ts`; one primary model or service per file; shared state lives in
signal-based services, not in components.

## 4. Frontend-Only Requirement

The application must not depend on:

- NestJS.
- Express.
- External API proxy servers.
- Remote databases.
- Backend authentication services.
- Server-side request execution.

HTTP requests must be executed directly by the browser.

Use Fetch API for standard requests.

Use XMLHttpRequest when upload progress reporting is required.

All limitations imposed by browser security must be respected.

Never attempt to bypass browser CORS, mixed-content, or TLS security
restrictions.

## 5. TypeScript Rules

- Enable strict TypeScript checking.
- Avoid `any`.
- Define interfaces for application data.
- Use explicit return types for important service methods.
- Avoid unnecessary type assertions.
- Prefer immutable data transformations.
- Use enums or string literal unions for known application states.
- Keep models independent of Angular components.

## 6. Angular Rules

- Prefer standalone components.
- Use Angular Signals for local and shared reactive state where appropriate.
- Use RxJS for asynchronous streams and event processing.
- Use dependency injection.
- Prefer OnPush change detection where appropriate.
- Avoid excessive component nesting.
- Use lazy loading for larger features.
- Keep components small and focused.

## 7. HTTP Execution Rules

All HTTP execution must go through a dedicated abstraction.

Create a `RequestExecutionService` interface.

The initial implementation must be `BrowserFetchExecutor`.

Responsibilities:

- Normalize request configuration.
- Resolve environment variables.
- Prepare headers.
- Prepare request bodies.
- Execute requests.
- Handle errors.
- Measure execution duration.
- Parse response information.
- Support request cancellation.

Do not implement HTTP execution directly inside UI components.

Do not silently ignore browser security errors.

Distinguish between:

- HTTP response errors.
- Network errors.
- CORS failures.
- Timeout errors.
- Aborted requests.
- Unsupported browser functionality.

Remember that Fetch does not reject promises for HTTP error statuses such as 400
or 500.

Browser limitations the executor must handle honestly:

- Fetch reports CORS failures, DNS failures, refused connections, and mixed
  content blocks all as an opaque `TypeError`. A CORS failure cannot be
  detected with certainty. Report it as "network error, possibly CORS" with an
  explanation, never as a confirmed diagnosis.
- Forbidden request headers (for example `Host`, `Cookie`, `Origin`,
  `Content-Length`, `User-Agent`) cannot be set. Surface this in the UI instead
  of silently dropping the header.
- `Set-Cookie` is not readable from JavaScript.
- A default timeout must exist (initially 30 seconds) and be configurable per
  request. Implement it with `AbortController`, and distinguish timeout from
  user cancellation.
- Redirect behavior (`follow`, `manual`, `error`) and `credentials` mode must be
  explicit request options, not implicit defaults.
- File uploads (multipart and binary bodies) go through `BrowserXhrTransport`
  when upload progress is requested, because Fetch cannot observe uploads. XHR
  always follows redirects, sends cookies to same-origin URLs, and buffers the
  response before the size limit applies. The executor reports ignored options
  as warnings instead of hiding the difference.
- Selected files exist only in memory (`RequestSession.files`). Persisted
  requests keep the file name, size and type, and ask the user to choose the
  file again.

## 8. Request Body Rules

Support:

- None.
- JSON.
- XML.
- Text.
- JavaScript.
- Form URL Encoded.
- Multipart Form Data.
- Binary.

For multipart/form-data:

- Use native FormData.
- Never manually construct multipart boundaries.
- Do not manually set Content-Type when using FormData.
- Support multiple files.
- Support multiple values for the same field.
- Preserve field ordering where practical.

GET and HEAD requests must not contain request bodies.

## 9. Response Handling Rules

The response viewer must support:

- JSON.
- XML.
- HTML.
- Plain text.
- Images.
- Binary downloads.

Avoid assuming that all responses are JSON.

Do not load arbitrarily large responses fully into memory without limits or
user awareness.

Response headers exposed by browsers may be incomplete due to CORS restrictions.

Display unavailable information honestly.

Size limits (initial values, configurable in settings):

- Bodies up to 10 MB are rendered in the editor.
- Larger bodies must not be rendered. Offer download instead, and tell the user
  the body was not displayed.
- Read bodies as `Blob` or streamed chunks, not as strings, until the content
  type and size are known.

HTML previews must render in a sandboxed `<iframe>` with the `sandbox`
attribute and without `allow-scripts` or `allow-same-origin`.

## 10. IndexedDB Rules

- Use Dexie.js.
- Create a dedicated database service.
- All persistent application data must have typed models.
- Implement database schema versioning.
- Support migrations when database structures change.
- Do not store temporary UI state unnecessarily.
- Do not assume IndexedDB is an encrypted secret vault.
- Provide import/export functionality to protect users against accidental local
  data loss.

## 11. Security Rules

- Treat imported data as untrusted.
- Never execute imported scripts automatically.
- Never use `eval()` or `Function()` to execute arbitrary request scripts.
- Do not render API response HTML directly as trusted application HTML.
- Sanitize untrusted content where necessary.
- Do not expose secrets in console logs.
- Avoid storing sensitive authentication tokens in plaintext exports without an
  explicit user action and warning.
- Prevent stored XSS.
- Validate URLs and imported collection structures.
- Validate imports against a schema, enforce a maximum import size, and reject
  keys such as `__proto__`, `constructor`, and `prototype` to prevent prototype
  pollution.
- OAuth 2.0 must use Authorization Code with PKCE only. Do not implement the
  implicit flow and never store or request client secrets.
- Plan the Content Security Policy before adding Monaco. Monaco requires web
  workers; verify the setup works without `unsafe-eval` and document any CSP
  relaxation as a security decision.
- History entries must redact `Authorization` headers and values of variables
  marked secret.
- Show a first-run notice that data is stored unencrypted in the browser.

## 12. UI/UX Rules

The interface should resemble a professional desktop API client.

Use:

- Left navigation sidebar.
- Main request editor.
- Response panel.
- Multiple request tabs.
- Resizable panels.
- Light and dark themes.

Additional expectations:

- Use consistent spacing, typography, and component behavior.
- Avoid unnecessary animations.
- Prioritize keyboard accessibility.
- All long-running actions must provide feedback.

## 13. Testing Requirements

Write unit tests for:

- Request normalization.
- URL construction.
- Query parameter handling.
- Header preparation.
- Environment variable substitution.
- Request body generation.
- Response parsing.
- Multipart request construction.
- IndexedDB persistence and schema migrations.
- Import and export.
- Request cancellation and timeouts.

Write integration tests for major workflows.

Do not consider functionality complete until relevant tests pass.

## 14. Code Quality

Before completing a development task:

- Run TypeScript checks.
- Run the Angular build.
- Run relevant unit tests.
- Check for console errors.
- Review accessibility.
- Verify browser compatibility.

Additional expectations:

- Avoid unnecessary dependencies.
- Do not rewrite unrelated code.
- Preserve existing functionality when refactoring.

## 15. Development Workflow

Before implementing a feature:

1. Inspect the existing project structure.
2. Read [PRD.md](PRD.md).
3. Read this document.
4. Read [SKILLS.md](SKILLS.md).
5. Identify affected modules.
6. Define implementation steps.
7. Implement incrementally.
8. Test the result.
9. Update documentation when necessary.

Additional expectations:

- Do not create unnecessary placeholder files.
- Do not claim a feature is implemented unless it actually works.

## 16. Future Compatibility

Keep the request model and response model independent of the browser execution
implementation.

This will allow a future optional backend executor without requiring a complete
frontend rewrite.

The initial application must remain fully functional without that backend.

## 17. Commands and Tooling

Versions in use (scaffolded 2026-11-05):

- Node.js 26 (Angular 22 supports `^22.22.3 || ^24.15.0 || >=26`).
- Angular 22.2, Angular Material and CDK 22.2, TypeScript 6.0, RxJS 7.8.
- Dexie 4, Monaco Editor 0.57.
- Unit tests: Vitest via `ng test` (jsdom), with `fake-indexeddb` for Dexie.
  `src/test-setup.ts` (angular.json `setupFiles`) installs `fake-indexeddb` before
  any spec loads; Dexie reads the `indexedDB` global at import time, so do not
  rely on importing it inside individual specs.
- Lint: ESLint 10 with angular-eslint. Module boundary rules are configured in
  `eslint.config.js`; use the `@core/*`, `@shared/*`, `@features/*` aliases for
  cross-area imports.

npm scripts:

- `npm start`: development server.
- `npm run build`: production build.
- `npm test`: unit tests (use `npm test -- --watch=false` for a single run).
- `npm run lint`: lint, including module boundary rules.
- `npm run e2e`: not defined yet. Choose an end-to-end tool (Playwright is the
  candidate) before the first integration test is written.

Document the end-to-end tool choice here when made.

Monaco Editor is not bundled. Its prebuilt files are copied to `/monaco/vs` by
`angular.json` and loaded on first use by
`shared/components/code-editor/monaco-loader.ts`. This keeps it out of the
initial bundle and avoids bundler issues with its CSS and workers. Monaco starts
its web workers from `blob:` URLs, so any Content Security Policy must allow
`worker-src blob:` and `script-src 'self'`. Re-check this when a CSP is added.

`tsc` and `npm test` do not compile Angular templates. Always run
`npm run build` too, because template errors only appear there.
Run build, lint, and tests before reporting a task complete. If a command does
not exist yet, say so instead of claiming it passed.

UI changes must be verified in a running browser, including checking the console
for errors.

## 18. Core Data Models

Persisted models must have a stable string `id` (UUID), a `schemaVersion`, and
`createdAt` / `updatedAt` timestamps. Define at least:

- `ApiRequest`: method, URL, query params, headers, auth, body, options
  (timeout, redirect mode, credentials).
- `ApiResponse`: status, status text, headers, body reference, size, duration,
  and an explicit marker for unavailable information.
- `Collection` and `Folder`: hierarchy via `parentId`, with ordering.
- `Environment`: named variables, each with an optional `secret` flag.
- `HistoryEntry`: request snapshot (redacted), outcome, timestamp.
- `AppSettings`: theme, limits, timeouts.

Models must not reference Angular types and must be independent of the executor.

Variable resolution rules:

- Syntax is `{{name}}`.
- Precedence is request-level, then active environment.
- An undefined variable is reported as a warning in the UI and is left
  unresolved in the request. It is never replaced silently with an empty string.
- Resolution covers URL, params, headers, auth, and text bodies.

File storage: do not persist file contents for multipart or binary bodies by
default. Store file name, size, and type, and ask the user to re-select the file
before sending. Any option to persist file contents must enforce a size cap.

History retention: keep the most recent 100 entries by default, configurable,
and purge the oldest first.
