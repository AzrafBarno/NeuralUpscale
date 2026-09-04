import type { ModelInfo } from '@/store/app.store'

export const MODEL_VALUE_SEP = '::'

export function toSelectValue(id: string, modelPath?: string): string {
  return modelPath ? `${id}${MODEL_VALUE_SEP}${modelPath}` : id
}

export function parseSelectValue(value: string): { id: string; modelPath?: string } {
  const idx = value.indexOf(MODEL_VALUE_SEP)
  if (idx === -1) return { id: value }
  return { id: value.slice(0, idx), modelPath: value.slice(idx + MODEL_VALUE_SEP.length) }
}

export function findModel(
  models: ModelInfo[],
  id: string,
  modelPath?: string
): ModelInfo | undefined {
  if (modelPath) {
    return models.find((m) => m.id === id && m.modelPath === modelPath)
  }
  return models.find((m) => m.id === id && !m.modelPath) ?? models.find((m) => m.id === id)
}
