// Installs an in-memory IndexedDB before any spec loads. Dexie reads the global
// when its module is first evaluated, so this must not depend on spec order.
import 'fake-indexeddb/auto';
