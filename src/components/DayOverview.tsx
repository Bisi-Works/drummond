import { useDayTracking } from "~hooks/useDayTracking"
import { WAIT_CHIP } from "~lib/labels"
import { formatDayLabel, formatDuration, formatWait } from "~lib/tracking/format"
import type { AttentionItem } from "~lib/tracking/summary"

// Resumo do dia no painel lateral: os mesmos totais e a mesma fila de atenção do widget, lidos do
// `chrome.storage.local` pelo `useDayTracking` (sem adapter — o painel não observa a página, só lê
// o que o content script gravou). Assim as duas UIs ficam coerentes por construção, sem chamada de
// IA e sem duplicar a regra do semáforo.

/** Número grande com rótulo curto, no vocabulário visual do painel. */
const Stat = ({ value, label }: { value: number | string; label: string }) => (
  <div className="rounded-lg border border-line bg-muted/50 px-2.5 py-2">
    <p className="text-base font-semibold leading-tight text-fg">{value}</p>
    <p className="text-[11px] text-fg-subtle">{label}</p>
  </div>
)

/** Uma conversa da fila de atenção: nome do contato e chip do semáforo com o tempo de espera. */
const AttentionRow = ({ item }: { item: AttentionItem }) => {
  const { conversation, status } = item
  return (
    <li className="flex items-center justify-between gap-2 rounded-lg border border-line bg-muted/60 px-3 py-2">
      <p className="min-w-0 flex-1 truncate text-sm font-semibold text-fg" title={conversation.label}>
        {conversation.label}
      </p>
      {status.level && status.elapsedMs !== null ? (
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${WAIT_CHIP[status.level]}`}
          title={`Aguardando há ${formatDuration(status.elapsedMs)}`}>
          {formatWait(status.elapsedMs)}
        </span>
      ) : (
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-fg-subtle">
          aguardando
        </span>
      )}
    </li>
  )
}

/**
 * "Resumo do dia" do painel lateral. Não recebe props: lê o dia do storage pelo hook (que também
 * mantém os tempos de espera vivos no tick) e some por completo quando nada foi acompanhado.
 */
export const DayOverview = () => {
  const { day, summary, attention, alertCount } = useDayTracking(null)

  return (
    <section className="space-y-3" aria-label="Resumo do dia">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-fg">Resumo do dia</h2>
        <span className="flex items-center gap-1.5 text-xs text-fg-subtle">
          {alertCount > 0 && (
            <span
              className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white"
              title={`${alertCount} conversa${alertCount > 1 ? "s" : ""} aguardando em laranja ou vermelho`}>
              {alertCount}
            </span>
          )}
          {formatDayLabel(day.date)}
        </span>
      </div>

      {summary.conversations === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-sm text-fg-subtle">
          Nenhuma conversa acompanhada hoje
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Stat value={summary.conversations} label="acompanhadas" />
            <Stat value={summary.waiting} label="aguardando" />
            <Stat value={summary.answered} label="respondidas" />
          </div>

          {(summary.reviews > 0 || summary.coachings > 0) && (
            <p className="text-[11px] text-fg-subtle">
              {summary.reviews} revis{summary.reviews === 1 ? "ão" : "ões"} de rascunho
              {summary.coachings > 0 &&
                ` · ${summary.coachings} coaching${summary.coachings > 1 ? "s" : ""} anexado${summary.coachings > 1 ? "s" : ""}`}
            </p>
          )}

          {(summary.averageFirstResponseMs !== null || summary.averageResponseMs !== null) && (
            <p className="text-[11px] text-fg-subtle">
              {summary.averageFirstResponseMs !== null && (
                <span title="Média do tempo até a primeira resposta do vendedor">
                  1ª resposta em {formatDuration(summary.averageFirstResponseMs)}
                </span>
              )}
              {summary.averageFirstResponseMs !== null && summary.averageResponseMs !== null && " · "}
              {summary.averageResponseMs !== null && (
                <span title="Média entre a última mensagem do cliente e a resposta do vendedor">
                  resposta em {formatDuration(summary.averageResponseMs)}
                </span>
              )}
            </p>
          )}

          {attention.length === 0 ? (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-100">
              Nenhuma conversa aguardando resposta.
            </p>
          ) : (
            <ul className="space-y-2">
              {attention.map((item) => (
                <AttentionRow key={item.conversation.key} item={item} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
