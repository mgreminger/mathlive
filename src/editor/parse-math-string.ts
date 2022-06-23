import { OutputFormat } from '../public/mathfield';
import { InlineShortcutDefinition, getInlineShortcut } from './shortcuts';
import { INLINE_SHORTCUTS } from './shortcuts-definitions';

/**
 * Attempts to parse and interpret a string in an unknown format, possibly
 * ASCIIMath and return a canonical LaTeX string.
 *
 * The format recognized are one of these variations:
 * - ASCIIMath: Only supports a subset
 * (1/2x)
 * 1/2sin x                     -> \frac {1}{2}\sin x
 * 1/2sinx                      -> \frac {1}{2}\sin x
 * (1/2sin x (x^(2+1))          // Unbalanced parentheses
 * (1/2sin(x^(2+1))             -> \left(\frac {1}{2}\sin \left(x^{2+1}\right)\right)
 * alpha + (pi)/(4)             -> \alpha +\frac {\pi }{4}
 * x=(-b +- sqrt(b^2 – 4ac))/(2a)
 * alpha/beta
 * sqrt2 + sqrtx + sqrt(1+a) + sqrt(1/2)
 * f(x) = x^2 "when" x >= 0
 * AA n in QQ
 * AA x in RR "," |x| > 0
 * AA x in RR "," abs(x) > 0
 *
 * - UnicodeMath (generated by Microsoft Word): also only supports a subset
 *      - See https://www.unicode.org/notes/tn28/UTN28-PlainTextMath-v3.1.pdf
 * √(3&x+1)
 * {a+b/c}
 * [a+b/c]
 * _a^b x
 * lim_(n->\infty) n
 * \iint_(a=0)^\infty  a
 *
 * - "JavaScript Latex": a variant that is LaTeX, but with escaped backslashes
 *  \\frac{1}{2} \\sin x
 */
export function parseMathString(
  s: string,
  options?: {
    format?: 'auto' | OutputFormat;
    inlineShortcuts?: Record<string, InlineShortcutDefinition>;
  }
): [OutputFormat, string] {
  let format: OutputFormat | undefined;
  [format, s] = inferFormat(s);

  if (format === 'ascii-math') {
    s = s.replace(/\u2061/gu, ''); // Remove function application
    s = s.replace(/\u3016/gu, '{'); // WHITE LENTICULAR BRACKET (grouping)
    s = s.replace(/\u3017/gu, '}'); // WHITE LENTICULAR BRACKET (grouping)

    s = s.replace(/([^\\])sinx/g, '$1\\sin x'); // Common typo
    s = s.replace(/([^\\])cosx/g, '$1\\cos x '); // Common typo
    s = s.replace(/\u2013/g, '-'); // EN-DASH, sometimes used as a minus sign

    return [
      format,
      parseMathExpression(s, { inlineShortcuts: options?.inlineShortcuts }),
    ];
  }

  return ['latex', s];
}

function parseMathExpression(
  s: string,
  options: {
    inlineShortcuts?: Record<string, InlineShortcutDefinition>;
  }
): string {
  if (!s) return '';
  let done = false;
  let m;

  const inlineShortcuts = options.inlineShortcuts ?? INLINE_SHORTCUTS;

  if (!done && (s.startsWith('^') || s.startsWith('_'))) {
    // Superscript and subscript
    m = parseMathArgument(s.slice(1), { inlineShortcuts, noWrap: true });
    s = s[0] + '{' + m.match + '}';
    s += parseMathExpression(m.rest, options);
    done = true;
  }

  if (!done) {
    m = s.match(/^(sqrt|\u221A)(.*)/);
    if (m) {
      // Square root
      m = parseMathArgument(m[2], { inlineShortcuts, noWrap: true });
      const sqrtArgument = m.match ?? '\\placeholder{}';
      s = '\\sqrt{' + sqrtArgument + '}';
      s += parseMathExpression(m.rest, options);
      done = true;
    }
  }

  if (!done) {
    m = s.match(/^(\\cbrt|\u221B)(.*)/);
    if (m) {
      // Cube root
      m = parseMathArgument(m[2], { inlineShortcuts, noWrap: true });
      const sqrtArgument = m.match ?? '\\placeholder{}';
      s = '\\sqrt[3]{' + sqrtArgument + '}';
      s += parseMathExpression(m.rest, options);
      done = true;
    }
  }

  if (!done) {
    m = s.match(/^abs(.*)/);
    if (m) {
      // Absolute value
      m = parseMathArgument(m[1], { inlineShortcuts, noWrap: true });
      s = '\\left|' + m.match + '\\right|';
      s += parseMathExpression(m.rest, options);
      done = true;
    }
  }

  if (!done) {
    m = s.match(/^["”“](.*?)["”“](.*)/);
    if (m) {
      // Quoted text
      s = '\\text{' + m[1] + '}';
      s += parseMathExpression(m[2], options);
      done = true;
    }
  }

  if (!done) {
    m = s.match(/^([^a-zA-Z\(\{\[\_\^\\\s"]+)(.*)/);
    // A string of symbols...
    // Could be a binary or relational operator, etc...
    if (m) {
      s = paddedShortcut(m[1], inlineShortcuts);
      s += parseMathExpression(m[2], options);
      done = true;
    }
  }

  if (!done && /^([fgh])[^a-zA-Z]/.test(s)) {
    // This could be a function...
    m = parseMathArgument(s.slice(1), { inlineShortcuts, noWrap: true });
    s = s[1] === '(' ? s[0] + '\\left(' + m.match + '\\right)' : s[0] + m.match;
    s += parseMathExpression(m.rest, options);
    done = true;
  }

  if (!done) {
    m = s.match(/^([a-zA-Z]+)(.*)/);
    if (m) {
      // Some alphabetical string...
      // Could be a function name (sin) or symbol name (alpha)
      s = paddedShortcut(m[1], inlineShortcuts);
      s += parseMathExpression(m[2], options);
      done = true;
    }
  }

  if (!done) {
    m = parseMathArgument(s, { inlineShortcuts, noWrap: true });
    if (m.match && m.rest[0] === '/') {
      // Fraction
      const m2 = parseMathArgument(m.rest.slice(1), {
        inlineShortcuts,
        noWrap: true,
      });
      if (m2.match) {
        s =
          '\\frac{' +
          m.match +
          '}{' +
          m2.match +
          '}' +
          parseMathExpression(m2.rest, options);
      }

      done = true;
    } else if (m.match) {
      s = s.startsWith('(')
        ? '\\left(' +
          m.match +
          '\\right)' +
          parseMathExpression(m.rest, options)
        : m.match + parseMathExpression(m.rest, options);
      done = true;
    }
  }

  if (!done) {
    m = s.match(/^(\s+)(.*)$/);
    // Whitespace
    if (m) {
      s = ' ' + parseMathExpression(m[2], options);
      done = true;
    }
  }

  return s;
}

/**
 * Parse a math argument, as defined by ASCIIMath and UnicodeMath:
 * - Either an expression fenced in (), {} or []
 * - a number (- sign, digits, decimal point, digits)
 * - a single [a-zA-Z] letter (an identifier)
 * - a multi-letter shortcut (e.g., pi)
 * - a LaTeX command (\pi) (for UnicodeMath)
 * @return
 * - match: the parsed (and converted) portion of the string that is an argument
 * - rest: the raw, unconverted, rest of the string
 */
function parseMathArgument(
  s: string,
  options: {
    noWrap?: boolean;
    inlineShortcuts?: Record<string, InlineShortcutDefinition>;
  }
): { match: string; rest: string } {
  let match = '';
  s = s.trim();
  let rest = s;
  let lFence = s.charAt(0);
  let rFence = { '(': ')', '{': '}', '[': ']' }[lFence];
  if (rFence) {
    // It's a fence
    let level = 1;
    let i = 1;
    while (i < s.length && level > 0) {
      if (s[i] === lFence) level++;
      if (s[i] === rFence) level--;
      i++;
    }

    if (level === 0) {
      // We've found the matching closing fence
      if (options.noWrap && lFence === '(')
        match = parseMathExpression(s.substring(1, i - 1), options);
      else {
        if (lFence === '{' && rFence === '}') {
          lFence = '\\{';
          rFence = '\\}';
        }

        match =
          '\\left' +
          lFence +
          parseMathExpression(s.substring(1, i - 1), options) +
          '\\right' +
          rFence;
      }

      rest = s.slice(Math.max(0, i));
    } else {
      // Unbalanced fence...
      match = s.substring(1, i);
      rest = '';
    }
  } else {
    let m = s.match(/^([a-zA-Z]+)/);
    if (m) {
      // It's a string of letter, maybe a shortcut
      let shortcut = getInlineShortcut(null, s, options.inlineShortcuts);
      if (shortcut) {
        shortcut = shortcut.replace('_{#?}', '');
        shortcut = shortcut.replace('^{#?}', '');
        return { match: shortcut, rest: s.slice(shortcut.length) };
      }
    }

    m = s.match(/^([a-zA-Z])/);
    if (m) {
      // It's a single letter
      return { match: m[1], rest: s.slice(1) };
    }

    m = s.match(/^(-)?\d+(\.\d*)?/);
    if (m) {
      // It's a number
      return { match: m[0], rest: s.slice(m[0].length) };
    }

    if (!/^\\(left|right)/.test(s)) {
      // It's a LaTeX command (but not a \left\right)
      m = s.match(/^(\\[a-zA-Z]+)/);
      if (m) {
        rest = s.slice(m[1].length);
        match = m[1];
      }
    }
  }

  return { match, rest };
}

function paddedShortcut(
  s: string,
  shortcuts?: Record<string, InlineShortcutDefinition>
): string {
  let result = getInlineShortcut(null, s, shortcuts);
  if (result) {
    result = result.replace('_{#?}', '');
    result = result.replace('^{#?}', '');
    result += ' ';
  } else result = s;

  return result;
}

export const MODE_SHIFT_COMMANDS = [
  ['\\[', '\\]'],
  ['\\(', '\\)'],
  ['$$', '$$'],
  ['$', '$'], // Must be *after* $$..$$
  ['\\begin{math}', '\\end{math}'],
  ['\\begin{displaymath}', '\\end{displaymath}'],
  ['\\begin{equation}', '\\end{equation}'],
  ['\\begin{equation*}', '\\end{equation*}'],
];

export function trimModeShiftCommand(s: string): [boolean, string] {
  const trimedString = s.trim();

  for (const mode of MODE_SHIFT_COMMANDS) {
    if (trimedString.startsWith(mode[0]) && trimedString.endsWith(mode[1])) {
      return [
        true,
        trimedString.substring(
          mode[0].length,
          trimedString.length - mode[1].length
        ),
      ];
    }
  }

  return [false, s];
}

function inferFormat(s: string): [OutputFormat | undefined, string] {
  s = s.trim();

  // Assume Latex if a single char
  if (s.length <= 1) return ['latex', s];

  // This is not explicitly ASCIIMath. Try to infer if this is LaTex...
  let hasLatexModeShiftCommand: boolean;
  [hasLatexModeShiftCommand, s] = trimModeShiftCommand(s);
  if (hasLatexModeShiftCommand) return ['latex', s];

  // The backtick is the default delimiter used by MathJAX for
  // ASCII Math
  if (s.startsWith('`') && s.endsWith('`')) {
    s = s.substring(1, s.length - 1);
    return ['ascii-math', s];
  }

  if (s.includes('\\')) {
    // If the string includes a '\' it's probably a LaTeX string
    // (that's not completely true, it could be a UnicodeMath string, since
    // UnicodeMath supports some LaTeX commands. However, we need to pick
    // one in order to correctly interpret {} (which are argument delimiters
    // in LaTeX, and are fences in UnicodeMath)
    return ['latex', s];
  }

  if (/\$.+\$/.test(s)) {
    // If there's a pair of $ (or possibly $$) signs, assume it's a string
    // such as `if $x<0$ then`, in which case it's Latex, but with some text
    // around it
    return ['latex', `\\text{${s}}`];
  }

  return [undefined, s];
}
