// Formula rendering is optional: stored abstracts remain exactly as supplied.
const DELIMITERS = [["$$", "$$"], ["\\(", "\\)"], ["\\[", "\\]"], ["$", "$"]];
let mathJaxReady;

function escapedAt(source, index) {
  let backslashes = 0;
  while (index > 0 && source[--index] === "\\") backslashes += 1;
  return backslashes % 2 === 1;
}

function closingDelimiter(source, delimiter, start) {
  let index = source.indexOf(delimiter, start);
  while (index !== -1 && escapedAt(source, index)) {
    index = source.indexOf(delimiter, index + delimiter.length);
  }
  return index;
}

function bareBoldEnd(source, index) {
  if (escapedAt(source, index) || !source.startsWith("\\bm", index)) return null;
  const command = source.slice(index).match(/^\\bm\s*\{/);
  if (!command) return null;
  let depth = 1;
  let end = index + command[0].length;
  while (end < source.length && depth > 0) {
    if (!escapedAt(source, end)) {
      if (source[end] === "{") depth += 1;
      if (source[end] === "}") depth -= 1;
    }
    end += 1;
  }
  return depth === 0 ? end : null;
}

// Announcement line breaks separate paragraphs; line breaks inside a complete
// TeX expression belong to the formula. The stored source is never modified.
export function abstractParagraphs(source) {
  const paragraphs = [];
  let start = 0;
  let index = 0;
  while (index < source.length) {
    const delimiter = !escapedAt(source, index) && DELIMITERS.find(([open]) => source.startsWith(open, index));
    if (delimiter) {
      const [open, close] = delimiter;
      const end = closingDelimiter(source, close, index + open.length);
      if (end !== -1) {
        index = end + close.length;
        continue;
      }
    }
    const boldEnd = bareBoldEnd(source, index);
    if (boldEnd !== null) {
      index = boldEnd;
      continue;
    }
    if (/[\r\n\u2028\u2029]/.test(source[index])) {
      const paragraph = source.slice(start, index).trim();
      if (paragraph) paragraphs.push(paragraph);
      index += source[index] === "\r" && source[index + 1] === "\n" ? 2 : 1;
      start = index;
    } else index += 1;
  }
  const last = source.slice(start).trim();
  if (last) paragraphs.push(last);
  return paragraphs;
}

export async function renderAbstract(container, source) {
  if (!container.isConnected) return;
  const paragraphs = abstractParagraphs(source).map(text => {
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    return paragraph;
  });
  container.replaceChildren(...paragraphs);
  for (const paragraph of paragraphs) await renderAbstractMath(paragraph, paragraph.textContent);
}

// Some historical emails contain bare \bm{...} instead of $\bm{...}$.
// Wrap only balanced commands outside existing math; never edit the source data.
export function prepareAbstractMath(source) {
  let text = "";
  let hasMath = false;
  let index = 0;
  while (index < source.length) {
    const delimiter = !escapedAt(source, index) && DELIMITERS.find(([open]) => source.startsWith(open, index));
    if (delimiter) {
      const [open, close] = delimiter;
      const end = closingDelimiter(source, close, index + open.length);
      if (end !== -1) {
        text += source.slice(index, end + close.length);
        index = end + close.length;
        hasMath = true;
        continue;
      }
    }
    const boldEnd = bareBoldEnd(source, index);
    if (boldEnd !== null) {
      text += `\\(${source.slice(index, boldEnd)}\\)`;
      index = boldEnd;
      hasMath = true;
      continue;
    }
    text += source[index++];
  }
  return { text, hasMath };
}

function loadMathJax() {
  if (!mathJaxReady) {
    mathJaxReady = new Promise((resolve, reject) => {
      window.MathJax = {
        loader: { load: ["[tex]/boldsymbol", "ui/safe"] },
        startup: { typeset: false },
        tex: {
          inlineMath: [["$", "$"], ["\\(", "\\)"]],
          displayMath: [["$$", "$$"], ["\\[", "\\]"]],
          processEscapes: true,
          processEnvironments: false,
          packages: ["base", "ams", "boldsymbol", "newcommand", "noundefined", "configmacros"],
          macros: { bm: ["\\boldsymbol{#1}", 1] }
        },
        svg: { fontCache: "local" },
        options: {
          enableMenu: false,
          safeOptions: { allow: { URLs: "none", classes: "none", cssIDs: "none", styles: "none" } }
        }
      };
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-svg.js";
      script.async = true;
      script.onload = () => {
        const ready = window.MathJax?.startup?.promise;
        if (!ready) reject(new Error("Math renderer did not initialize"));
        else ready.then(() => resolve(window.MathJax), reject);
      };
      script.onerror = () => reject(new Error("Math renderer could not be loaded"));
      document.head.append(script);
    });
  }
  return mathJaxReady;
}

export async function renderAbstractMath(paragraph, source) {
  const prepared = prepareAbstractMath(source);
  if (!prepared.hasMath) return;
  try {
    const mathJax = await loadMathJax();
    if (!paragraph.isConnected) return;
    paragraph.textContent = prepared.text;
    await mathJax.typesetPromise([paragraph]);
  } catch (error) {
    window.MathJax?.typesetClear?.([paragraph]);
    paragraph.textContent = source;
    console.warn("Formula rendering is unavailable; showing the original abstract.", error);
  }
}
