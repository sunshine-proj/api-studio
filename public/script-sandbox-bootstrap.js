// Runs inside the script sandbox iframe (see src/app/core/scripting/script-sandbox.ts).
// It only starts a Worker from the source text it is given and forwards the worker's
// messages to the app. It is a separate file, so the app's Content Security Policy
// does not need to allow inline scripts.
window.addEventListener('message', (event) => {
  const data = event.data || {};
  let source = data.code;
  if (data.kind === 'canary') {
    // A blob URL needs no network, so this fetch succeeds only if the sandbox's policy is NOT being enforced.
    const target = URL.createObjectURL(new Blob(['x']));
    source =
      'fetch(' + JSON.stringify(target) + ", { mode: 'no-cors' }).then(() => postMessage({ canary: 'open' }), () => postMessage({ canary: 'blocked' }));";
  }
  if (typeof source !== 'string') return;
  let worker;
  try {
    worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
  } catch (error) {
    parent.postMessage({ kind: 'failed', message: String(error) }, '*');
    return;
  }
  worker.onmessage = (e) => parent.postMessage({ kind: 'message', data: e.data }, '*');
  worker.onerror = (e) => {
    e.preventDefault();
    parent.postMessage({ kind: 'failed', message: e.message || 'The script could not be run.' }, '*');
  };
});
parent.postMessage({ kind: 'ready' }, '*');
