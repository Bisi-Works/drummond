// Formatação de texto do dia: duração curta, tempo de espera e data local. Puras e sem React — o
// widget e o painel mostram os mesmos rótulos, então elas ficam aqui em vez de duplicadas em cada
// componente (o mesmo critério de `level.ts` para a regra do semáforo).

/** Duração em texto curto: "45 s", "5 min", "1 h 5 min". Nunca negativa. */
export const formatDuration = (elapsedMs: number): string => {
  const seconds = Math.max(0, Math.round(elapsedMs / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

/** Tempo de espera em texto curto: "agora" abaixo de um minuto, senão igual a `formatDuration`. */
export const formatWait = (elapsedMs: number): string =>
  elapsedMs < 60_000 ? "agora" : formatDuration(elapsedMs)

/** Data local YYYY-MM-DD em "DD/MM/AAAA" (sem `Date` para não escorregar de fuso). */
export const formatDayLabel = (date: string): string => {
  const [year, month, day] = date.split("-")
  return year && month && day ? `${day}/${month}/${year}` : date
}
