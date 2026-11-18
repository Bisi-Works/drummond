import { botconversaAdapter } from "./botconversa"
import type { ChatAdapter } from "./types"
import { whatsappAdapter } from "./whatsapp"

const adapters: ChatAdapter[] = [botconversaAdapter, whatsappAdapter]

export const getAdapter = (hostname: string): ChatAdapter | null =>
  adapters.find((adapter) => adapter.hosts.includes(hostname)) ?? null
