// O OpenRouter recebe `input_audio` com um formato explícito, não um mime completo. O áudio de
// voz do WhatsApp chega como ogg/opus; os demais formatos abaixo são os que o Whisper aceita.
const FORMATS: Record<string, string> = {
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/wave": "wav",
  "audio/x-wav": "wav",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/flac": "flac",
  "audio/x-flac": "flac"
}

/** Formato aceito pelo OpenRouter a partir do mime; `null` quando não há suporte conhecido. */
export const audioFormatFromMime = (mimeType: string): string | null => {
  const normalized = mimeType.split(";")[0]?.trim().toLowerCase() ?? ""
  return FORMATS[normalized] ?? null
}
