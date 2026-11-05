# API Studio — Product Requirements Document

- **Version:** 1.0
- **Status:** Initial Development
- **Product type:** Browser-based API development and testing tool

## 1. Product Vision

API Studio is a browser-based application for creating, executing, organizing,
and debugging HTTP API requests.

The product aims to provide functionality similar to Postman while remaining
lightweight, locally operated, and independent of backend infrastructure.

Users should be able to perform everyday API development and testing directly
from their browser.

## 2. Product Objectives

Primary objectives:

- Provide an intuitive HTTP request editor.
- Support common REST API testing workflows.
- Support file uploads and multipart requests.
- Provide detailed response inspection.
- Allow users to save and organize requests.
- Support multiple environments.
- Persist user data locally.
- Support collection import and export.
- Provide a professional developer-oriented interface.

## 3. Target Users

Primary users:

- Backend developers.
- Frontend developers.
- Full-stack developers.
- QA engineers.
- API developers.
- Software testers.
- Students learning REST APIs.

## 4. Application Architecture

The application must operate entirely in the browser.

No backend is required.

Technology:

- Angular.
- TypeScript.
- Angular Material.
- Monaco Editor.
- Fetch API.
- IndexedDB.
- Dexie.js.

## 5. Functional Requirements

### FR-001: HTTP Request Creation

Users must be able to create HTTP requests.

Supported methods:

- GET.
- POST.
- PUT.
- PATCH.
- DELETE.
- HEAD.
- OPTIONS.
- Custom methods where supported.

Users must be able to edit the request URL.

**Priority:** Critical.

### FR-002: Query Parameters

Users must be able to:

- Add parameters.
- Edit parameters.
- Delete parameters.
- Enable or disable parameters.
- Use multiple values for the same parameter.
- Automatically update the request URL.

**Priority:** Critical.

### FR-003: HTTP Headers

Users must be able to:

- Add custom headers.
- Edit headers.
- Delete headers.
- Enable or disable headers.
- Duplicate headers.

The application must respect browser restrictions on forbidden headers.

**Priority:** Critical.

### FR-004: Authorization

Supported authentication types:

- No Authentication.
- Basic Authentication.
- Bearer Token.
- API Key.
- OAuth 2.0.
- Custom Authorization Headers.

**Priority:** High.

> **Note:** OAuth 2.0 must use browser-compatible authorization flows. The
> application must not store client secrets that cannot safely be kept in a
> public browser application.

### FR-005: Request Body

Supported body types:

- None.
- JSON.
- XML.
- Plain Text.
- JavaScript.
- URL Encoded Form.
- Multipart Form Data.
- Binary.

Monaco Editor must be used for suitable text-based body formats.

**Priority:** Critical.

### FR-006: File Uploads

Users must be able to:

- Select local files.
- Upload multiple files.
- Add text fields.
- Combine files and text fields.
- Remove selected files.
- Submit multipart/form-data requests.

Support large-file upload progress where browser capabilities allow it
(best-effort; implemented with XMLHttpRequest upload events).

**Priority:** Critical (file selection and submission). Upload progress is
High.

### FR-007: HTTP Execution

Requests must execute directly from the browser.

Requirements:

- Execute requests.
- Measure request duration.
- Cancel requests.
- Configure timeouts.
- Handle network errors.
- Handle HTTP error statuses.
- Handle browser security restrictions.
- Support HTTPS.
- Support HTTP where browser security policies permit.

**Priority:** Critical.

### FR-008: Response Viewer

Display:

- HTTP status.
- Status description.
- Execution duration.
- Response size where measurable.
- Response body.
- Response headers.
- Accessible cookies.

> **Note:** Browsers do not expose `Set-Cookie` response headers to JavaScript,
> so the cookies view will usually be empty. The UI must state this instead of
> implying that the response set no cookies. Likewise, cross-origin responses
> only expose CORS-safelisted headers unless the server sends
> `Access-Control-Expose-Headers`.

Response body views:

- Pretty JSON.
- JSON tree.
- Raw.
- XML.
- HTML.
- Plain text.
- Binary download.
- Image preview.

**Priority:** Critical.

### FR-009: Collections

Users must be able to:

- Create collections.
- Rename collections.
- Delete collections.
- Create folders.
- Move requests.
- Duplicate requests.
- Save requests.
- Organize requests hierarchically.

**Priority:** Critical.

### FR-010: Local Persistence

Use IndexedDB.

Persist:

- Collections.
- Requests.
- Folders.
- Environments.
- Settings.
- Request history.

Application data must survive browser restarts.

**Priority:** Critical.

### FR-011: Environment Management

Users must be able to:

- Create environments.
- Rename environments.
- Delete environments.
- Add variables.
- Edit variables.
- Delete variables.
- Switch active environments.

Support variable syntax:

```text
{{variableName}}
```

Variables must be resolved before request execution.

**Priority:** High.

### FR-012: Request History

Record request execution history.

Store:

- Request definition snapshot.
- Execution timestamp.
- HTTP method.
- URL.
- Status.
- Duration.
- Error information.

Users must be able to reopen previous requests.

Sensitive values must be handled carefully.

**Priority:** Medium.

### FR-013: Import and Export

Support importing and exporting application collections.

Future compatibility:

- Postman Collection format.
- OpenAPI specifications.
- JSON-based native format.

**Priority:** High.

### FR-014: Multiple Request Tabs

Users must be able to open multiple requests simultaneously.

Support:

- Create tabs.
- Switch tabs.
- Close tabs.
- Duplicate tabs.
- Preserve unsaved changes.

**Priority:** Medium.

### FR-015: Application Themes

Support:

- Light theme.
- Dark theme.
- Theme persistence.

**Priority:** Medium.

## 6. Non-Functional Requirements

### Performance

Initial targets (revisit once the project is scaffolded and measured):

- Initial bundle under 500 KB gzipped, excluding lazy-loaded chunks.
- Monaco Editor loaded lazily, never in the initial bundle.
- Interactive within 3 seconds on a mid-range laptop on a cold load.
- Lazy loading of large features.
- Avoid unnecessary UI rendering.
- Handle large JSON responses carefully (see response size limits in
  AGENTS.md).

### Browser Support

- Latest two stable versions of Chrome, Edge, Firefox, and Safari.
- Safari may evict IndexedDB data for sites unused for an extended period;
  the application should request persistent storage with
  `navigator.storage.persist()` and recommend regular exports.

### Usability

- Clear, actionable error messages.
- Keyboard accessibility; target WCAG 2.2 AA.
- Documented keyboard shortcuts.
- Desktop-first layout with a defined minimum supported width
  (initially 1024 px).
- Consistent visual design.

### Security

- No backend dependencies.
- No automatic execution of imported scripts.
- Safe response rendering.
- Protection against XSS.
- Safe handling of local secrets.
- Clear warnings about local data storage.

### Reliability

- IndexedDB schema migrations.
- Import/export backups.
- Graceful handling of storage failures.
- Error handling for interrupted requests.

## 7. User Interface Requirements

Main application layout:

- Application header.
- Collections sidebar.
- Request editor.
- Response viewer.
- Environment selector.

Request editor tabs:

- Params.
- Headers.
- Authorization.
- Body.
- Scripts (future).

Response viewer tabs:

- Body.
- Headers.
- Cookies.
- Raw.

## 8. Development Roadmap

### Milestone 1: Core HTTP Client

- Application layout.
- HTTP method selection.
- URL editor.
- Query parameters.
- Headers.
- Basic JSON body.
- Environment variable resolution (`{{variableName}}`) in the executor, with
  in-memory environments (persistence follows in Milestone 3).
- Send request.
- Response viewer.

### Milestone 2: Advanced Request Support

- XML.
- Text.
- URL-encoded forms.
- Multipart forms.
- File uploads.
- Binary requests.
- Authentication.

### Milestone 3: Local Persistence

- IndexedDB.
- Collections.
- Folders.
- Saved requests.
- Environments.
- Application settings.

### Milestone 4: Advanced Response Handling

- JSON tree.
- Syntax highlighting.
- Response headers.
- Download responses.
- Image preview.
- Request history.

### Milestone 5: Import and Export

- Native JSON format.
- Postman collection import/export.
- OpenAPI import.

### Milestone 6: Advanced Features

- Request chaining.
- Automated assertions.
- GraphQL.
- WebSockets.
- Server-Sent Events.
- Sandboxed scripting.

## 9. MVP Definition

The first usable release must support:

- GET.
- POST.
- PUT.
- PATCH.
- DELETE.
- Query parameters.
- Custom headers.
- JSON requests.
- Text requests.
- URL-encoded forms.
- Multipart forms.
- File uploads.
- HTTP response inspection.
- Collections.
- Saved requests.
- IndexedDB persistence.
- Environments with variable substitution.
- Export and import of collections (native JSON format).
- Basic, Bearer Token, and API Key authorization.

The MVP must work without a backend.

## 10. Acceptance Criteria

The initial release is considered functional when:

- A user can create an HTTP request.
- A user can execute a request.
- A user can inspect the response.
- A user can upload files.
- A user can submit multipart forms.
- A user can save requests.
- A user can organize requests into collections.
- Saved data survives browser restarts.
- A user can export and import collections.
- Browser security limitations are handled transparently.

## 11. Out of Scope for Initial Release

- Backend request execution.
- Cloud synchronization.
- Multi-user collaboration.
- Remote databases.
- Team workspaces.
- Desktop application packaging.
- Automated API monitoring.

These may be considered in future versions.
