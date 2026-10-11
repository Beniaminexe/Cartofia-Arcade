/*
  Minimal, safe Markdown subset for forum posts.

  Supported:
    #, ##, ###     headers (line start)
    **bold**       bold
    *italic*       italic (also _italic_)
    ~~strike~~     strikethrough
    `code`         inline code
    ```code```     fenced code block
    > quote        line quote
    - item         unordered list (- or *)
    [text](url)    links; http(s) + relative only
    @username      auto-link to /u/<username>
    autolinks      bare http(s) URLs
    newlines preserved via <br>

  All HTML in the input is escaped first — rendered output is safe to drop
  into innerHTML.
*/
(function () {
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function safeUrl(url) {
    if (!url) return null;
    const u = String(url).trim();
    if (/^(https?:)?\/\//i.test(u))                 return u;
    if (u.startsWith('/') || u.startsWith('#'))     return u;
    if (/^[a-z0-9_-]+(\/|$)/i.test(u))              return u;
    return null;
  }

  function render(input) {
    if (!input) return '';
    let s = String(input);

    // 1. Extract fenced code blocks first (store placeholders).
    const codeBlocks = [];
    s = s.replace(/```([\s\S]*?)```/g, (_, body) => {
      const i = codeBlocks.push(body) - 1;
      return '\x00CODE' + i + '\x00';
    });

    // 2. Escape all remaining HTML.
    s = escapeHtml(s);

    // 3. Inline code (single backticks).
    s = s.replace(/`([^`\n]+)`/g, (_, body) => '<code>' + body + '</code>');

    // 4. Headers.
    s = s.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
    s = s.replace(/^##\s+(.+)$/gm,  '<h2>$1</h2>');
    s = s.replace(/^#\s+(.+)$/gm,   '<h1>$1</h1>');

    // 5. Blockquotes (line-level).
    s = s.replace(/^(?:&gt;)\s?(.+)$/gm, '<blockquote>$1</blockquote>');
    s = s.replace(/(<\/blockquote>)\n(<blockquote>)/g, '\n');

    // 6. Unordered lists — group consecutive bullets.
    s = s.replace(/^(?:[-*])\s+(.+(?:\n(?:[-*])\s+.+)*)/gm, (block) => {
      const items = block.split(/\n/).map(line => {
        const m = line.match(/^(?:[-*])\s+(.+)$/);
        return m ? '<li>' + m[1] + '</li>' : '';
      }).join('');
      return '<ul>' + items + '</ul>';
    });

    // 7. Bold / italic / strike.
    s = s.replace(/\*\*([^*\n][^*]*?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(?<!\w)_([^_\n]+?)_(?!\w)/g, '<em>$1</em>');
    s = s.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');
    s = s.replace(/~~([^~\n]+?)~~/g, '<del>$1</del>');

    // 8. Links [text](url).
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, url) => {
      const safe = safeUrl(url);
      if (!safe) return text;
      return '<a href="' + safe + '" rel="nofollow noopener" target="_blank">' + text + '</a>';
    });

    // 9. @mentions — only when preceded by whitespace or start-of-string.
    s = s.replace(/(^|[\s(])@([a-z0-9_]{2,30})\b/gi, (_, pre, name) => {
      return pre + '<a class="mention" href="/u/' + encodeURIComponent(name.toLowerCase()) + '">@' + name + '</a>';
    });

    // 10. Autolink bare URLs (http/https).
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<]+)/g, (_, pre, url) => {
      return pre + '<a href="' + url + '" rel="nofollow noopener" target="_blank">' + url + '</a>';
    });

    // 11. Newlines → <br>, but not inside block elements.
    s = s.replace(/\n(?!<\/?(h1|h2|h3|ul|li|blockquote|pre|hr))/g, '<br/>');

    // 12. Restore fenced code blocks.
    s = s.replace(/\x00CODE(\d+)\x00/g, (_, i) => {
      const body = escapeHtml(codeBlocks[i]).replace(/^\n/, '');
      return '<pre><code>' + body + '</code></pre>';
    });

    return s;
  }

  window.CartofiaMarkdown = {
    render:     render,
    escapeHtml: escapeHtml,
  };
})();
