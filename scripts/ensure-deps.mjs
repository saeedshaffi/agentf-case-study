// Runs before `npm start`: installs dependencies on a clean checkout, so one command is enough.
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
if (!existsSync(new URL('../node_modules/.bin/vite', import.meta.url))) {
  console.log('First run: installing dependencies (about a minute)…');
  execSync('npm install --no-audit --no-fund', { stdio: 'inherit', cwd: new URL('..', import.meta.url) });
}
