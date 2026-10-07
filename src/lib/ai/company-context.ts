// Contexto da empresa injetado no system prompt. Edite livremente: quanto mais específico (produtos,
// políticas, termos proibidos), melhores as sugestões. Não coloque dados sensíveis — este texto vai
// em toda requisição ao modelo e fica embutido na extensão.

export const COMPANY_NAME = "BW"

export const COMPANY_CONTEXT = `
- Segmento/produtos: (preencher — o que a empresa vende e para quem)
- Diferenciais que os vendedores costumam destacar: (preencher)
- Políticas comerciais que a IA deve respeitar: descontos, prazos e condições são definidos pelo
  vendedor; a IA nunca propõe nem altera valores.
- Termos a evitar: (preencher — ex.: "promoção imperdível", "última chance", promessas de resultado)
`.trim()
