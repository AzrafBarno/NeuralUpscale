import completedUrl from '../../assets/completed.mp3'
import { useAppStore } from '@/store/app.store'

/** Play the completion SFX if enabled in Settings. */
export function playCompletionSound(): void {
  const settings = useAppStore.getState().settings
  if (settings?.playCompletionSound === false) return

  try {
    const audio = new Audio(completedUrl)
    audio.volume = 0.85
    void audio.play().catch(() => {
      // Autoplay may be blocked; ignore
    })
  } catch {
    // ignore missing audio / decode errors
  }
}
