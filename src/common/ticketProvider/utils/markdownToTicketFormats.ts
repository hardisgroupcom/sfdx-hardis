/**
 * Markdown to the formats of the ticketing systems that do not take HTML:
 *
 * - `markdownToAdf`: Atlassian Document Format, the comment body of Jira Cloud (REST API v3)
 * - `markdownToJiraWiki`: wiki markup, the comment body of Jira Server / Data Center (REST API v2)
 * - `markdownToPlainText`: plain text with `label (url)` links, for a ServiceNow journal
 *
 * All three walk the tokens of `marked`, already used for the HTML of Azure Boards and Aha!, so a
 * comment reads the same everywhere. Markdown none of them can express (an image, raw HTML) is
 * kept as text rather than dropped.
 */

import { marked, Token, Tokens } from 'marked';

/** Atlassian Document Format node, loose enough for every node type written here */
export interface AdfNode {
  type: string;
  attrs?: Record<string, any>;
  content?: AdfNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, any> }>;
  version?: number;
}

export function markdownToAdf(markdown: string): AdfNode {
  const content = _adfBlocks(_lex(markdown));
  return { version: 1, type: 'doc', content };
}

export function markdownToJiraWiki(markdown: string): string {
  return _wikiBlocks(_lex(markdown), 0).replace(/\n{3,}/g, '\n\n').trim();
}

export function markdownToPlainText(markdown: string): string {
  return _plainBlocks(_lex(markdown), 0).replace(/\n{3,}/g, '\n\n').trim();
}

/* ------------------------------------------------------------------------------------------ */
/* Shared                                                                                      */
/* ------------------------------------------------------------------------------------------ */

function _lex(markdown: string): Token[] {
  return marked.lexer(String(markdown ?? ''), { gfm: true });
}

/** `marked` leaves entities as typed: `&lt;` must reach Jira and ServiceNow as `<`. */
function _decodeEntities(text: string): string {
  return String(text ?? '')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** Inline tokens of a block token, a tight list item holding them under a `text` token. */
function _inlineTokens(token: any): Token[] {
  if (Array.isArray(token?.tokens)) {
    return token.tokens;
  }
  return token?.text !== undefined ? [{ type: 'text', raw: token.text, text: token.text } as Tokens.Text] : [];
}

/**
 * Join the text and escape tokens that follow each other: `marked` splits `acme\-\-uat` in five
 * tokens, which would become five ADF text nodes and hide the `--` the wiki markup must escape.
 */
function _mergeText(tokens: Token[] | undefined): Token[] {
  const merged: Token[] = [];
  for (const token of (tokens || []) as any[]) {
    const isPlain = (token.type === 'text' && !(Array.isArray(token.tokens) && token.tokens.length > 0)) || token.type === 'escape';
    const previous: any = merged[merged.length - 1];
    if (isPlain && previous?.type === 'text' && previous.merged) {
      previous.text += token.text;
    } else if (isPlain) {
      merged.push({ type: 'text', raw: token.raw, text: token.text, merged: true } as any);
    } else {
      merged.push(token);
    }
  }
  return merged;
}

/* ------------------------------------------------------------------------------------------ */
/* Atlassian Document Format                                                                   */
/* ------------------------------------------------------------------------------------------ */

function _adfBlocks(tokens: Token[]): AdfNode[] {
  const blocks: AdfNode[] = [];
  for (const token of tokens) {
    const node = _adfBlock(token as any);
    if (node) {
      blocks.push(node);
    }
  }
  return blocks;
}

function _adfBlock(token: any): AdfNode | null {
  switch (token.type) {
    case 'space':
    case 'def':
      return null;
    case 'paragraph':
    case 'text':
      return { type: 'paragraph', content: _adfInline(_inlineTokens(token), []) };
    case 'heading':
      return { type: 'heading', attrs: { level: Math.min(Math.max(token.depth, 1), 6) }, content: _adfInline(token.tokens, []) };
    case 'code': {
      const text = String(token.text ?? '');
      const node: AdfNode = { type: 'codeBlock', content: text ? [{ type: 'text', text }] : [] };
      if (token.lang) {
        node.attrs = { language: token.lang };
      }
      return node;
    }
    case 'blockquote':
      return { type: 'blockquote', content: _adfBlocks(token.tokens).filter((node) => node.type === 'paragraph' || node.type.endsWith('List') || node.type === 'codeBlock') };
    case 'hr':
      return { type: 'rule' };
    case 'list':
      return {
        type: token.ordered ? 'orderedList' : 'bulletList',
        ...(token.ordered ? { attrs: { order: Number(token.start) || 1 } } : {}),
        content: token.items.map((item: Tokens.ListItem) => {
          const content = _adfBlocks(item.tokens);
          // A list item must start with a paragraph
          return { type: 'listItem', content: content.length > 0 && content[0].type === 'paragraph' ? content : [{ type: 'paragraph', content: [] }, ...content] };
        }),
      };
    case 'table': {
      const row = (cells: Tokens.TableCell[], cellType: string): AdfNode => ({
        type: 'tableRow',
        content: cells.map((cell) => ({ type: cellType, content: [{ type: 'paragraph', content: _adfInline(cell.tokens, []) }] })),
      });
      return { type: 'table', content: [row(token.header, 'tableHeader'), ...token.rows.map((cells: Tokens.TableCell[]) => row(cells, 'tableCell'))] };
    }
    default: {
      // Raw HTML and anything else: kept as text
      const text = _decodeEntities(String(token.text ?? token.raw ?? '')).trim();
      return text ? { type: 'paragraph', content: [{ type: 'text', text }] } : null;
    }
  }
}

function _adfInline(tokens: Token[] | undefined, marks: AdfNode['marks'] & object): AdfNode[] {
  const nodes: AdfNode[] = [];
  const pushText = (text: string, textMarks: AdfNode['marks'] & object): void => {
    // ADF refuses an empty text node
    if (text) {
      nodes.push(textMarks.length > 0 ? { type: 'text', text, marks: textMarks } : { type: 'text', text });
    }
  };
  for (const token of _mergeText(tokens) as any[]) {
    switch (token.type) {
      case 'strong':
        nodes.push(..._adfInline(token.tokens, [...marks, { type: 'strong' }]));
        break;
      case 'em':
        nodes.push(..._adfInline(token.tokens, [...marks, { type: 'em' }]));
        break;
      case 'del':
        nodes.push(..._adfInline(token.tokens, [...marks, { type: 'strike' }]));
        break;
      case 'link':
        nodes.push(..._adfInline(token.tokens, [...marks.filter((mark) => mark.type !== 'link'), { type: 'link', attrs: { href: token.href } }]));
        break;
      case 'codespan':
        // The code mark only combines with a link
        pushText(_decodeEntities(token.text), [...marks.filter((mark) => mark.type === 'link'), { type: 'code' }]);
        break;
      case 'br':
        nodes.push({ type: 'hardBreak' });
        break;
      case 'image':
        pushText(token.text || token.href, [...marks, { type: 'link', attrs: { href: token.href } }]);
        break;
      case 'text':
        if (Array.isArray(token.tokens) && token.tokens.length > 0) {
          nodes.push(..._adfInline(token.tokens, marks));
        } else {
          pushText(_decodeEntities(token.text).replace(/\n/g, ' '), marks);
        }
        break;
      default:
        pushText(_decodeEntities(token.text ?? token.raw ?? ''), marks);
    }
  }
  return nodes;
}

/* ------------------------------------------------------------------------------------------ */
/* Jira wiki markup                                                                            */
/* ------------------------------------------------------------------------------------------ */

/** Escape what wiki markup would read as formatting. `--` would become a dash. */
function _wikiEscape(text: string): string {
  return _decodeEntities(text)
    .replace(/([\\[\]{}|*_^~+!#])/g, '\\$1')
    .replace(/-(?=-)/g, '\\-');
}

/** A `{code}` or `{noformat}` inside a block would end it early: its brace is escaped. */
function _wikiCodeText(text: string): string {
  return String(text ?? '').replace(/\{(code|noformat)/gi, '\\{$1');
}

function _wikiBlocks(tokens: Token[], listDepth: number, listPrefix = ''): string {
  const parts: string[] = [];
  for (const token of tokens as any[]) {
    switch (token.type) {
      case 'space':
      case 'def':
        break;
      case 'paragraph':
      case 'text':
        parts.push(_wikiInline(_inlineTokens(token)) + (listDepth > 0 ? '\n' : '\n\n'));
        break;
      case 'heading':
        parts.push(`h${Math.min(Math.max(token.depth, 1), 6)}. ${_wikiInline(token.tokens)}\n\n`);
        break;
      case 'code':
        parts.push(`${token.lang ? `{code:${token.lang}}` : '{noformat}'}\n${_wikiCodeText(token.text)}\n${token.lang ? '{code}' : '{noformat}'}\n\n`);
        break;
      case 'blockquote':
        parts.push(`{quote}\n${_wikiBlocks(token.tokens, 0).trim()}\n{quote}\n\n`);
        break;
      case 'hr':
        parts.push('----\n\n');
        break;
      case 'list': {
        const prefix = listPrefix + (token.ordered ? '#' : '*');
        for (const item of token.items as Tokens.ListItem[]) {
          const [first, ...rest] = item.tokens as any[];
          const firstLine = first && (first.type === 'text' || first.type === 'paragraph') ? _wikiInline(_inlineTokens(first)) : '';
          parts.push(`${prefix} ${firstLine}\n`);
          const others = first && (first.type === 'text' || first.type === 'paragraph') ? rest : item.tokens;
          parts.push(_wikiBlocks(others, listDepth + 1, prefix));
        }
        if (listDepth === 0) {
          parts.push('\n');
        }
        break;
      }
      case 'table': {
        parts.push(`||${(token.header as Tokens.TableCell[]).map((cell) => _wikiInline(cell.tokens)).join('||')}||\n`);
        for (const cells of token.rows as Tokens.TableCell[][]) {
          parts.push(`|${cells.map((cell) => _wikiInline(cell.tokens) || ' ').join('|')}|\n`);
        }
        parts.push('\n');
        break;
      }
      default:
        parts.push(_wikiEscape(String(token.text ?? token.raw ?? '')).trim() + '\n\n');
    }
  }
  return parts.join('');
}

function _wikiInline(tokens: Token[] | undefined): string {
  return (_mergeText(tokens) as any[])
    .map((token) => {
      switch (token.type) {
        case 'strong':
          return `*${_wikiInline(token.tokens)}*`;
        case 'em':
          return `_${_wikiInline(token.tokens)}_`;
        case 'del':
          return `-${_wikiInline(token.tokens)}-`;
        case 'link':
          return `[${_wikiInline(token.tokens)}|${token.href}]`;
        case 'image':
          return `[${_wikiEscape(token.text || token.href)}|${token.href}]`;
        case 'codespan':
          // A brace inside would close the monospace span early and turn the rest into markup
          return `{{${_decodeEntities(token.text).replace(/([{}])/g, '\\$1')}}}`;
        case 'br':
          return '\\\\\n';
        case 'text':
          return Array.isArray(token.tokens) && token.tokens.length > 0 ? _wikiInline(token.tokens) : _wikiEscape(token.text);
        default:
          return _wikiEscape(String(token.text ?? token.raw ?? ''));
      }
    })
    .join('');
}

/* ------------------------------------------------------------------------------------------ */
/* Plain text                                                                                  */
/* ------------------------------------------------------------------------------------------ */

function _plainBlocks(tokens: Token[], listDepth: number): string {
  const parts: string[] = [];
  for (const token of tokens as any[]) {
    switch (token.type) {
      case 'space':
      case 'def':
        break;
      case 'paragraph':
      case 'text':
        parts.push(_plainInline(_inlineTokens(token)) + (listDepth > 0 ? '\n' : '\n\n'));
        break;
      case 'heading':
        parts.push(`${_plainInline(token.tokens)}\n\n`);
        break;
      case 'code':
        parts.push(`${token.text}\n\n`);
        break;
      case 'blockquote':
        parts.push(
          _plainBlocks(token.tokens, 0)
            .trim()
            .split('\n')
            .map((line) => `> ${line}`)
            .join('\n') + '\n\n'
        );
        break;
      case 'hr':
        parts.push('----\n\n');
        break;
      case 'list': {
        const indent = '  '.repeat(listDepth);
        (token.items as Tokens.ListItem[]).forEach((item, index) => {
          const bullet = token.ordered ? `${(Number(token.start) || 1) + index}.` : '-';
          const body = _plainBlocks(item.tokens, listDepth + 1).trimEnd();
          parts.push(`${indent}${bullet} ${body.replace(/^\s+/, '')}\n`);
        });
        if (listDepth === 0) {
          parts.push('\n');
        }
        break;
      }
      case 'table': {
        const line = (cells: Tokens.TableCell[]): string => cells.map((cell) => _plainInline(cell.tokens)).join(' | ');
        parts.push([line(token.header), ...token.rows.map(line)].join('\n') + '\n\n');
        break;
      }
      default:
        parts.push(_decodeEntities(String(token.text ?? token.raw ?? '')).trim() + '\n\n');
    }
  }
  return parts.join('');
}

function _plainInline(tokens: Token[] | undefined): string {
  return (_mergeText(tokens) as any[])
    .map((token) => {
      switch (token.type) {
        case 'strong':
        case 'em':
        case 'del':
          return _plainInline(token.tokens);
        case 'link': {
          const label = _plainInline(token.tokens);
          return label && label !== token.href ? `${label} (${token.href})` : token.href;
        }
        case 'image':
          return token.text ? `${_decodeEntities(token.text)} (${token.href})` : token.href;
        case 'br':
          return '\n';
        case 'text':
          return Array.isArray(token.tokens) && token.tokens.length > 0 ? _plainInline(token.tokens) : _decodeEntities(token.text);
        default:
          return _decodeEntities(String(token.text ?? token.raw ?? ''));
      }
    })
    .join('');
}
