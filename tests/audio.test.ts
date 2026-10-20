import { describe, expect, it } from "vitest"

import { base64FromBytes, blobToBase64 } from "~lib/audio/base64"
import { audioFormatFromMime } from "~lib/audio/format"

describe("audioFormatFromMime", () => {
  it("mapeia os formatos aceitos, ignorando parâmetros do mime", () => {
    expect(audioFormatFromMime("audio/ogg; codecs=opus")).toBe("ogg")
    expect(audioFormatFromMime("audio/mpeg")).toBe("mp3")
    expect(audioFormatFromMime("audio/x-m4a")).toBe("m4a")
    expect(audioFormatFromMime("AUDIO/WAV")).toBe("wav")
  })

  it("devolve null para formato desconhecido ou vazio", () => {
    expect(audioFormatFromMime("audio/webm")).toBeNull()
    expect(audioFormatFromMime("")).toBeNull()
  })
})

describe("base64", () => {
  it("codifica bytes em base64", () => {
    expect(base64FromBytes(new Uint8Array([97, 98, 99]))).toBe("YWJj")
    expect(base64FromBytes(new Uint8Array())).toBe("")
  })

  it("codifica um Blob", async () => {
    await expect(blobToBase64(new Blob(["abc"]))).resolves.toBe("YWJj")
  })
})
