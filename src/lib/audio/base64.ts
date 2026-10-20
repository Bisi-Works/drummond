// Base64 em blocos: `String.fromCharCode(...bytes)` estoura a pilha em áudios maiores. O resultado
// é o que o OpenRouter espera em `input_audio.data`.
const CHUNK = 0x8000

export const base64FromBytes = (bytes: Uint8Array): string => {
  let binary = ""
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK))
  }
  return btoa(binary)
}

export const blobToBase64 = async (blob: Blob): Promise<string> =>
  base64FromBytes(new Uint8Array(await blob.arrayBuffer()))
