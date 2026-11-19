export interface AnalysisIssue {
  line: number;
  severity: "error" | "warning";
  code: string;
  message: string;
}

export class LuauAnalyzer {
  analyze(source: string): AnalysisIssue[] {
    const issues: AnalysisIssue[] = [];
    const lines = source.split(/\r?\n/);
    lines.forEach((line, index) => {
      const number = index + 1;
      if (/game\s*:\s*GetService\s*\(\s*["']MarketplaceService["']/.test(line)) {
        issues.push({ line: number, severity: "warning", code: "MONETIZATION", message: "Verify ProcessReceipt and server-side purchase validation" });
      }
      if (/RemoteEvent/.test(line) && !/OnServerEvent/.test(line)) {
        issues.push({ line: number, severity: "warning", code: "REMOTE", message: "Inspect RemoteEvent handling for server-side validation" });
      }
      if (/while\s+true\s+do/.test(line)) {
        issues.push({ line: number, severity: "warning", code: "LOOP", message: "Use bounded loops or task.wait with a clear shutdown condition" });
      }
      if (/DataStore[A-Za-z]*:/.test(line)) {
        issues.push({ line: number, severity: "warning", code: "DATASTORE", message: "Review retry, cancellation, and partial-failure handling" });
      }
      if (/^\s*--\s*TODO\b/i.test(line)) {
        issues.push({ line: number, severity: "warning", code: "TODO", message: "Unfinished implementation marker" });
      }
    });
    if (!/local\s+\w+\s*=/.test(source)) {
      issues.push({ line: 1, severity: "warning", code: "STRUCTURE", message: "No local bindings detected; verify script structure" });
    }
    return issues;
  }

  validate(source: string): AnalysisIssue[] {
    const issues: AnalysisIssue[] = [];
    const lines = source.split(/\r?\n/);
    let blockDepth = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].replace(/--.*$/, "").trim();
      const opens = (line.match(/\b(function|if|for|while|do|repeat)\b/g) ?? []).length;
      const closes = (line.match(/\bend\b/g) ?? []).length;
      blockDepth += opens - closes;
      if (/^\s*(function\s+\w+\([^)]*)$/.test(lines[i]) || /^\s*(local\s+function\s+\w+\([^)]*)$/.test(lines[i])) {
        issues.push({ line: i + 1, severity: "error", code: "POSSIBLE_SYNTAX", message: "Function signature appears incomplete" });
      }
    }
    if (blockDepth !== 0) issues.push({ line: lines.length, severity: "error", code: "BLOCKS", message: "Unbalanced Luau block structure" });
    return issues;
  }
}
