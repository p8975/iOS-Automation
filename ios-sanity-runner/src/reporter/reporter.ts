import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SuiteResult } from '../types.ts';

/** Writes JUnit XML (CI-native) + an HTML summary into the artifacts dir. */
export class Reporter {
  private readonly artifactsDir: string;
  constructor(artifactsDir: string) {
    this.artifactsDir = artifactsDir;
  }

  write(results: SuiteResult[]): { junitPath: string; htmlPath: string } {
    mkdirSync(this.artifactsDir, { recursive: true });
    const junitPath = join(this.artifactsDir, 'junit.xml');
    const htmlPath = join(this.artifactsDir, 'report.html');
    writeFileSync(junitPath, this.junit(results), 'utf8');
    writeFileSync(htmlPath, this.html(results), 'utf8');
    return { junitPath, htmlPath };
  }

  private junit(results: SuiteResult[]): string {
    const cases = results
      .map((r) => {
        const time = (Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 1000;
        const failures = r.steps.filter((s) => !s.ok);
        const body = r.ok
          ? ''
          : `<failure message="${esc(r.error ?? failures.map((f) => f.error).join('; '))}"/>`;
        return `    <testcase name="${esc(r.suite)}" classname="${esc(r.state)}.${esc(r.target)}" time="${time.toFixed(2)}">${body}</testcase>`;
      })
      .join('\n');
    const failures = results.filter((r) => !r.ok).length;
    return (
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<testsuite name="ios-sanity" tests="${results.length}" failures="${failures}">\n${cases}\n</testsuite>\n`
    );
  }

  private html(results: SuiteResult[]): string {
    const rows = results
      .map((r) => {
        const steps = r.steps
          .map(
            (s) =>
              `<li class="${s.ok ? 'ok' : 'bad'}">${s.ok ? '✅' : '❌'} ${esc(s.action)} (${s.durationMs}ms)` +
              `${s.error ? ` — <em>${esc(s.error)}</em>` : ''}</li>`,
          )
          .join('');
        return (
          `<section class="${r.ok ? 'ok' : 'bad'}"><h2>${r.ok ? '✅' : '❌'} ${esc(r.suite)}</h2>` +
          `<p>state: <b>${esc(r.state)}</b> · target: ${esc(r.target)}${r.error ? ` · <span class="err">${esc(r.error)}</span>` : ''}</p>` +
          `<ul>${steps}</ul></section>`
        );
      })
      .join('\n');
    const passed = results.filter((r) => r.ok).length;
    return (
      `<!doctype html><meta charset="utf-8"><title>iOS Sanity Report</title>` +
      `<style>body{font:14px system-ui;margin:2rem;max-width:900px}section{border:1px solid #ddd;border-radius:8px;padding:1rem;margin:1rem 0}` +
      `.ok h2{color:#137333}.bad h2{color:#c5221f}.err{color:#c5221f}li.bad{color:#c5221f}ul{line-height:1.6}</style>` +
      `<h1>iOS Sanity — ${passed}/${results.length} passed</h1>${rows}`
    );
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
