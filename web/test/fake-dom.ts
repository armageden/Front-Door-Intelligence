/**
 * A minimal in-memory DOM, just enough to drive `app.ts`.
 *
 * **This is not a browser and not a DOM implementation.** It implements the seven things
 * `app.ts` actually calls, and nothing else. That is enough to test the shell's *branching*
 * — which message appears for a 401, whether a null snapshot produces a `<figure>`, whether
 * a pending event gets its modifier class — and not enough to claim the rendering is
 * correct. A real render happened on 2026-10-04 and matched what these tests predicted;
 * layout, styling, and accessibility are checked only by that kind of render, not here.
 *
 * Writing a stub rather than reaching for a DOM library is the same choice made everywhere
 * else in this repository: `npm install` does not work here, and a 60-line fake is easier to
 * audit than a dependency nobody can install.
 */

export interface FakeNode {
  tagName: string;
  className: string;
  textContent?: string;
  src?: string;
  alt?: string;
  children: FakeNode[];
  /** Set by addEventListener; this stub never dispatches, it only records. */
  listeners: Record<string, (() => void)[]>;
  append(...kids: FakeNode[]): void;
  replaceChildren(...kids: FakeNode[]): void;
  addEventListener(type: string, fn: () => void): void;
}

/**
 * A node carries its own tree operations, so a node created by `document.createElement` is
 * immediately usable. An earlier version patched nodes only when they were appended, which
 * meant `createElement` handed back something the app could not call `.append` on — the
 * stub was wrong, not the app.
 */
function makeNode(tagName: string): FakeNode {
  const node: FakeNode = {
    tagName,
    className: '',
    children: [],
    listeners: {},
    append: (...kids: FakeNode[]) => {
      node.children.push(...kids);
    },
    replaceChildren: (...kids: FakeNode[]) => {
      node.children = [...kids];
    },
    addEventListener: (type: string, fn: () => void) => {
      node.listeners[type] = [...(node.listeners[type] ?? []), fn];
    },
  };
  return node;
}

/** Depth-first walk, used by the tests to assert on structure. */
export function flatten(node: FakeNode): FakeNode[] {
  return [node, ...node.children.flatMap(flatten)];
}

export function byTag(node: FakeNode, tagName: string): FakeNode[] {
  return flatten(node).filter((n) => n.tagName === tagName);
}

export function byClass(node: FakeNode, className: string): FakeNode[] {
  return flatten(node).filter((n) => n.className.split(' ').includes(className));
}

/** Every string the UI rendered, in document order. The tests assert against this. */
export function texts(node: FakeNode): string[] {
  return flatten(node)
    .filter((n) => n.textContent !== undefined && n.textContent.length > 0)
    .map((n) => n.textContent as string);
}

export function createRoot(): FakeNode {
  return makeNode('main');
}

/**
 * Install the fake on `globalThis` and return the created root plus a restore function.
 *
 * `load()` takes the root as an argument but reads `document.createElement` from the
 * global, so both have to be stubbed — which is itself a small finding about `app.ts`: it is
 * not fully injectable, and a future React swap will want that changed.
 */
export function withFakeDom(): { root: FakeNode; restore: () => void } {
  const previous = (globalThis as { document?: unknown }).document;
  const documentStub = {
    createElement: (tagName: string): FakeNode => makeNode(tagName),
    getElementById: (): null => null,
  };
  (globalThis as { document?: unknown }).document = documentStub;

  return { root: createRoot(), restore: () => {
    if (previous === undefined) delete (globalThis as { document?: unknown }).document;
    else (globalThis as { document?: unknown }).document = previous;
  } };
}