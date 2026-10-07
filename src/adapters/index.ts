import { botconversaAdapter } from "./botconversa"
import type { ChatAdapter } from "./types"

const adapters: ChatAdapter[] = [botconversaAdapter]

export const getAdapter = (hostname: string): ChatAdapter | null =>
  adapters.find((adapter) => adapter.hosts.includes(hostname)) ?? null
