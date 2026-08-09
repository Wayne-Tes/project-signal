'use client';

import type { JSX, ReactNode } from 'react';

/**
 * A small markdown renderer for the help corpus and assistant answers.
 *
 * WHY NOT A LIBRARY. Every markdown library renders to an HTML string, which means
 * `dangerouslySetInnerHTML`, which means the sanitiser is now the only thing standing between a
 * model's output and script execution in an authenticated page. This renderer emits React
 * elements and never touches innerHTML, so there is no injection surface to sanitise: text is
 * text, and the only place a URL is used is an `href` that is scheme-checked below.
 *
 * It supports exactly the subset the corpus and the assistant use — headings, bold, inline code,
 * links, bullet and numbered lists, fenced and indented code, tables, and paragraphs. Anything
 * else renders as its own literal text, which is the right failure: a stray character is a
 * cosmetic problem, whereas silently dropping content loses meaning.
 */

export interface MarkdownProps {
  children: string;
  /** Called instead of navigating for an in-app `/help/...` link. */
  onNavigate?: (href: string) => void;
}

/**
 * Only http(s) and in-app paths may become an href.
 *
 * `javascript:` and `data:` URLs in a link are the classic way an injected document runs script
 * on click. The assistant's output is model-generated and can quote a hostile signal, so this is
 * a real path rather than a theoretical one.
 */
function safeHref(href: string): string | undefined {
  const trimmed = href.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/')) return trimmed;
  return undefined;
}

/** Inline formatting: `**bold**`, `` `code` ``, and `[text](href)`. */
function renderInline(text: string, onNavigate?: (href: string) => void): ReactNode[] {
  const out: ReactNode[] = [];
  /* One pass, one regex, alternation ordered so that code wins over bold — otherwise
     `` `a ** b` `` renders half a bold tag inside a code span. */
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];

    if (token.startsWith('`')) {
      out.push(
        <code className="ds-md__code" key={`c${key}`}>
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('**')) {
      out.push(<strong key={`b${key}`}>{token.slice(2, -2)}</strong>);
    } else {
      const split = token.indexOf('](');
      const label = token.slice(1, split);
      const href = safeHref(token.slice(split + 2, -1));
      if (!href) {
        /* Unsafe or unrecognised scheme: show the label as plain text rather than dropping it.
           The user still reads what was written; it simply is not clickable. */
        out.push(label);
      } else if (href.startsWith('/') && onNavigate) {
        out.push(
          <button
            type="button"
            className="ds-md__link"
            key={`l${key}`}
            onClick={() => onNavigate(href)}
          >
            {label}
          </button>,
        );
      } else {
        out.push(
          <a
            className="ds-md__link"
            key={`l${key}`}
            href={href}
            /* External links open away from an authenticated app; noreferrer denies the
               destination the referring URL, which can carry ids. */
            target={href.startsWith('/') ? undefined : '_blank'}
            rel={href.startsWith('/') ? undefined : 'noopener noreferrer'}
          >
            {label}
          </a>,
        );
      }
    }
    last = match.index + token.length;
    key += 1;
  }

  if (last < text.length) out.push(text.slice(last));
  return out;
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());
}

export function Markdown({ children, onNavigate }: MarkdownProps) {
  const lines = children.split('\n');
  const blocks: JSX.Element[] = [];
  let paragraph: string[] = [];
  let i = 0;

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    blocks.push(
      <p className="ds-md__p" key={`p${blocks.length}`}>
        {renderInline(paragraph.join(' '), onNavigate)}
      </p>,
    );
    paragraph = [];
  };

  while (i < lines.length) {
    const line = lines[i] ?? '';

    if (line.trim() === '') {
      flushParagraph();
      i += 1;
      continue;
    }

    const heading = /^(#{2,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      const level = heading[1]?.length ?? 2;
      const Tag = (level === 2 ? 'h3' : level === 3 ? 'h4' : 'h5') as 'h3' | 'h4' | 'h5';
      blocks.push(
        <Tag className="ds-md__h" key={`h${blocks.length}`}>
          {renderInline(heading[2] ?? '', onNavigate)}
        </Tag>,
      );
      i += 1;
      continue;
    }

    /* Fenced code. An unterminated fence runs to the end rather than swallowing the document
       into a dangling state. */
    if (line.trim().startsWith('```')) {
      flushParagraph();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith('```')) {
        body.push(lines[i] ?? '');
        i += 1;
      }
      i += 1;
      blocks.push(
        <pre className="ds-md__pre" key={`f${blocks.length}`}>
          {body.join('\n')}
        </pre>,
      );
      continue;
    }

    /* Indented block — the corpus writes formulae this way. */
    if (/^ {4}\S/.test(line)) {
      flushParagraph();
      const body: string[] = [];
      while (i < lines.length && (/^ {4}/.test(lines[i] ?? '') || (lines[i] ?? '').trim() === '')) {
        if ((lines[i] ?? '').trim() === '' && !/^ {4}/.test(lines[i + 1] ?? '')) break;
        body.push((lines[i] ?? '').slice(4));
        i += 1;
      }
      blocks.push(
        <pre className="ds-md__pre" key={`i${blocks.length}`}>
          {body.join('\n').trimEnd()}
        </pre>,
      );
      continue;
    }

    /* Table: a header row, a separator of dashes, then body rows. */
    if (line.includes('|') && /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[i + 1] ?? '')) {
      flushParagraph();
      const head = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? '').includes('|')) {
        rows.push(splitRow(lines[i] ?? ''));
        i += 1;
      }
      blocks.push(
        <div className="ds-md__table-wrap" key={`t${blocks.length}`}>
          <table className="ds-md__table">
            <thead>
              <tr>
                {head.map((cell, n) => (
                  <th key={n}>{renderInline(cell, onNavigate)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c}>{renderInline(cell, onNavigate)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      const items: string[] = [];
      while (i < lines.length) {
        const current = lines[i] ?? '';
        const m = ordered ? /^\s*\d+\.\s+(.*)$/.exec(current) : /^\s*[-*]\s+(.*)$/.exec(current);
        if (m) {
          items.push(m[1] ?? '');
          i += 1;
          continue;
        }
        /* A wrapped continuation line belongs to the previous item. */
        if (/^\s{2,}\S/.test(current) && items.length > 0) {
          items[items.length - 1] = `${items[items.length - 1]} ${current.trim()}`;
          i += 1;
          continue;
        }
        break;
      }
      const List = ordered ? 'ol' : 'ul';
      blocks.push(
        <List className="ds-md__list" key={`l${blocks.length}`}>
          {items.map((item, n) => (
            <li key={n}>{renderInline(item, onNavigate)}</li>
          ))}
        </List>,
      );
      continue;
    }

    paragraph.push(line.trim());
    i += 1;
  }

  flushParagraph();
  return <div className="ds-md">{blocks}</div>;
}
