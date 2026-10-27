import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { applyTestEnv, TEST_ROOT } from './env';

export default async function globalSetup(): Promise<void> {
  applyTestEnv();
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TEST_ROOT, { recursive: true });
  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(__dirname, '..', '..'),
    env: { ...process.env },
    stdio: 'pipe',
  });
}
