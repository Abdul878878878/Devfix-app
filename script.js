const codeInput = document.getElementById("codeInput");
const errorInput = document.getElementById("errorInput");
const analyzeBtn = document.getElementById("analyzeBtn");
const clearBtn = document.getElementById("clearBtn");
const sampleBtn = document.getElementById("sampleBtn");
const lineNumbers = document.getElementById("lineNumbers");
const lineCount = document.getElementById("lineCount");
const emptyState = document.getElementById("emptyState");
const results = document.getElementById("results");
const issueList = document.getElementById("issueList");
const issueCount = document.getElementById("issueCount");
const cleanMessage = document.getElementById("cleanMessage");
const resultStatus = document.getElementById("resultStatus");

function updateEditorMeta() {
  const lines = codeInput.value.split("\n").length;
  lineNumbers.textContent = Array.from({ length: lines }, (_, i) => i + 1).join("\n");
  lineCount.textContent = `${lines} line${lines === 1 ? "" : "s"}`;
}
codeInput.addEventListener("input", updateEditorMeta);
codeInput.addEventListener("scroll", () => {
  lineNumbers.scrollTop = codeInput.scrollTop;
});

function addIssue(list, severity, title, description, fix, line = null) {
  list.push({ severity, title, description, fix, line });
}

function lineOf(code, index) {
  return code.slice(0, index).split("\n").length;
}

function analyzeCode(code, errorText) {
  const issues = [];
  const trimmed = code.trim();

  if (!trimmed && !errorText.trim()) {
    addIssue(issues, "info", "Nothing to analyse",
      "Paste JavaScript code or an error message to begin.",
      "Add your code in the editor, or paste the exact console error.");
    return issues;
  }

  if (code) {
    const patterns = [
      {
        regex: /\bconsole\.log\s*=\s*/g,
        title: "console.log is being overwritten",
        description: "This assignment replaces the console.log function instead of calling it.",
        fix: "Use console.log(value) to print a value. Remove the assignment unless you intentionally want to replace the function."
      },
      {
        regex: /\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*\1\b/g,
        title: "Variable refers to itself during initialization",
        description: "The variable appears to use its own value before it has been initialized.",
        fix: "Check the right-hand side. Assign a valid existing value or initialize the variable with a literal or expression."
      },
      {
        regex: /\bconst\s+([A-Za-z_$][\w$]*)\s*(?:;|\n|$)/g,
        title: "Constant declared without a value",
        description: "A const declaration must be initialized when it is declared.",
        fix: "Assign a value immediately, for example: const total = 0;"
      },
      {
        regex: /(^|[^=!<>])=(?!=|>)/g,
        title: "Check assignment versus comparison",
        description: "A single equals sign assigns a value. In a condition, you may have intended a comparison.",
        fix: "If you meant equality, use === (strict equality) or another appropriate comparison operator. Review this occurrence before changing it.",
        severity: "warning",
        onlyInCondition: true
      },
      {
        regex: /\bdebugger\s*;/g,
        title: "Debugger statement found",
        description: "A debugger statement pauses execution when developer tools are open.",
        fix: "Remove debugger; before deploying if the pause is not intentional.",
        severity: "info"
      },
      {
        regex: /==\s*(?:null|undefined)|(?:null|undefined)\s*==/g,
        title: "Loose equality check",
        description: "Loose equality can perform type coercion and may make conditions harder to reason about.",
        fix: "Consider === for an explicit type-safe comparison, or use value == null only when you intentionally want to match both null and undefined.",
        severity: "info"
      },
      {
        regex: /\b(?:let|const|var)\s+([A-Za-z_$][\w$]*)[\s\S]*?\b(?:let|const|var)\s+\1\b/g,
        title: "Possible repeated variable declaration",
        description: "The same variable name appears to be declared more than once in this scope.",
        fix: "Check the declarations and use the existing variable, or choose a different name. This pattern check can also match separate scopes."
      }
    ];

    patterns.forEach(pattern => {
      let match;
      while ((match = pattern.regex.exec(code)) !== null) {
        if (pattern.onlyInCondition) {
          const before = code.slice(0, match.index);
          const lastOpen = Math.max(before.lastIndexOf("("), before.lastIndexOf("{"), before.lastIndexOf(";"));
          const context = before.slice(lastOpen);
          if (!/\b(if|while|for)\s*\([^)]*$/.test(context)) continue;
        }
        addIssue(issues, pattern.severity || "warning", pattern.title,
          pattern.description, pattern.fix, lineOf(code, match.index));
        if (issues.length > 30) break;
      }
    });

    const openers = ["(", "{", "["];
    const closers = [")", "}", "]"];
    const stack = [];
    let quote = null;
    let escaped = false;
    let inLineComment = false;
    let inBlockComment = false;
    for (let i = 0; i < code.length; i++) {
      const ch = code[i], next = code[i + 1];
      if (inLineComment) { if (ch === "\n") inLineComment = false; continue; }
      if (inBlockComment) { if (ch === "*" && next === "/") { inBlockComment = false; i++; } continue; }
      if (quote) {
        if (escaped) { escaped = false; continue; }
        if (ch === "\\") { escaped = true; continue; }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === "/" && next === "/") { inLineComment = true; i++; continue; }
      if (ch === "/" && next === "*") { inBlockComment = true; i++; continue; }
      if (ch === "'" || ch === '"' || ch === "`") { quote = ch; continue; }
      if (openers.includes(ch)) stack.push({ ch, index: i });
      if (closers.includes(ch)) {
        const expected = openers[closers.indexOf(ch)];
        if (!stack.length || stack[stack.length - 1].ch !== expected) {
          addIssue(issues, "error", "Mismatched or unexpected bracket",
            `The closing "${ch}" does not match the most recent opening bracket.`,
            "Check the surrounding parentheses, braces and square brackets.", lineOf(code, i));
          break;
        }
        stack.pop();
      }
    }
    if (stack.length) {
      const last = stack[stack.length - 1];
      addIssue(issues, "error", "Possible unclosed bracket",
        `The opening "${last.ch}" does not appear to have a matching closing bracket.`,
        "Add the correct closing bracket and check the structure of the surrounding block.", lineOf(code, last.index));
    }
    if (quote) {
      addIssue(issues, "error", "Possible unclosed string",
        `A string opened with ${quote} does not appear to close.`,
        "Check the string's ending quote and any escaped quote characters.");
    }

    const asyncWithoutAwait = /\basync\s+function\b|\basync\s*\([^)]*\)\s*=>/;
    if (asyncWithoutAwait.test(code) && !/\bawait\b/.test(code)) {
      addIssue(issues, "info", "Async function without await",
        "An async function was found, but no await keyword appears in this code.",
        "If the function does not need asynchronous work, consider removing async. Otherwise check whether an awaited operation is missing.");
    }
  }

  if (errorText.trim()) {
    const e = errorText.toLowerCase();
    const errorRules = [
      [/is not defined|referenceerror/, "ReferenceError: variable is not defined",
        "JavaScript cannot find the variable or function name being referenced.",
        "Check spelling, declaration, scope and whether the script that defines it loaded first."],
      [/is not a function|typeerror.*function/, "TypeError: value is not a function",
        "Your code is trying to call a value that JavaScript does not recognise as a function.",
        "Check the value's type, spelling, imports and whether the function exists on that object."],
      [/cannot read propert|cannot read properties|undefined.*reading|null.*reading/, "TypeError: reading a property from null or undefined",
        "The value before the property access may be null or undefined.",
        "Check where the value comes from. Validate it before accessing the property, and inspect asynchronous data loading."],
      [/unexpected token|syntaxerror/, "SyntaxError: invalid JavaScript syntax",
        "The JavaScript parser found code it could not understand.",
        "Inspect the reported line and the line before it for missing commas, brackets, quotes or invalid syntax."],
      [/failed to fetch|networkerror|load failed/, "Network request failed",
        "The browser could not complete a network request.",
        "Check your internet connection, request URL, server status, CORS settings and the browser Network tab."],
      [/404|not found/, "Resource not found (404)",
        "The requested page, file or API endpoint could not be found.",
        "Verify the URL, file path, route and server configuration."],
      [/cors|cross-origin/, "Possible CORS restriction",
        "The browser may be blocking a request because of cross-origin policy.",
        "Configure the API server to return the appropriate Access-Control-Allow-Origin header. Do not try to fix server CORS by disabling browser security."]
    ];
    let matched = false;
    for (const [regex, title, description, fix] of errorRules) {
      if (regex.test(e)) {
        addIssue(issues, "error", title, description, fix);
        matched = true;
        break;
      }
    }
    if (!matched) {
      addIssue(issues, "info", "Error message received",
        "DevFix did not recognise this exact error pattern, but the message may still contain useful clues.",
        "Read the full message, note the file and line number, then inspect the stack trace. Search the exact error text if needed.");
    }
  }
  return issues;
}

function renderResults(issues) {
  emptyState.classList.add("hidden");
  results.classList.remove("hidden");
  issueList.innerHTML = "";
  issueCount.textContent = issues.length;
  cleanMessage.classList.toggle("hidden", issues.length !== 0);
  resultStatus.textContent = issues.some(i => i.severity === "error") ? "Review required" :
    issues.length ? "Suggestions available" : "No matches";

  issues.forEach(issue => {
    const card = document.createElement("article");
    card.className = "issue-card";
    const top = document.createElement("div");
    top.className = "issue-top";
    const badge = document.createElement("span");
    badge.className = `severity ${issue.severity}`;
    badge.textContent = issue.severity.toUpperCase();
    const title = document.createElement("span");
    title.className = "issue-title";
    title.textContent = issue.title;
    const line = document.createElement("span");
    line.className = "issue-line";
    line.textContent = issue.line ? `Line ${issue.line}` : "Error input";
    top.append(badge, title, line);
    const description = document.createElement("p");
    description.textContent = issue.description;
    const fixLabel = document.createElement("div");
    fixLabel.className = "fix-label";
    fixLabel.textContent = "SUGGESTED NEXT STEP";
    const fix = document.createElement("div");
    fix.className = "fix-text";
    fix.textContent = issue.fix;
    card.append(top, description, fixLabel, fix);
    issueList.appendChild(card);
  });
}

analyzeBtn.addEventListener("click", () => {
  const code = codeInput.value;
  const error = errorInput.value;
  if (!code.trim() && !error.trim()) {
    codeInput.focus();
    renderResults(analyzeCode(code, error));
    return;
  }
  analyzeBtn.disabled = true;
  analyzeBtn.textContent = "Analysing...";
  window.setTimeout(() => {
    renderResults(analyzeCode(code, error));
    analyzeBtn.disabled = false;
    analyzeBtn.innerHTML = "<span>✦</span> Analyse code";
  }, 250);
});

clearBtn.addEventListener("click", () => {
  codeInput.value = "";
  errorInput.value = "";
  updateEditorMeta();
  results.classList.add("hidden");
  emptyState.classList.remove("hidden");
  codeInput.focus();
});

sampleBtn.addEventListener("click", () => {
  codeInput.value = `function welcomeUser(name) {
  console.log = "Welcome";
  if (name = "Alex") {
    console.log("Hello " + name;
  }
}

welcomeUser();`;
  errorInput.value = "ReferenceError: userName is not defined";
  updateEditorMeta();
  codeInput.focus();
});

updateEditorMeta();
