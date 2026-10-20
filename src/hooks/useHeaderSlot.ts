import { useEffect, useState } from "react"

import type { ChatAdapter, HeaderSlot } from "~adapters/types"

import { sameBox, toBox, type Box } from "./useComposerState"

/** Respiro entre a barra e os grupos do cabeçalho (título e ícones). */
const SLOT_GAP = 16
/** Abaixo disso a barra não cabe no cabeçalho com o mínimo (marca, contagem e botão) e flutua. */
export const MIN_SLOT_WIDTH = 360

/**
 * Espaço livre do cabeçalho, na viewport: entre o título e os ícones, na altura do cabeçalho.
 * `null` sem cabeçalho visível ou quando sobra pouco espaço.
 */
export const headerSlotBox = (slot: HeaderSlot | null): Box | null => {
  const bar = toBox(slot?.bar)
  if (!slot || !bar) return null
  const start = toBox(slot.start)
  const end = toBox(slot.end)
  const left = (start ? start.right : bar.left) + SLOT_GAP
  const right = (end ? end.left : bar.right) - SLOT_GAP
  const width = right - left
  if (width < MIN_SLOT_WIDTH) return null
  return { top: bar.top, bottom: bar.bottom, height: bar.height, left, right, width }
}

/**
 * Acompanha o cabeçalho da plataforma onde a barra do dia fica, no mesmo esquema do
 * `useComposerState`: polling leve (o SPA remonta o cabeçalho ao trocar de página) mais `resize`.
 */
export const useHeaderSlot = (adapter: ChatAdapter | null, intervalMs = 500) => {
  const [box, setBox] = useState<Box | null>(null)

  useEffect(() => {
    if (!adapter?.getHeaderSlot) return
    const tick = () => {
      const next = headerSlotBox(adapter.getHeaderSlot?.() ?? null)
      setBox((prev) => (sameBox(prev, next) ? prev : next))
    }
    tick()
    const interval = setInterval(tick, intervalMs)
    window.addEventListener("resize", tick)
    return () => {
      clearInterval(interval)
      window.removeEventListener("resize", tick)
    }
  }, [adapter, intervalMs])

  return box
}
