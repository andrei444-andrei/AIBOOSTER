# AIBOOSTER AI Scraper — Universal Runner Actor

Это отдельный мини-проект внутри AIBOOSTER: код Apify-актера, который
принимает на вход `{ code, params }` и исполняет произвольный JS, написанный
нашим LLM. Хост-проект (Next.js) дергает этого актера через Apify API
(`lib/apify.ts`).

## Зачем отдельная папка

Это не часть Next.js-бандла и не TypeScript. Это автономный Node.js-проект
со своим `package.json` и своим Dockerfile, который Apify собирает в своём
облаке. Сюда не попадает ничего из основного `package.json`, и наоборот —
зависимости актера (playwright, cheerio, got-scraping, apify) живут только тут.

## Helper SDK

Внутри пользовательского кода доступны 6 функций — задокументированы в
`lib/scraper/sdk-docs.ts` (та же доктринация скармливается LLM в system-prompt).
Если меняешь сигнатуры в `src/main.js` — синхронно правь `sdk-docs.ts`.

## Деплой

### Однократный setup

```bash
# 1. Установить Apify CLI
npm install -g apify-cli

# 2. Залогиниться (один раз, токен возьмётся из ~/.apify)
apify login

# 3. Перейти в папку актера
cd apify-runner

# 4. Положить AIMLAPI_KEY в секреты актера (на Apify), чтобы helper llm() работал
apify secrets add AIMLAPI_KEY "<твой_ключ>"
```

### Деплой / обновление

```bash
cd apify-runner
apify push
```

Команда соберёт Docker-образ в облаке Apify и опубликует новую версию.
В Apify Console (https://console.apify.com/actors) появится актер
`<username>/aibooster-runner`.

### Связка с основным приложением

После деплоя возьми `ID` или формат `username~aibooster-runner` (видно в
URL Apify Console) и положи в env основного приложения:

```env
APIFY_TOKEN=<токен из apify.com>
APIFY_RUNNER_ACTOR_ID=username~aibooster-runner
```

И настрой секрет на стороне актера, чтобы `llm()` хелпер работал:
- В Apify Console → Actors → aibooster-runner → Settings → Environment variables
- Добавь `AIMLAPI_KEY` (или используй `apify secrets add` как выше)

## Локальный smoke-test (без Apify cloud)

```bash
cd apify-runner
npm install
echo '{"code":"const html = await http({url:\"https://example.com\"}); log(\"size:\", html.length); await save({size: html.length}); return {ok:true};","params":{}}' > storage/key_value_stores/default/INPUT.json
mkdir -p storage/key_value_stores/default storage/datasets/default
npm start
```

После запуска:
- `storage/datasets/default/*.json` — сохранённые элементы (save).
- `storage/key_value_stores/default/OUTPUT.json` — return-значение.

## Безопасность

Код, который выполняет актер, генерирует LLM — это код от
непривилегированного источника. Защиты:

- Eval через `new Function`, без доступа к `require`/`import`/`process`
  на уровне сигнатуры (но globalThis всё ещё доступен — для строгой
  изоляции в будущем смотри `isolated-vm`).
- Сеть — только через предоставленные хелперы (`http`, `browse`),
  завязанные на Apify-прокси.
- Один актер = один контейнер на одного клиента = естественная изоляция.
- Hard-cap по времени run-а ставится со стороны бэкенда (`timeoutSecs`
  при `startRunnerRun`, по умолчанию у Apify 1 час, можно резать в коде
  оркестратора).
