// Publica uma versão nova na Chrome Web Store (API v2):
//   1. confere que o git está limpo e que o .env de produção não leva variáveis de teste;
//   2. confere na loja se não há versão em revisão e se a versão nova é maior que a publicada;
//   3. sobe a versão do package.json (patch, minor, major ou x.y.z explícito);
//   4. roda `pnpm verify` (testes, typecheck, build, check:bundle) e `pnpm package`;
//   5. envia o zip e submete para revisão (com --draft, só envia: fica como rascunho no painel);
//   6. faz commit do package.json e cria a tag vX.Y.Z (sem push).
// Se algo falhar antes do envio, o package.json volta para a versão anterior.
//
// Uso: pnpm release [patch|minor|major|x.y.z] [--draft]
//      pnpm release --zip-only   só checa e gera o zip, sem mexer na versão nem falar com a loja
//                                (primeiro envio, que é feito à mão no painel)
// Credenciais da loja em .env.cws (modelo em .env.cws.example). Passo a passo em
// docs/chrome-web-store.md.
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"

const ZIP = "build/chrome-mv3-prod.zip"
const API = "https://chromewebstore.googleapis.com"

const args = process.argv.slice(2)
const zipOnly = args.includes("--zip-only")
const draft = args.includes("--draft")
const bump = args.find((arg) => !arg.startsWith("--")) ?? "patch"

const fail = (message) => {
  console.error(`\nFALHA ${message}`)
  process.exit(1)
}
const step = (message) => console.log(`\n▸ ${message}`)
const run = (cmd, cmdArgs) => {
  const result = spawnSync(cmd, cmdArgs, { stdio: "inherit", shell: process.platform === "win32" })
  return result.status === 0
}
const git = (...gitArgs) => spawnSync("git", gitArgs, { encoding: "utf8" }).stdout.trim()

// Versões ------------------------------------------------------------------------------------
const parseVersion = (v) => v.split(".").map(Number)
const compareVersions = (a, b) => {
  const [pa, pb] = [parseVersion(a), parseVersion(b)]
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return Math.sign(diff)
  }
  return 0
}
const nextVersion = (current, kind) => {
  if (/^\d+(\.\d+){0,3}$/.test(kind)) return kind
  const [major = 0, minor = 0, patch = 0] = parseVersion(current)
  if (kind === "major") return `${major + 1}.0.0`
  if (kind === "minor") return `${major}.${minor + 1}.0`
  if (kind === "patch") return `${major}.${minor}.${patch + 1}`
  fail(`versão "${kind}" inválida: use patch, minor, major ou x.y.z`)
}

// .env de produção ---------------------------------------------------------------------------
// Mesma ordem em que o Plasmo procura os arquivos numa build de produção (o primeiro que define
// a variável vence; variáveis do shell vencem todos). Conferido no plasmo 0.90.5.
const PROD_ENV_FILES = [
  ".env.chrome.local",
  ".env.prod.local",
  ".env.production.local",
  ".env.local",
  ".env.chrome",
  ".env.prod",
  ".env.production",
  ".env"
]
const readProdEnv = () => {
  const env = {}
  for (const file of PROD_ENV_FILES.filter(existsSync)) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (match && !(match[1] in env)) env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2")
    }
  }
  // Variável vazia no shell não conta como "desligada": o Plasmo ignora vazio e cairia no arquivo.
  const shell = Object.entries(process.env).filter(([k, v]) => k.startsWith("PLASMO_PUBLIC_") && v)
  return { ...env, ...Object.fromEntries(shell) }
}

const checkProdEnv = () => {
  const env = readProdEnv()
  const problems = []
  if (!env.PLASMO_PUBLIC_OPENROUTER_API_KEY) problems.push("PLASMO_PUBLIC_OPENROUTER_API_KEY está vazia")
  if (env.PLASMO_PUBLIC_INBOX_USER_ID)
    problems.push(
      "PLASMO_PUBLIC_INBOX_USER_ID está preenchida: todo vendedor veria os chats desse membro no lugar dos " +
        "dele. Mova a linha para o .env.development.local (só o `pnpm dev` lê esse arquivo, e o git o ignora)"
    )
  if (env.PLASMO_PUBLIC_REPORT_UNLIMITED === "true")
    problems.push("PLASMO_PUBLIC_REPORT_UNLIMITED=true desliga a trava de 1 relatório por dia")
  if (env.PLASMO_PUBLIC_DENY_DATA_COLLECTION === "false")
    problems.push("PLASMO_PUBLIC_DENY_DATA_COLLECTION=false contradiz a política de privacidade publicada na loja")
  if (problems.length) fail(`o .env de produção não está pronto para a loja:\n  - ${problems.join("\n  - ")}`)
}

// Chrome Web Store ---------------------------------------------------------------------------
const loadCredentials = () => {
  if (existsSync(".env.cws")) process.loadEnvFile(".env.cws")
  const { CWS_PUBLISHER_ID, CWS_EXTENSION_ID, CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN, CWS_ACCESS_TOKEN } =
    process.env
  const missing = Object.entries({ CWS_PUBLISHER_ID, CWS_EXTENSION_ID }).filter(([, v]) => !v)
  // Um token pronto (ex.: `gcloud auth print-access-token` de uma conta de serviço) dispensa o OAuth.
  if (!CWS_ACCESS_TOKEN)
    missing.push(...Object.entries({ CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN }).filter(([, v]) => !v))
  if (missing.length)
    fail(`faltam credenciais da loja no .env.cws: ${missing.map(([k]) => k).join(", ")} (veja .env.cws.example)`)
  return process.env
}

const getAccessToken = async (creds) => {
  if (creds.CWS_ACCESS_TOKEN) return creds.CWS_ACCESS_TOKEN
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: creds.CWS_CLIENT_ID,
      client_secret: creds.CWS_CLIENT_SECRET,
      refresh_token: creds.CWS_REFRESH_TOKEN,
      grant_type: "refresh_token"
    })
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || !body.access_token)
    fail(
      `não deu para renovar o token do Google (${body.error ?? response.status}: ${body.error_description ?? ""}). ` +
        "Se a tela de consentimento OAuth está em modo Teste, o refresh token expira em 7 dias: gere outro " +
        "(docs/chrome-web-store.md)"
    )
  return body.access_token
}

const storeClient = (creds, token) => {
  const item = `publishers/${creds.CWS_PUBLISHER_ID}/items/${creds.CWS_EXTENSION_ID}`
  const call = async (method, url, body) => {
    const response = await fetch(url, { method, headers: { Authorization: `Bearer ${token}` }, body })
    const json = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(`${response.status} ${json.error?.message ?? JSON.stringify(json)}`)
    return json
  }
  return {
    status: () => call("GET", `${API}/v2/${item}:fetchStatus`),
    upload: (zip) => call("POST", `${API}/upload/v2/${item}:upload`, zip),
    publish: () => call("POST", `${API}/v2/${item}:publish`)
  }
}

const storeVersion = (revision) => revision?.distributionChannels?.[0]?.crxVersion

/** Espera um envio assíncrono terminar (a API responde IN_PROGRESS para pacotes que demoram). */
const waitUpload = async (store) => {
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 2000))
    const state = (await store.status()).lastAsyncUploadState
    if (state === "SUCCEEDED") return
    if (state === "FAILED" || state === "NOT_FOUND") throw new Error(`envio terminou como ${state}`)
  }
  throw new Error("o envio não terminou em 60 s: confira no painel da loja")
}

// Fluxo --------------------------------------------------------------------------------------
const pkgText = readFileSync("package.json", "utf8")
const currentVersion = JSON.parse(pkgText).version

step("Conferindo o .env de produção")
checkProdEnv()

if (zipOnly) {
  step(`Validando e empacotando a versão ${currentVersion}`)
  if (!run("pnpm", ["verify"]) || !run("pnpm", ["package"])) fail("pnpm verify/package falhou")
  console.log(`\nOK  ${ZIP} (versão ${currentVersion}) pronto para enviar no painel da loja`)
  process.exit(0)
}

if (git("status", "--porcelain")) fail("há mudanças não commitadas: o zip precisa corresponder a um commit")

const version = nextVersion(currentVersion, bump)
const creds = loadCredentials()
const store = storeClient(creds, await getAccessToken(creds))

step("Consultando a loja")
let status
try {
  status = await store.status()
} catch (error) {
  fail(`a loja recusou a consulta (${error.message}). Confira as credenciais, CWS_PUBLISHER_ID e CWS_EXTENSION_ID`)
}
const published = storeVersion(status.publishedItemRevisionStatus)
const submitted = status.submittedItemRevisionStatus
console.log(`Na loja: ${published ?? "nada publicado"}${submitted ? ` · enviada ${storeVersion(submitted)} (${submitted.state})` : ""}`)
if (submitted?.state === "PENDING_REVIEW")
  fail(`a versão ${storeVersion(submitted)} ainda está em revisão: espere terminar ou cancele no painel`)
const latest = [published, storeVersion(submitted)].filter(Boolean).sort(compareVersions).at(-1)
if (latest && compareVersions(version, latest) <= 0) fail(`a versão ${version} precisa ser maior que ${latest}`)

step(`Versão ${currentVersion} → ${version}`)
writeFileSync("package.json", pkgText.replace(`"version": "${currentVersion}"`, `"version": "${version}"`))
const restoreVersion = () => writeFileSync("package.json", pkgText)

step("pnpm verify && pnpm package")
if (!run("pnpm", ["verify"]) || !run("pnpm", ["package"])) {
  restoreVersion()
  fail("pnpm verify/package falhou (package.json voltou para a versão anterior)")
}

step(`Enviando ${ZIP}`)
try {
  const upload = await store.upload(readFileSync(ZIP))
  if (upload.uploadState === "IN_PROGRESS" || upload.uploadState === "UPLOAD_IN_PROGRESS") await waitUpload(store)
  else if (upload.uploadState !== "SUCCEEDED") throw new Error(`envio terminou como ${upload.uploadState}`)
} catch (error) {
  restoreVersion()
  fail(`a loja recusou o pacote (${error.message}). package.json voltou para ${currentVersion}`)
}

// Daqui em diante a versão já está na loja: o commit e a tag ficam mesmo que a submissão falhe.
git("add", "package.json")
git("commit", "-m", `release: v${version}`)
git("tag", "-a", `v${version}`, "-m", `v${version}`) // anotada: o --follow-tags só leva essas

if (draft) {
  console.log(`\nOK  v${version} enviada como rascunho. Submeta para revisão pelo painel quando quiser.`)
} else {
  step("Submetendo para revisão")
  try {
    const result = await store.publish()
    for (const warning of result.warningInfo?.warnings ?? []) console.log(`AVISO ${warning.description}`)
    console.log(`\nOK  v${version} submetida (${result.state}).`)
  } catch (error) {
    console.error(`\nFALHA a v${version} foi enviada, mas a submissão falhou (${error.message}). Submeta pelo painel.`)
    process.exitCode = 1
  }
}
console.log(`Commit e tag v${version} criados localmente: git push --follow-tags`)
