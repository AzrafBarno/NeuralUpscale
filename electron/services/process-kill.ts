import { execFile, type ChildProcess } from 'child_process'

/** Force-kill a child and its descendants (needed on Windows for ffmpeg/realesrgan). */
export function killProcessTree(proc: ChildProcess | null | undefined): void {
  if (!proc?.pid) return
  const pid = proc.pid
  try {
    if (process.platform === 'win32') {
      execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => {
        // ignore exit status — process may already be gone
      })
    } else {
      try {
        proc.kill('SIGKILL')
      } catch {
        try {
          proc.kill()
        } catch {
          // ignore
        }
      }
    }
  } catch {
    try {
      proc.kill()
    } catch {
      // ignore
    }
  }
}
