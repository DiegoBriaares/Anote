const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const ignoredDirectories = new Set(['.git', 'node_modules', 'dist']);
const ignoredGeneratedPaths = new Set([
    path.join('control_center', 'build')
]);
const allowedSensitiveFiles = new Set([
    '.env.example',
    path.join('server', 'uploads', '.gitkeep')
]);

const privateTextPatterns = [
    ['macOS home path', /\/Users\/(?!<)[^/\s]+(?:\/|$)/g],
    ['Linux home path', /\/home\/(?!<)[^/\s]+(?:\/|$)/g],
    ['Windows home path', /[A-Za-z]:\\Users\\(?!<)[^\\\s]+(?:\\|$)/g],
    ['concrete Tailscale hostname', /\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.ts\.net\b/gi],
    ['Tailscale key', /\b(?:tskey|authkey)-[A-Za-z0-9_-]{10,}\b/g],
    ['GitHub token', /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/g],
    ['OpenAI key', /\bsk-[A-Za-z0-9_-]{20,}\b/g],
    ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/g],
    ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]+\b/g],
    ['private key', /-----BEGIN (?:RSA |OPENSSH |EC |PGP )?PRIVATE KEY-----/g]
];

const findings = [];

const relativePath = (filePath) => path.relative(repoRoot, filePath);

const isForbiddenDataFile = (relative) => {
    if (allowedSensitiveFiles.has(relative)) return false;
    if (relative === 'scripts/prod_user_ops.local.json') return true;
    if (relative === 'production.env' || relative.endsWith(`${path.sep}production.env`)) return true;
    if (path.basename(relative) === '.env' || path.basename(relative).startsWith('.env.')) return true;
    if (/^server\/calendar\.db(?:-.+)?$/.test(relative)) return true;
    if (relative.startsWith(`server${path.sep}uploads${path.sep}`)) return true;
    return false;
};

const scan = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === '.git') continue;
        if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory() && ignoredGeneratedPaths.has(relativePath(absolute))) continue;
        if (entry.isDirectory()) {
            scan(absolute);
            continue;
        }
        if (!entry.isFile()) continue;

        const relative = relativePath(absolute);
        if (isForbiddenDataFile(relative)) {
            findings.push(`${relative}: forbidden private data file`);
            continue;
        }

        const buffer = fs.readFileSync(absolute);
        if (buffer.includes(0)) continue;
        const text = buffer.toString('utf8');
        for (const [label, pattern] of privateTextPatterns) {
            pattern.lastIndex = 0;
            const match = pattern.exec(text);
            if (!match) continue;
            const line = text.slice(0, match.index).split('\n').length;
            findings.push(`${relative}:${line}: ${label}`);
        }
    }
};

scan(repoRoot);

if (findings.length > 0) {
    console.error('Privacy guard rejected the repository:');
    findings.forEach((finding) => console.error(`- ${finding}`));
    process.exit(1);
}

console.log('Privacy guard passed.');
