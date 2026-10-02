// Publishes the production build to the gh-pages branch (GitHub Pages):  npm run deploy
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' });
const remote = execSync('git remote get-url origin').toString().trim();
run('npx vite build');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-commute-pages-'));
fs.cpSync('dist', tmp, { recursive: true });
fs.writeFileSync(path.join(tmp, '.nojekyll'), '');
run('git init -q -b gh-pages', tmp);
run('git add -A', tmp);
run('git -c user.name="deploy" -c user.email="deploy@users.noreply.github.com" commit -q -m "Deploy"', tmp);
run(`git push -q --force ${remote} gh-pages`, tmp);
fs.rmSync(tmp, { recursive: true, force: true });
console.log('Deployed to the gh-pages branch.');
