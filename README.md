# API Studio

A browser-based API development, testing, and debugging tool inspired by
Postman.

API Studio allows developers to create, execute, organize, save, and inspect
HTTP requests directly from their browser without requiring a backend server.

The application is designed as a frontend-only solution using Angular and
modern browser APIs.

## 1. Project Goals

The primary goal is to provide a lightweight, modern, and user-friendly
alternative to Postman for everyday API development and testing.

Core capabilities:

- Execute HTTP requests.
- Support REST APIs.
- Support different HTTP methods.
- Configure request headers and query parameters.
- Create JSON, XML, and text request bodies.
- Submit form-urlencoded requests.
- Submit multipart/form-data requests.
- Upload files.
- Inspect HTTP responses.
- Save and organize requests.
- Create collections and folders.
- Manage environments and variables.
- Maintain request execution history.
- Import and export collections.

The application must work without a dedicated backend.

All user data is stored locally in the browser.

> **Status:** Early development. The Angular project is scaffolded (Step 0);
> the application features are not implemented yet. See the Development Steps
> checklist for progress.

## 2. Technology Stack

### Frontend

- Angular
- TypeScript
- Angular Material
- SCSS
- Angular Signals
- RxJS

### Editors

- Monaco Editor

Used for:

- JSON editing.
- XML editing.
- Plain text editing.
- JavaScript editing.
- Syntax highlighting.
- Formatting.

### HTTP Execution

- Native Fetch API.
- XMLHttpRequest where upload progress reporting is needed.
- FormData for multipart requests.
- AbortController for request cancellation.

### Local Storage

- IndexedDB.
- Dexie.js as the IndexedDB wrapper.

### Development

- Angular CLI.
- Node.js.
- npm.
- Git.

## 3. Architecture

The application follows a modular Angular architecture.

```text
api-studio/
|
+-- src/
|   |
|   +-- app/
|       |
|       +-- core/
|       |   +-- models/
|       |   +-- services/
|       |   +-- database/
|       |
|       +-- features/
|       |   +-- workspace/
|       |   +-- collections/
|       |   +-- request-editor/
|       |   +-- response-viewer/
|       |   +-- environments/
|       |   +-- history/
|       |   +-- settings/
|       |
|       +-- shared/
|           +-- components/
|           +-- directives/
|           +-- pipes/
|
+-- public/
|
+-- package.json
|
+-- angular.json
|
+-- README.md
+-- AGENTS.md
+-- PRD.md
+-- SKILLS.md
```

## 4. Main Application Components

### Workspace

Main application interface.

Responsibilities:

- Application navigation.
- Request tabs.
- Collections sidebar.
- Environment selector.
- Workspace layout.

### Request Editor

Responsible for configuring HTTP requests.

Supported configuration:

- HTTP method.
- URL.
- Query parameters.
- Headers.
- Authorization.
- Request body.
- File uploads.

### Response Viewer

Displays HTTP responses.

Supported information:

- Status code.
- Status text.
- Response duration.
- Response size.
- Response headers.
- Cookies where accessible.
- Response body.

### Collections

Organizes saved API requests.

Features:

- Create collections.
- Create folders.
- Rename collections.
- Delete collections.
- Save requests.
- Duplicate requests.
- Move requests between folders.

### Environments

Supports multiple environments.

Example:

```json
{
  "name": "Development",
  "variables": {
    "baseUrl": "http://localhost:8080",
    "apiToken": "development-token"
  }
}
```

Requests can reference variables:

```text
{{baseUrl}}/api/users
```

### Local Database

All persistent application data is stored in IndexedDB.

No remote database is required.

## 5. HTTP Support

Supported methods and request body types are defined in
[PRD.md](PRD.md) (FR-001 and FR-005).

### Known Limitations

Browser-based execution imposes limits that the application cannot bypass and
must communicate clearly:

- CORS restrictions apply. A CORS failure appears to JavaScript as a generic
  network error, so the application can only report it as "possibly CORS".
- Some HTTP headers (for example `Host`, `Cookie`, `Origin`) cannot be
  controlled by JavaScript.
- `Set-Cookie` response headers are not readable, and cross-origin responses
  expose only a subset of headers unless the server allows more.
- HTTPS applications cannot freely access insecure HTTP endpoints (mixed
  content).
- Invalid TLS certificates cannot be bypassed.
- Browser execution cannot access arbitrary TCP sockets.
- Data stored in IndexedDB is unencrypted and may be evicted by the browser.
  Export backups regularly.

Supported browsers: the latest two stable versions of Chrome, Edge, Firefox,
and Safari.

## 6. Installation

Requirements:

- Node.js LTS.
- npm.
- Git.

Clone the repository:

```bash
git clone <repository-url>
cd api-studio
```

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm start
```

Alternatively:

```bash
ng serve
```

Open:

```text
http://localhost:4200
```

## 7. Development Principles

- Frontend-only architecture.
- No mandatory backend dependencies.
- Local-first data storage.
- Modular Angular architecture.
- Strong TypeScript typing.
- Reusable components.
- Separation of UI and business logic.
- Responsive application layout.
- Secure handling of sensitive local data.
- Clear separation between request configuration and HTTP execution.

## 8. Development Steps

Progress tracker derived from the milestones in [PRD.md](PRD.md). Check items
off only when the feature works and its tests pass (see the Definition of Done
in [SKILLS.md](SKILLS.md)).

### Step 0: Project Setup

- [x] Scaffold the Angular project (standalone components, strict TypeScript, SCSS).
- [x] Record Angular, Node.js, TypeScript, and Angular Material versions in AGENTS.md.
- [x] Add Angular Material with light and dark themes.
- [x] Install Dexie.js and Monaco Editor.
- [x] Load Monaco lazily (never in the initial bundle).
- [x] Configure the unit test runner (Vitest via `ng test`).
- [ ] Choose and configure the end-to-end tool (Playwright candidate).
- [x] Configure lint, including module boundary rules (core / shared / features).
- [x] Define npm scripts: `start`, `build`, `test`, `lint`.
- [ ] Define the `e2e` npm script (after the e2e tool is chosen).
- [ ] Create the core / shared / features folder structure (created as each
  feature is built, to avoid placeholder files; only `core/models` exists).
- [x] Define the core data models (request, response, collection, environment, history, settings).
- [ ] Plan the Content Security Policy, including Monaco workers.

### Milestone 1: Core HTTP Client

- [x] Application layout (header, sidebar, editor, response panel, resizable panels). The sidebar is empty until collections arrive in Milestone 3.
- [x] `RequestExecutionService` interface and `BrowserFetchExecutor`.
- [x] HTTP method selection and URL editor.
- [x] Query parameters synchronized with the URL.
- [x] Headers editor. Forbidden or invalid headers are reported after sending.
- [x] Basic JSON body with Monaco.
- [x] Environment variable resolution (`{{variableName}}`).
- [x] Send, cancel, and timeout handling with distinct error types (timeout is fixed at the 30 s default; a UI option is still open).
- [x] Response viewer (status, duration, size, headers, body).
- [x] Unit tests for normalization, URL building, headers, variables, and parsing.

### Milestone 2: Advanced Request Support

- [x] XML, text, and JavaScript bodies.
- [x] URL-encoded forms.
- [x] Multipart forms using native `FormData`.
- [x] File uploads (multiple files, repeated field names).
- [x] Binary request bodies.
- [x] Upload progress via an XMLHttpRequest transport (used for file uploads).
- [x] Basic, Bearer Token, API Key, and custom header authorization.
- [x] Unit tests for body generation and multipart construction.

### Milestone 3: Local Persistence

- [x] Dedicated Dexie database service with schema versioning and migrations
  (schema version 3: collections, folders, requests, environments, settings).
  Each upgrade path is tested against a database built the way the older
  release created it.
- [x] Collections and folders (create, rename, delete, nested folders; persisted
  in IndexedDB). Moving and reordering folders is not implemented yet.
- [x] Saved requests (save, save as, duplicate, move, rename, delete). Selected
  files are never stored, only their name, size and type.
- [x] Environments (create, rename, delete, switch). The active environment is
  remembered.
- [x] Application settings and theme persistence (light, dark, system).
- [x] Multiple request tabs with preserved unsaved changes (switching, closing,
  duplicating; a dot marks unsaved tabs; closing asks first). Unsaved tabs live
  in memory only, so reloading the page discards them; the browser warns before
  leaving while any exist.
- [x] Persistent storage request and storage failure handling. Failed loads and
  saves show a banner; the first-run notice says data is stored unencrypted;
  the browser is asked to keep the data when the notice is acknowledged.
- [x] IndexedDB persistence and migration tests.

Keyboard shortcuts: `Ctrl/Cmd+Enter` sends, `Ctrl/Cmd+S` saves the active
request, arrow keys / `Home` / `End` move between request tabs.

### Milestone 4: Advanced Response Handling

- [x] JSON tree and pretty views with syntax highlighting. JSON offers Pretty,
  Tree and Raw; the tree opens the first two levels and shows large arrays
  100 items at a time. Highlighting comes from Monaco. XML and HTML source is
  shown as received (not reformatted).
- [x] Sandboxed HTML preview (`<iframe sandbox="">`: no scripts, no same-origin
  access). A content security policy inside the frame also blocks external
  images, fonts and requests, so previews can look plainer than in a browser.
  HTML opens as source; the preview is only rendered on request.
- [x] Image preview (including SVG, shown through `<img>`, so it cannot run
  scripts) and binary download, named from `Content-Disposition`, the URL or
  the content type.
- [x] Response size limits with user notification. Bodies above the display
  limit (10 MB by default, 1 to 50 MB in Settings) are not rendered; the viewer
  says so and offers a download. Bodies above 50 MB are cut off while receiving
  and flagged.
- [x] Request history with redaction of sensitive values (schema version 4).
  Newest first, 100 entries by default (configurable), oldest purged first;
  open an entry in a new tab, remove one, or clear all. What is redacted:
  - `Authorization` and `Proxy-Authorization` header values, and literal
    credentials in the auth settings. A value that is only `{{variable}}`
    placeholders is kept, since it holds no secret.
  - Values of variables marked secret (in any environment) wherever they
    appear in the URL, params, headers or body; they are replaced by
    `{{name}}`, so reopening still works. Secrets shorter than 4 characters
    are not searched for.
  - Not detectable: a secret typed literally into a body field or an
    arbitrary header. Text bodies over 256 KB are cut short in history.
  - Cancelled and never-sent requests are not recorded.

### Milestone 5: Import and Export

Import and Export are buttons in the header. Imports are added next to the
existing data (nothing is overwritten) after a review step that shows the
format, the counts and every warning. They are written in one transaction, so a
failure leaves the data unchanged.

- [x] Native JSON export and import with schema validation. Every request is
  rebuilt from known fields only; invalid entries, duplicate or missing ids,
  folders in a parent cycle and references across collections are skipped and
  reported; unknown fields are dropped; ids are regenerated. A newer format
  version is refused.
- [x] Warnings before exporting sensitive data. The export dialog counts the
  requests with credentials and the secret variables in the selection. By
  default credentials are emptied and secret values are replaced by their
  `{{name}}` placeholder (also in collections exported without their
  environments). Including them is a separate tick box with a plain-text warning
  and a second confirmation. Environment values not marked secret are exported
  as they are.
- [x] Postman collection import and export (v2.1; v2.0 collections import too).
  Folders, requests, params, headers, raw, urlencoded, form-data and file
  bodies, Basic, Bearer and API key auth (inherited from collection and folder
  levels), and collection variables (imported as an environment). Scripts are
  never imported or run, and unsupported parts (OAuth, digest and others) are
  reported. GraphQL bodies import as GraphQL. File fields keep only the file name. Export covers
  one collection; Postman environments are a separate format and are not
  supported.
- [x] OpenAPI import (3.x and Swagger 2.0, JSON only). One collection, one folder
  per tag, one request per operation, and an environment with `baseUrl` and the
  variables the requests use (credential variables are marked secret). Bodies
  are generated as examples from the schemas. Only local `#/` references are
  followed; nothing is ever fetched. OAuth 2.0 Authorization Code flows import as
  OAuth settings (other flows, which are insecure or need a client secret, do
  not); cookie parameters and TRACE operations are reported as not imported. **YAML is not supported**
  (convert it to JSON first); adding a YAML parser would be a new dependency.

Import safety: files over 10 MB are refused before they are read; nesting over
64 levels and any `__proto__`, `constructor` or `prototype` key anywhere in the
file are rejected; list lengths are capped; imported URLs that browsers cannot
send (for example `ftp:`) are flagged.

### Milestone 6: Advanced Features

- [x] OAuth 2.0 (Authorization Code with PKCE). A new authorization type. S256
  challenge only, as a public client: there is no client secret field and no
  implicit flow. The sign-in runs in a popup (opened with `noopener`) and
  returns over a same-origin channel; `state` is checked. Endpoints must be
  https (http only for localhost). Access and refresh tokens are kept **in
  memory only**: never in IndexedDB, exports or history, so reloading signs you
  out. Expired tokens are refreshed when a refresh token exists. Limits: the
  token endpoint must allow CORS for this app's origin (browsers hide why it
  fails otherwise), the redirect URI to register is `<origin>/oauth/callback`,
  and a blocked popup cannot be detected (the UI says what to look for).
- [x] Request chaining. "Extract to variables" rules copy a value from a
  response (JSON path, header, status or regex) into a variable of the selected
  environment, where later requests use it as `{{name}}`. Without a selected
  environment the value cannot be kept, and the response says so.
- [x] Automated assertions. Per request: status, header, JSON path, body or
  duration, with equals / contains / regex / exists / numeric comparisons;
  results appear in the response's Tests tab. `{{variables}}` work in expected
  values. A **collection runner** (Run… on a collection or folder) sends the
  requests in sidebar order, passes extracted values from one request to the
  next (even without an environment), can stop at the first failure and shows
  per-request results. It does not repeat requests or read data files, and
  requests that need a chosen upload file fail, because saved requests do not
  keep files. Regular expressions run against the response unguarded, so a
  pathological pattern can be slow.
- [x] GraphQL. A body type with a query editor, a variables editor and an
  operation name; sent as a JSON `{ query, variables, operationName }` document.
  Postman GraphQL bodies import and export. There is no schema explorer or
  introspection.
- [x] WebSockets. A tab type: connect, send text messages, and a message log
  (last 1000, long messages shortened). Binary messages are shown by size. The
  browser exposes no detail about handshake failures and lets a page set no
  headers or cookies on a WebSocket, so none are offered.
- [x] Server-Sent Events. A tab type that reads the stream with `fetch` instead of
  `EventSource`, so request headers (for example Authorization) work; cookies are
  not sent. Handles named events, multi-line data, `id` (sent back as
  `Last-Event-ID` when you reconnect). It does not reconnect automatically.
  WebSocket and event stream tabs are not saved to collections.
- [x] Sandboxed scripting. Pre-request and test scripts per request, in a sandbox:
  an iframe without `allow-same-origin` (no access to the app, its storage or
  cookies) with a content security policy that forbids all network access,
  containing a worker that runs the script (no DOM, cannot navigate or open
  windows, and it inherits the policy). The app never evaluates script text
  (`eval` and `Function` are not used). A 5 second limit stops runaway scripts.
  Before the first script runs, a canary check proves the policy is enforced in
  this browser; otherwise scripts are refused. Scripts can read and change the
  request, read the response, set variables and report tests (`test`, `assert`).
  **Imported scripts are always switched off** until you enable them in the
  Scripts tab, and Postman scripts are not imported at all. Verified in Chromium
  only; Firefox and Safari have not been checked.

Native exports are now format version 2 (assertions, extractions, scripts,
GraphQL bodies, OAuth settings); version 1 files still import, but older
versions of the app refuse version 2 files. The Postman export format has no
place for assertions, extractions or scripts, so those are left out of it.

### Release Readiness

- [ ] Integration tests for the major workflows in the PRD acceptance criteria.
- [ ] Accessibility review (keyboard navigation, WCAG 2.2 AA).
- [ ] Cross-browser verification (Chrome, Edge, Firefox, Safari).
- [ ] Console error check and production build verification.
- [ ] Documentation updated.

## 9. Future Possibilities

Potential future features:

- Postman collection compatibility.
- OpenAPI/Swagger import.
- GraphQL.
- WebSocket testing.
- Server-Sent Events.
- Request scripting.
- Automated assertions.
- Request chaining.
- API testing suites.
- Optional backend execution service.

These features must not compromise the initial frontend-only architecture.

## 10. Documentation

See:

- [PRD.md](PRD.md) — Product Requirements Document.
- [AGENTS.md](AGENTS.md) — Development instructions for AI coding agents.
- [SKILLS.md](SKILLS.md) — Technical skills and implementation guidelines.
