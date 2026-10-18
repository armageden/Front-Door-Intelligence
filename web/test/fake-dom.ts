/**
 * A minimal DOM, sufficient to drive this repository's two browser trees in tests.
 *
 * **This is not a browser and not a DOM implementation.** It implements the operations the
 * application code actually calls, and nothing else. What it buys is that a test can drive
 * the entry points — `startPipeline()`, `startOverlay()`, `load()` — without a browser,
 * which is the only way those files get covered at all: they are entry points, so they
 * execute on import and nothing else ever reaches them.
 *
 * What is deliberately NOT here: layout, styles, event propagation, text nodes,
 * attributes beyond id and class. Anything needing those belongs in a browser, and the
 * repository says so wherever it matters.
 *
 * Why hand-written rather than a library: `npm install` does not work in this environment
 * (see `docs/03-repository/02-toolchain.md`), and a 200-line fake that can be read in one
 * sitting is easier to trust than a dependency nobody can install.
 */

export interface ClassList {
  add(...names: string[]): void;
  remove(...names: string[]): void;
  contains(name: string): boolean;
}

export interface FakeElement {
  readonly tagName: string;
  className: string;
  id: string;
  textContent?: string;
  src?: string;
  alt?: string;
  /** Set on the demo banner by firetv/src/main.ts to show or hide it. */
  hidden?: boolean;
  /**
   * The input value. Defaults to empty because `app.ts` calls `.trim()` on it without
   * guarding, so an element with no `value` at all would crash the control wiring.
   */
  value?: string;
  /** Set by the application; read by nobody. Present so assignments typecheck. */
  style: { setProperty(name: string, value: string): void; removeProperty(name: string): void };
  children: FakeElement[];
  parent?: FakeElement;
  classList: ClassList;
  append(...nodes: FakeElement[]): void;
  replaceChildren(...nodes: FakeElement[]): void;
  addEventListener(type: string, handler: () => void): void;
  /** Fire a listener registered above. Returns how many ran. */
  dispatch(type: string): number;
  /** Every node at or below this one, document order. */
  descendants(): FakeElement[];
  querySelector(selector: string): FakeElement | null;
  querySelectorAll(selector: string): FakeElement[];
  matches(selector: string): boolean;
  /** Zero-size. Layout is not modelled, and no assertion here depends on it. */
  getBoundingClientRect(): { top: number; right: number; bottom: number; left: number; width: number; height: number };
  /** Present because the code guards on it. Always present here; set false to simulate absence. */
  readonly clientWidth: number;
}

function makeClassList(element: FakeElement): ClassList {
  const names = (): string[] => element.className.split(' ').filter((n) => n.length > 0);
  return {
    add(...added: string[]): void {
      const current = names();
      for (const name of added) if (!current.includes(name)) current.push(name);
      element.className = current.join(' ');
    },
    remove(...removed: string[]): void {
      element.className = names().filter((n) => !removed.includes(n)).join(' ');
    },
    contains(name: string): boolean {
      return names().includes(name);
    },
  };
}

/**
 * Match a descendant selector such as `#app .event`.
 *
 * Space-separated tokens, each of which must match at or above the node, with the last one
 * matching the node itself. That covers every selector the application code uses
 * (`#app .event`, `.tv-screen > #overlay`, `#app .event--pending`) without pulling in a
 * selector engine.
 */
function matchesSelector(node: FakeElement, selector: string, root: FakeElement): boolean {
  const tokens = selector.trim().split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length === 0) return false;

  const last = tokens[tokens.length - 1];
  if (last === undefined || !node.matches(last)) return false;

  // Every earlier token must match some ancestor, walking up to the query root.
  const ancestors: (FakeElement | undefined)[] = [];
  for (let cursor = node.parent; cursor !== undefined && cursor !== root; cursor = cursor.parent) {
    ancestors.push(cursor);
  }
  ancestors.push(root);

  for (const token of tokens.slice(0, -1)) {
    if (!ancestors.some((ancestor) => ancestor !== undefined && ancestor.matches(token))) {
      return false;
    }
  }
  return true;
}

export function createElement(tagName: string): FakeElement {
  const listeners: Record<string, (() => void)[]> = {};
  const element: FakeElement = {
    tagName: tagName.toUpperCase(),
    className: '',
    id: '',
    value: '',
    children: [],
    style: { setProperty: () => undefined, removeProperty: () => undefined },
    clientWidth: 1024,
    classList: undefined as unknown as ClassList,
    append(...nodes: FakeElement[]): void {
      for (const node of nodes) {
        node.parent = element;
        element.children.push(node);
      }
    },
    replaceChildren(...nodes: FakeElement[]): void {
      for (const node of nodes) node.parent = element;
      element.children = [...nodes];
    },
    addEventListener(type: string, handler: () => void): void {
      listeners[type] = [...(listeners[type] ?? []), handler];
    },
    dispatch(type: string): number {
      const registered = listeners[type] ?? [];
      for (const handler of registered) handler();
      return registered.length;
    },
    descendants(): FakeElement[] {
      return element.children.flatMap((child) => [child, ...child.descendants()]);
    },
    /**
     * One compound selector: `#id`, `.class`, or `tag`.
     *
     * Descendant combinators are handled by `matchesSelector` below rather than here, so
     * this stays a genuinely single-token test.
     */
    matches(selector: string): boolean {
      if (selector.startsWith('#')) return element.id === selector.slice(1);
      if (selector.startsWith('.')) return element.classList.contains(selector.slice(1));
      return element.tagName === selector.toUpperCase();
    },
    querySelector(selector: string): FakeElement | null {
      return element.descendants().find((node) => matchesSelector(node, selector, element)) ?? null;
    },
    querySelectorAll(selector: string): FakeElement[] {
      return element.descendants().filter((node) => matchesSelector(node, selector, element));
    },
    getBoundingClientRect(): {
      top: number;
      right: number;
      bottom: number;
      left: number;
      width: number;
      height: number;
    } {
      return { top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0 };
    },
  };
  element.classList = makeClassList(element);
  return element;
}

/**
 * Build elements from a fragment of HTML.
 *
 * A real parser is not attempted. Only `<tag id="..." class="...">` is recognised, because
 * that is all the application's markup uses in the places a test needs to stage: a root to
 * render into, a stage strip, two panes. Nesting is not tracked — everything is attached to
 * the body — which is enough because every lookup here is by id or class.
 */
export function parseFragment(html: string): FakeElement[] {
  const created: FakeElement[] = [];
  const tagPattern = /<(\w+)([^>]*)>/g;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(html)) !== null) {
    const [, tagName, attributes] = match;
    const element = createElement(tagName ?? 'div');
    element.id = /\bid="([^"]*)"/.exec(attributes ?? '')?.[1] ?? '';
    element.className = /\bclass="([^"]*)"/.exec(attributes ?? '')?.[1] ?? '';
    created.push(element);
  }
  return created;
}

/**
 * Set environment variables from a browser-typed file.
 *
 * `web/tsconfig.json` has no Node types, so a test here cannot write `process.env` without
 * either a cast at every use or an `as` on the type. This is that cast, once, and it lives
 * beside the fake DOM because it is the same category of thing: standing in for a host the
 * application does not control.
 */
type ProcessLike = { env: Record<string, string | undefined> };

export function setEnv(values: Record<string, string | undefined>): void {
  const proc = (globalThis as { process?: ProcessLike }).process;
  if (proc === undefined) throw new Error('setEnv called where there is no process');
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete proc.env[key];
    else proc.env[key] = value;
  }
}

/**
 * The `window` the entry points read.
 *
 * `firetv/src/main.ts` chooses live-versus-demo from `window.location.search`, so a fake
 * document without a `window` fails at module evaluation — and a test that says "with no
 * endpoint" has to be able to say so *by controlling that search string*.
 */
export interface FakeWindow {
  location: { search: string; href: string };
}

/** A window whose query string a test can set to select a mode. */
export function createWindow(search = ''): FakeWindow {
  return { location: { search, href: `http://localhost/${search}` } };
}

export interface FakeDocument {
  body: FakeElement;
  createElement(tagName: string): FakeElement;
  getElementById(id: string): FakeElement | null;
  querySelector(selector: string): FakeElement | null;
  querySelectorAll(selector: string): FakeElement[];
}

function createDocument(): FakeDocument {
  const body = createElement('body');
  return {
    body,
    createElement: (tagName: string) => createElement(tagName),
    getElementById: (id: string) => body.querySelector(`#${id}`),
    querySelector: (selector: string) => body.querySelector(selector),
    querySelectorAll: (selector: string) => body.querySelectorAll(selector),
  };
}

/**
 * Query helpers, kept at module level so a test can read them as `byClass(root, 'event')`
 * rather than `root.querySelectorAll('.event')`.
 *
 * These existed before the fake grew a real tree, and are worth keeping: the assertions in
 * `app.test.ts` read better with them and there is no reason to churn passing tests.
 */
export function flatten(node: FakeElement): FakeElement[] {
  return [node, ...node.descendants()];
}

export function byTag(node: FakeElement, tagName: string): FakeElement[] {
  return node.querySelectorAll(tagName);
}

export function byClass(node: FakeElement, className: string): FakeElement[] {
  return node.querySelectorAll(`.${className}`);
}

/** Every non-empty `textContent` at or below a node, in document order. */
export function texts(node: FakeElement): string[] {
  return flatten(node)
    .filter((n) => typeof n.textContent === 'string' && n.textContent.length > 0)
    .map((n) => n.textContent as string);
}

let installed: {
  previous: unknown;
  had: boolean;
  previousWindow: unknown;
  hadWindow: boolean;
} | undefined;

/**
 * Install the fake document on `globalThis`, staging any elements named in `html`.
 *
 * Returns the document plus a `restore`. Nested calls are not supported and the second one
 * is a no-op rather than an error, because a suite that forgets to restore should still be
 * able to run — though it will then be testing against whatever state it left behind.
 */
export function withFakeDom(
  html = '',
  search = '',
): { document: FakeDocument; root: FakeElement; restore: () => void } {
  if (installed === undefined) {
    installed = {
      previous: (globalThis as { document?: unknown }).document,
      had: 'document' in globalThis,
      previousWindow: (globalThis as { window?: unknown }).window,
      hadWindow: 'window' in globalThis,
    };
  }
  const document = createDocument();
  document.body.children = parseFragment(html);
  (globalThis as { document?: unknown }).document = document;
  (globalThis as { window?: unknown }).window = createWindow(search);
  // A root to render into, for callers that pass one in rather than stage it in markup.
  const root = createElement('main');
  return {
    document,
    root,
    restore: () => {
      uninstallFakeDom();
    },
  };
}

/** Remove the fake entirely. For suites that install their own globals. */
export function uninstallFakeDom(): void {
  if (installed === undefined) return;
  if (installed.had) (globalThis as { document?: unknown }).document = installed.previous;
  else delete (globalThis as { document?: unknown }).document;
  if (installed.hadWindow) (globalThis as { window?: unknown }).window = installed.previousWindow;
  else delete (globalThis as { window?: unknown }).window;
  installed = undefined;
}

/** Convenience: stage a document with the pipeline demo's real element ids. */
export function withPipelineDom(): {
  document: FakeDocument;
  root: FakeElement;
  restore: () => void;
} {
  return withFakeDom(
    '<ol id="stages"></ol>' +
      '<div class="tv-screen"></div>' +
      '<section class="surface surface--tv"></section>' +
      '<div id="app"></div>' +
      '<main id="overlay"></main>' +
      '<button id="replay"></button>',
  );
}

/** Convenience: stage a document with the overlay demo's own element. */
export function withOverlayDom(): {
  document: FakeDocument;
  root: FakeElement;
  restore: () => void;
} {
  return withFakeDom('<main id="overlay"></main><p id="demo-banner"></p>');
}