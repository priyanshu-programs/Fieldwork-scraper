import { it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
it("does not execute HTML or javascript links from collected content", () => {
  const html = renderToStaticMarkup(
    createElement(ReactMarkdown, {
      children: "<script>alert(1)</script>\n\n[attack](javascript:alert(1))",
    }),
  );
  expect(html).not.toContain("<script>");
  expect(html).not.toContain('href="javascript:');
});
