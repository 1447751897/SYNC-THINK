/** Options shared by generated HTML previews and the embedded browser handoff. */
export interface HtmlBrowserOpenOptions {
  /** Project-relative HTML path to reuse for the browser document. */
  relativePath?: string;
  /** Persist the generated document before opening it. Defaults to true. */
  persist?: boolean;
}

export type OpenHtmlInBrowser = (
  html: string,
  options?: HtmlBrowserOpenOptions,
) => void | Promise<void>;
