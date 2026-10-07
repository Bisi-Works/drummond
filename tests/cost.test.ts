import { describe, expect, it } from "vitest"

import {
  estimateCost,
  estimateTokens,
  formatUsd,
  pricingRange,
  type ModelEndpoint
} from "~lib/ai/cost"

const endpoint = (provider: string, prompt: number, completion: number, params: string[]): ModelEndpoint => ({
  provider_name: provider,
  supported_parameters: params,
  pricing: { prompt: String(prompt / 1e6), completion: String(completion / 1e6) }
})

const JSON_SCHEMA = ["response_format", "structured_outputs"]
const endpoints = [
  endpoint("Barato", 0.03, 0.5, [...JSON_SCHEMA, "temperature"]),
  endpoint("SemTemperatura", 0.1, 0.4, JSON_SCHEMA),
  endpoint("Caro", 0.6, 2.4, [...JSON_SCHEMA, "temperature"]),
  endpoint("SemJsonSchema", 0.01, 0.01, ["response_format", "temperature"])
]

describe("pricingRange", () => {
  it("considera só provedores com JSON Schema (require_parameters)", () => {
    const range = pricingRange(endpoints, { needsTemperature: false })!
    expect(range.providers).toBe(3)
    expect(range.prompt.min * 1e6).toBeCloseTo(0.03)
    expect(range.prompt.max * 1e6).toBeCloseTo(0.6)
    expect(range.completion.min * 1e6).toBeCloseTo(0.4)
  })

  it("exige temperatura quando ela é enviada", () => {
    const range = pricingRange(endpoints, { needsTemperature: true })!
    expect(range.providers).toBe(2)
    expect(range.completion.min * 1e6).toBeCloseTo(0.5)
  })

  it("exige suporte a reasoning quando ele é enviado", () => {
    const withReasoning = [...endpoints, endpoint("ComReasoning", 0.2, 0.8, [...JSON_SCHEMA, "reasoning"])]
    const range = pricingRange(withReasoning, { needsTemperature: false, needsReasoning: true })!
    expect(range.providers).toBe(1)
    expect(range.prompt.min * 1e6).toBeCloseTo(0.2)
  })

  it("em json_object, aceita provedores sem structured_outputs", () => {
    const range = pricingRange(endpoints, { responseFormat: "json_object", needsTemperature: true })!
    expect(range.providers).toBe(3)
    expect(range.prompt.min * 1e6).toBeCloseTo(0.01)
  })

  it("retorna null quando nenhum provedor atende", () => {
    expect(pricingRange([endpoints[3]], { needsTemperature: false })).toBeNull()
  })
})

describe("estimateCost", () => {
  it("soma entrada (system + user + schema) e saída pelos preços mínimo e máximo", () => {
    const prompt = { system: "a".repeat(700), user: "b".repeat(300) }
    const range = pricingRange(endpoints, { needsTemperature: true })!
    const estimate = estimateCost(prompt, {}, 100, range)

    expect(estimate.inputTokens).toBe(estimateTokens("a".repeat(700) + "b".repeat(300) + "{}"))
    expect(estimate.minUsd).toBeCloseTo((estimate.inputTokens * 0.03 + 100 * 0.5) / 1e6)
    expect(estimate.maxUsd).toBeCloseTo((estimate.inputTokens * 0.6 + 100 * 2.4) / 1e6)
  })
})

describe("formatUsd", () => {
  it("valores pequenos com 2 algarismos significativos, maiores com centavos", () => {
    expect(formatUsd(0.000456)).toBe("US$ 0,00046")
    expect(formatUsd(0.0012)).toBe("US$ 0,0012")
    expect(formatUsd(0.45)).toBe("US$ 0,45")
    expect(formatUsd(0.0118)).toBe("US$ 0,0118")
    expect(formatUsd(5.885)).toBe("US$ 5,89")
  })
})
