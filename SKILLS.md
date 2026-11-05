# API Studio — Technical Skills and Implementation Guidelines

This document defines the technical knowledge, implementation practices, and
quality standards required when developing API Studio.

## 1. Angular Development

Required knowledge:

- Angular standalone components.
- Angular dependency injection.
- Angular Signals.
- RxJS.
- Angular routing.
- Angular Material.
- Reactive Forms.
- Angular lifecycle.
- Change detection.
- Lazy loading.

Implementation expectations:

- Build reusable components.
- Keep components focused.
- Separate presentation and business logic.
- Use typed inputs and outputs.
- Avoid unnecessary subscriptions.
- Prefer Signals for application state where appropriate.

## 2. TypeScript

Required knowledge:

- Interfaces.
- Types.
- Generics.
- Union types.
- Utility types.
- Async/await.
- Promises.
- Error handling.
- Type narrowing.

Implementation expectations:

- Enable strict typing.
- Avoid `any`.
- Define explicit application models.
- Use type-safe services.
- Avoid duplicated interfaces.
- Keep shared models in a dedicated location.

## 3. HTTP and Browser APIs

Required knowledge:

- HTTP methods.
- HTTP headers.
- Query parameters.
- Request bodies.
- HTTP status codes.
- Content types.
- CORS.
- Fetch API.
- XMLHttpRequest.
- FormData.
- AbortController.
- Response streams.
- Browser security policies.

Implementation expectations:

- Correctly prepare HTTP requests.
- Respect browser restrictions.
- Handle network errors.
- Handle HTTP error statuses.
- Support request cancellation.
- Handle different response content types.
- Avoid assuming every response is JSON.

## 4. File Uploads

Required knowledge:

- File API.
- FileList.
- Blob.
- FormData.
- XMLHttpRequest upload events.
- Multipart boundaries.
- Binary request bodies.

Implementation expectations:

- Support multiple files.
- Support mixed text and file fields.
- Preserve repeated field names.
- Show file metadata.
- Support upload progress where possible.
- Avoid unnecessary file copies in memory.

## 5. Monaco Editor

Required knowledge:

- Monaco Editor integration.
- Language configuration.
- Syntax highlighting.
- Editor models.
- Editor lifecycle.
- Formatting providers.

Implementation expectations:

- Support JSON.
- Support XML.
- Support plain text.
- Support JavaScript.
- Provide formatting.
- Provide syntax validation.
- Dispose editor instances correctly.

## 6. IndexedDB and Dexie.js

Required knowledge:

- IndexedDB.
- Dexie.js.
- Database transactions.
- Database indexes.
- Schema versioning.
- Database migrations.
- Browser storage quotas.

Implementation expectations:

- Use typed database models.
- Implement versioned schemas.
- Handle storage errors.
- Avoid storing unnecessary temporary data.
- Provide export and backup mechanisms.

## 7. UI/UX Development

Required knowledge:

- Angular Material.
- SCSS.
- CSS Grid.
- Flexbox.
- Responsive layouts.
- Accessibility.
- Keyboard navigation.
- Dark and light themes.

Implementation expectations:

- Build a developer-oriented interface.
- Use consistent spacing.
- Support resizable panels.
- Support keyboard shortcuts.
- Provide clear loading and error states.
- Avoid unnecessary animations.

## 8. API Data Modelling

Required knowledge:

- HTTP request models.
- HTTP response models.
- Collection hierarchies.
- Environment variables.
- Authentication configurations.
- Serialization.
- Import/export formats.

Implementation expectations:

- Keep models independent of UI components.
- Use stable identifiers.
- Support model versioning.
- Avoid coupling persisted data to Angular-specific structures.

## 9. Security

Required knowledge:

- CORS.
- XSS.
- Content Security Policy.
- Browser sandboxing.
- Safe HTML rendering.
- OAuth 2.0 PKCE.
- Secret management.
- Untrusted input validation.

Implementation expectations:

- Never execute imported scripts automatically.
- Never trust API response HTML.
- Avoid `eval()`.
- Avoid `Function()` for executing arbitrary code.
- Do not expose secrets in console logs.
- Warn users before exporting sensitive environment data.
- Treat imported collections as untrusted.
- Do not attempt to bypass browser security policies.

## 10. Testing

Required knowledge:

- Angular testing.
- Unit testing.
- Integration testing.
- HTTP mocking.
- IndexedDB testing.
- Browser automation.
- Test data generation.

Implementation expectations:

The required test areas are defined in [AGENTS.md](AGENTS.md) section 13. That
list is the single source of truth.

Practical guidance:

- Mock HTTP at the executor boundary, not by patching `fetch` in components.
- Use `fake-indexeddb` (or equivalent) for Dexie tests and test each migration
  from the previous schema version.
- Build multipart tests by inspecting the `FormData` entries, not by parsing
  raw boundaries.

## 11. Git and Development Workflow

Required knowledge:

- Git.
- Feature branches.
- Commits.
- Code reviews.
- Dependency management.
- npm scripts.

Implementation expectations:

- Make small, focused commits.
- Avoid unrelated modifications.
- Keep dependencies updated.
- Document architectural changes.
- Run builds and tests before completing work.

## 12. Future Skills

The following knowledge may be needed for future releases:

- OpenAPI.
- Swagger.
- Postman collection formats.
- GraphQL.
- WebSockets.
- Server-Sent Events.
- OAuth 2.0.
- JavaScript sandboxing.
- Automated API testing.
- JSON Schema.

These are not mandatory for the initial MVP.

## 13. Definition of Done

A feature is complete only when every item in the pre-completion checklist in
[AGENTS.md](AGENTS.md) section 14 is satisfied, and:

- Error handling is implemented.
- Documentation is updated where necessary.
- No unnecessary dependencies are introduced.
