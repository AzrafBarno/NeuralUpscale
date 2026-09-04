import { useEffect } from 'react'
import { useAppStore } from '@/store/app.store'

export function useGpuInfo(): void {
  const setGpuInfo = useAppStore((s) => s.setGpuInfo)

  useEffect(() => {
    window.electronAPI.detectGpu().then(setGpuInfo).catch(console.error)
  }, [setGpuInfo])
}
