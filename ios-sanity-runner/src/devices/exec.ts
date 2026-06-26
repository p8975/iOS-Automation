import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface CmdResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
}

/** Run a command without a shell (no injection surface). Never throws. */
export async function run(cmd: string, args: string[] = [], timeoutMs = 60_000): Promise<CmdResult> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, { timeout: timeoutMs });
    return { ok: true, stdout, stderr, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number; message?: string };
    return {
      ok: false,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? e.message ?? '',
      code: typeof e.code === 'number' ? e.code : null,
    };
  }
}

/** True if a binary is resolvable on PATH. */
export async function which(bin: string): Promise<boolean> {
  const r = await run('which', [bin]);
  return r.ok && r.stdout.trim().length > 0;
}
