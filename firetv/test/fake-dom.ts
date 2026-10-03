/**
 * A minimal in-memory DOM for the overlay shell's tests — the same stand-in
 * `web/test/fake-dom.ts` provides for the dashboard, copied rather than imported because
 * the three source trees are deliberately separate typechecking worlds (the root tsconfig
 * is Node-only; web/ and firetv/ are browser-only, and a cross-tree import fails to
 * resolve by design).
 *
 * It implements what `firetv/src/app.ts` calls and nothing more. It is not a browser:
 * layout, styling, and focus behaviour are verified only by a real render.
 */

export interface FakeNode {
  tagName: string;
  className: string;
  textContent?: string;
  src?: string;
  alt?: string;
  children: FakeNode[];
  listeners: Record<string, (() => void)[]>;
  append(...kids: FakeNode[]): void;
  replaceChildren(...kids: FakeNode[]): void;
  addEventListener(type: string, fn: () => void): void;
}

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

export function flatten(node: FakeNode): FakeNode[] {
  return [node, ...node.children.flatMap(flatten)];
}

export function byTag(node: FakeNode, tagName: string): FakeNode[] {
  return flatten(node).filter((n) => n.tagName === tagName);
}

export function byClass(node: FakeNode, className: string): FakeNode[] {
  return flatten(node).filter((n) => n.className.split(' ').includes(className));
}

export function texts(node: FakeNode): string[] {
  return flatten(node)
    .filter((n) => n.textContent !== undefined && n.textContent.length > 0)
    .map((n) => n.textContent as string);
}

export function createRoot(): FakeNode {
  return makeNode('main');
}

export function withFakeDom(): { root: FakeNode; restore: () => void } {
  const previous = (globalThis as { document?: unknown }).document;
  const documentStub = {
    createElement: (tagName: string): FakeNode => makeNode(tagName),
    getElementById: (): null => null,
  };
  (globalThis as { document?: unknown }).document = documentStub;

  return {
    root: createRoot(),
    restore: () => {
      if (previous === undefined) delete (globalThis as { document?: unknown }).document;
      else (globalThis as { document?: unknown }).document = previous;
    },
  };
}
