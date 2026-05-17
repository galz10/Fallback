import { parseHTML } from "linkedom";

export function installRendererDom(html = '<!doctype html><html><body><main id="root"></main></body></html>'): Window {
  const { window } = parseHTML(html);
  const globalWithDom = globalThis as typeof globalThis & {
    window: Window;
    document: Document;
    HTMLElement: typeof HTMLElement;
    customElements: CustomElementRegistry;
    navigator: Navigator;
  };
  globalWithDom.window = window as unknown as Window;
  globalWithDom.document = window.document as unknown as Document;
  globalWithDom.HTMLElement = window.HTMLElement as unknown as typeof HTMLElement;
  globalWithDom.customElements = window.customElements as unknown as CustomElementRegistry;
  globalWithDom.navigator = window.navigator as unknown as Navigator;
  return window as unknown as Window;
}
