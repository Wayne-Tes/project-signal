import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Markdown } from '../src/features/help/Markdown';

/**
 * The markdown renderer.
 *
 * The SECURITY tests here are the reason this component was written by hand rather than pulled
 * from a library. Every markdown library renders to an HTML string, which means
 * `dangerouslySetInnerHTML`, which puts a sanitiser between model output and script execution in
 * an authenticated page. This renderer emits React elements, so text can never become markup —
 * but the one place a string still reaches the DOM as a live capability is an `href`, and that
 * is what these tests guard.
 *
 * It renders assistant answers, and an assistant answer can quote a hostile signal. This is a
 * real path, not a theoretical one.
 */

describe('Markdown — link safety', () => {
  it('refuses to make a javascript: URL clickable', () => {
    const { container } = render(<Markdown>{'[Click me](javascript:alert(1))'}</Markdown>);
    /* The label survives — dropping it would lose content — but it is inert. Asserted on
       textContent rather than as a single node: the payload's own bracket ends the link token
       early, so the label and the stray ")" are separate text nodes. That split is harmless,
       and the property under test is that nothing became clickable. */
    expect(container.textContent).toContain('Click me');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain('javascript:');
  });

  it('refuses a data: URL', () => {
    render(<Markdown>{'[x](data:text/html;base64,PHNjcmlwdD4=)'}</Markdown>);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('is not fooled by leading whitespace or mixed case', () => {
    render(<Markdown>{'[a](  JaVaScRiPt:alert(1))'}</Markdown>);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('allows a plain https link and opens it safely', () => {
    render(<Markdown>{'[Source](https://example.com/a)'}</Markdown>);
    const link = screen.getByRole('link', { name: 'Source' });
    expect(link).toHaveAttribute('href', 'https://example.com/a');
    /* An external link from an authenticated app must not hand the destination the referring
       URL, which can carry identifiers. */
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('never injects raw HTML from the source text', () => {
    const { container } = render(<Markdown>{'<img src=x onerror=alert(1)> and <b>bold</b>'}</Markdown>);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    /* Shown literally, which is the correct failure: visible, harmless, and obviously wrong to
       whoever wrote it. */
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('Markdown — in-app links', () => {
  it('routes a /help/ link through the callback instead of navigating', async () => {
    const onNavigate = vi.fn();
    render(<Markdown onNavigate={onNavigate}>{'See [recency](/help/how-recency-works).'}</Markdown>);
    await userEvent.click(screen.getByRole('button', { name: 'recency' }));
    expect(onNavigate).toHaveBeenCalledWith('/help/how-recency-works');
  });

  it('falls back to a real anchor when no callback is supplied', () => {
    render(<Markdown>{'[recency](/help/how-recency-works)'}</Markdown>);
    expect(screen.getByRole('link', { name: 'recency' })).toHaveAttribute(
      'href',
      '/help/how-recency-works',
    );
  });
});

describe('Markdown — block rendering', () => {
  it('renders headings at h3 and below, never h1', () => {
    /* The article title supplies the h1. A second one breaks the document outline for anyone
       navigating by heading. */
    render(<Markdown>{'## Section\n\nBody text.'}</Markdown>);
    expect(screen.getByRole('heading', { level: 3, name: 'Section' })).toBeInTheDocument();
  });

  it('renders a table with its header row', () => {
    render(
      <Markdown>{'| Range | Reading |\n| --- | --- |\n| 70-100 | Strong |\n| 0-30 | Weak |'}</Markdown>,
    );
    expect(screen.getByRole('columnheader', { name: 'Range' })).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(3);
  });

  it('renders bullet and numbered lists', () => {
    const { container } = render(<Markdown>{'- one\n- two\n\n1. first\n2. second'}</Markdown>);
    expect(container.querySelectorAll('ul li')).toHaveLength(2);
    expect(container.querySelectorAll('ol li')).toHaveLength(2);
  });

  it('joins a wrapped list continuation onto its item', () => {
    /* The corpus wraps at 100 columns, so nearly every long bullet is continued on the next
       line. Treating the continuation as a new item silently mangles the content. */
    const { container } = render(<Markdown>{'- first part\n  continued here\n- second'}</Markdown>);
    const items = container.querySelectorAll('ul li');
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toBe('first part continued here');
  });

  it('renders an indented block as preformatted, for the formulae in the corpus', () => {
    const { container } = render(<Markdown>{'Text:\n\n    weight = recency × confidence\n'}</Markdown>);
    expect(container.querySelector('pre')?.textContent).toBe('weight = recency × confidence');
  });

  it('renders a fenced code block', () => {
    const { container } = render(<Markdown>{'```\nline one\nline two\n```'}</Markdown>);
    expect(container.querySelector('pre')?.textContent).toBe('line one\nline two');
  });

  it('does not swallow the document on an unterminated fence', () => {
    const { container } = render(<Markdown>{'```\nstuck'}</Markdown>);
    expect(container.querySelector('pre')?.textContent).toBe('stuck');
  });

  it('joins wrapped paragraph lines with a space rather than concatenating them', () => {
    const { container } = render(<Markdown>{'The index is a\nsingle number.'}</Markdown>);
    expect(container.querySelector('p')?.textContent).toBe('The index is a single number.');
  });
});

describe('Markdown — inline formatting', () => {
  it('renders bold and inline code', () => {
    const { container } = render(<Markdown>{'This is **bold** and `code`.'}</Markdown>);
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.querySelector('code')?.textContent).toBe('code');
  });

  it('renders italic, which the assistant writes unprompted', () => {
    /* REGRESSION. The assistant answered "...shows *no* index, which means unscored, not zero"
       and the asterisks rendered literally, which reads to a user as a formatting bug in the
       answer rather than a gap in the renderer. */
    const { container } = render(<Markdown>{'shows *no* index'}</Markdown>);
    expect(container.querySelector('em')?.textContent).toBe('no');
  });

  it('does not mistake bold for two italics', () => {
    /* Alternation order: bold must be tried before italic, or **x** is consumed as a stray
       '*' plus an italic '*x*' and the markup comes out inside-out. */
    const { container } = render(<Markdown>{'**strong**'}</Markdown>);
    expect(container.querySelector('strong')?.textContent).toBe('strong');
    expect(container.querySelector('em')).toBeNull();
  });

  it('leaves a lone asterisk alone', () => {
    const { container } = render(<Markdown>{'2 * 3 = 6'}</Markdown>);
    expect(container.querySelector('em')).toBeNull();
    expect(container.textContent).toBe('2 * 3 = 6');
  });

  it('does not open a bold tag inside a code span', () => {
    /* Ordering in the tokeniser: code wins. Otherwise `a ** b` inside backticks renders half a
       <strong> and the rest of the paragraph inherits it. */
    const { container } = render(<Markdown>{'`a ** b`'}</Markdown>);
    expect(container.querySelector('strong')).toBeNull();
    expect(container.querySelector('code')?.textContent).toBe('a ** b');
  });

  it('renders an empty string without throwing', () => {
    expect(() => render(<Markdown>{''}</Markdown>)).not.toThrow();
  });
});
