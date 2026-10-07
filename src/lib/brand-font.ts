import geist from "data-base64:@fontsource-variable/geist/files/geist-latin-wght-normal.woff2"

// Geist é a fonte do bisi.works. Vai embutida no bundle (sem depender de rede) e é registrada no
// documento, porque um @font-face dentro do shadow DOM do content script não tem efeito. O nome
// próprio evita conflito com fontes que a página já declare.
export const BRAND_FONT_FAMILY = "Drummond Geist"

const STYLE_ID = "drummond-brand-font"

export const registerBrandFont = () => {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement("style")
  style.id = STYLE_ID
  style.textContent = `@font-face{font-family:"${BRAND_FONT_FAMILY}";src:url(${geist}) format("woff2");font-weight:100 900;font-style:normal;font-display:swap}`
  document.head.append(style)
}
