#!/usr/bin/env tsx
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { readdirSync, statSync } from 'fs';
import ts from 'typescript';

function collectFiles(dir: string, extensions: string[]): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...collectFiles(full, extensions));
    } else if (extensions.some((ext) => entry.endsWith(ext))) {
      results.push(full);
    }
  }
  return results;
}

function isSuppressionComment(text: string): boolean {
  const trimmed = text.replace(/^\/\/\s*|^\/\*\s*|\s*\*\/$/, '').trim();
  return trimmed.startsWith('biome-ignore') || trimmed.startsWith('eslint-disable') || trimmed.startsWith('@ts-');
}

function stripComments(source: string, fileName: string): string {
  const scriptKind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKind);

  const rangeMap = new Map<number, { pos: number; end: number; kind: ts.CommentKind }>();

  function visit(node: ts.Node) {
    const leading = ts.getLeadingCommentRanges(source, node.getFullStart());
    if (leading) {
      for (const r of leading) rangeMap.set(r.pos, r);
    }
    const trailing = ts.getTrailingCommentRanges(source, node.getEnd());
    if (trailing) {
      for (const r of trailing) rangeMap.set(r.pos, r);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  const trailingEof = ts.getTrailingCommentRanges(source, sourceFile.getEnd());
  if (trailingEof) {
    for (const r of trailingEof) rangeMap.set(r.pos, r);
  }

  if (rangeMap.size === 0) return source;

  const ranges = [...rangeMap.values()]
    .filter((r) => !isSuppressionComment(source.substring(r.pos, r.end)))
    .sort((a, b) => a.pos - b.pos);

  if (ranges.length === 0) return source;

  const parts: string[] = [];
  let cursor = 0;

  for (const { pos, end, kind } of ranges) {
    const lineStart = source.lastIndexOf('\n', pos - 1) + 1;
    const lineEnd = source.indexOf('\n', end);
    const afterEnd = lineEnd === -1 ? source.length : lineEnd;

    const beforeOnLine = source.substring(lineStart, pos).trim();
    const afterOnLine = source.substring(end, afterEnd).trim();

    if (beforeOnLine === '' && afterOnLine === '') {
      parts.push(source.substring(cursor, lineStart));
      cursor = lineEnd === -1 ? source.length : lineEnd + 1;
    } else {
      let chunk = source.substring(cursor, pos);
      if (afterOnLine === '' && kind === ts.SyntaxKind.SingleLineCommentTrivia) {
        chunk = chunk.trimEnd();
      }
      parts.push(chunk);
      cursor = end;
    }
  }

  parts.push(source.substring(cursor));
  return parts.join('');
}

const files = collectFiles('app', ['.ts', '.tsx']);
let changed = 0;

for (const file of files) {
  const original = readFileSync(file, 'utf-8');
  const stripped = stripComments(original, file);
  if (stripped !== original) {
    writeFileSync(file, stripped, 'utf-8');
    changed++;
  }
}

console.log(`Processed ${files.length} files, modified ${changed}.`);
