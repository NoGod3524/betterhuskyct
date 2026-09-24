import { Window } from "happy-dom";

/**
 * A browser for one test file: happy-dom's window, installed as the globals
 * React DOM and the app reach for.
 *
 * Deliberately short — only what rendering the provider needs. A missing global
 * fails loudly as a ReferenceError, which is the signal to add it here.
 */
export function installDom(url = "http://localhost/") {
  const window = new Window({ url });
  const globals: Record<string, unknown> = {
    window,
    document: window.document,
    navigator: window.navigator,
    localStorage: window.localStorage,
    location: window.location,
    history: window.history,
    HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement,
    HTMLIFrameElement: window.HTMLIFrameElement,
    Node: window.Node,
    Element: window.Element,
    MutationObserver: window.MutationObserver,
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    // React warns outside act(); the tests drive everything through act().
    IS_REACT_ACT_ENVIRONMENT: true,
  };

  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries(globals)) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    // Node has its own `navigator` as a getter; define over it rather than assign.
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }

  return {
    window,
    async uninstall() {
      await window.happyDOM.close();
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete (globalThis as Record<string, unknown>)[name];
      }
    },
  };
}
