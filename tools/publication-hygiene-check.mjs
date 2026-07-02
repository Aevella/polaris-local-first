#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const allowedRootMarkdownFiles = new Set([
  'CHANGELOG.md',
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'DEPLOYMENT.md',
  'GOVERNANCE.md',
  'README.md',
  'SECURITY.md'
]);
const auditDraftPrefix = ['architecture', 'audit'].join('-');

const pathRules = [
  {
    label: 'unlisted root Markdown',
    pattern: /^[A-Z0-9_ -]+\.md$/,
    allow: (file) => allowedRootMarkdownFiles.has(file)
  },
  {
    label: 'audit draft note',
    pattern: new RegExp(`^docs/${auditDraftPrefix}-.*\\.md$`, 'i')
  },
  {
    label: 'local env file',
    pattern: /(^|\/)\.env($|[./])/,
    allow: (file) => file === '.env.example'
  },
  {
    label: 'credential or signing material',
    pattern: /\.(pem|p8|key|cer|p12|mobileprovision)$/i
  },
  {
    label: 'generated archive or package',
    pattern: /\.(zip|tar|tar\.gz|tgz|xcarchive|ipa|apk|aab)$/i
  },
  {
    label: 'local database',
    pattern: /\.(sqlite|sqlite3|db)$/i
  },
  {
    label: 'generated source map',
    pattern: /\.map$/i
  },
  {
    label: 'Apple export options',
    pattern: /(^|\/)ExportOptions\.plist$/i
  }
];

const secretRules = [
  {
    label: 'key block',
    pattern: new RegExp('BEGIN (RSA |EC |OPENSSH |PRIVATE )?KEY')
  },
  {
    label: 'GitHub token',
    pattern: new RegExp('github_' + 'pat_|gh' + 'p_')
  },
  {
    label: 'AWS access key',
    pattern: new RegExp('AKIA' + '[0-9A-Z]{16}')
  },
  {
    label: 'Slack token',
    pattern: new RegExp('xox' + '[baprs]-')
  }
];

function git(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function listTrackedFiles() {
  const output = git(['ls-files']);
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function readTextFile(file) {
  const buffer = readFileSync(file);
  if (buffer.includes(0)) return null;
  return buffer.toString('utf8');
}

const trackedFiles = listTrackedFiles();
const trackedSet = new Set(trackedFiles);

const forbiddenTrackedFiles = trackedFiles.flatMap((file) => {
  for (const rule of pathRules) {
    if (rule.pattern.test(file) && !rule.allow?.(file)) {
      return [{ file, reason: rule.label }];
    }
  }
  return [];
});

const secretHits = [];
for (const file of trackedFiles) {
  let text;
  try {
    text = readTextFile(file);
  } catch {
    continue;
  }
  if (text === null) continue;
  for (const rule of secretRules) {
    if (rule.pattern.test(text)) {
      secretHits.push({ file, reason: rule.label });
    }
  }
}

function printList(title, entries, formatter = (entry) => entry) {
  if (!entries.length) {
    console.log(`- ${title}: PASS`);
    return;
  }
  console.log(`- ${title}: REVIEW`);
  for (const entry of entries) {
    console.log(`  - ${formatter(entry)}`);
  }
}

console.log('Publication hygiene report');
printList('tracked sensitive/generated files', forbiddenTrackedFiles, (entry) => `${entry.file} (${entry.reason})`);
printList('secret pattern scan', secretHits, (entry) => `${entry.file} (${entry.reason})`);

const hasFailure = forbiddenTrackedFiles.length > 0 || secretHits.length > 0;

process.exit(hasFailure ? 1 : 0);
