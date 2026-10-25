// Creates the first administrator (or resets a password) from the command line.
//   npm run create-admin
//   npm run create-admin -- --username=giorgi --name="Giorgi"
//   npm run create-admin -- --username=giorgi --reset        (set a new password for an existing user)
import readline from 'node:readline';
import { get, run, now, audit } from '../server/db.js';
import { hashPassword, passwordProblem } from '../server/security.js';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (text) => {
        if (text.includes(question)) process.stdout.write(question);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

const username = String(args.username || (await ask('Username: '))).trim();
if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) {
  console.error('Username: 3-32 characters, letters, digits, dot, dash or underscore.');
  process.exit(1);
}
const existing = get('SELECT * FROM users WHERE username = ?', username);
if (existing && !args.reset) {
  console.error(`The user "${username}" already exists. Add --reset to set a new password.`);
  process.exit(1);
}

let password = typeof args.password === 'string' ? args.password : await ask('Password (at least 10 characters): ', { hidden: true });
const problem = passwordProblem(password, username);
if (problem) {
  console.error(problem);
  process.exit(1);
}
if (typeof args.password !== 'string') {
  const again = await ask('Repeat the password: ', { hidden: true });
  if (again !== password) {
    console.error('The passwords do not match.');
    process.exit(1);
  }
}

const hash = await hashPassword(password);
password = '';
if (existing) {
  run('UPDATE users SET password_hash = ?, must_change_password = 0, active = 1, failed_logins = 0, locked_until = NULL WHERE id = ?', hash, existing.id);
  run('DELETE FROM sessions WHERE user_id = ?', existing.id);
  audit(null, 'user.reset_password', username, { via: 'cli' });
  console.log(`Password updated for "${username}".`);
} else {
  const name = typeof args.name === 'string' ? args.name : username;
  run(
    `INSERT INTO users (username, display_name, password_hash, role, active, must_change_password, created_at) VALUES (?, ?, ?, 'admin', 1, 0, ?)`,
    username, name, hash, now(),
  );
  audit(null, 'user.create', username, { role: 'admin', via: 'cli' });
  console.log(`Administrator "${username}" created. Start the server with: npm start`);
}
