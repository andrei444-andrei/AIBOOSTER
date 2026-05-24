// AIBOOSTER AI Scraper — Universal Runner Actor.
//
// Принимает на вход { code, params }, где `code` — это JS-код, сгенерированный
// LLM на стороне нашего бэкенда. Код выполняется в изолированном async-контексте
// с доступом к 6 helper-функциям (см. SDK_DOCS в lib/scraper/sdk-docs.ts).
//
// Результат:
//   - save() → пишет в default Dataset актера → наш бэкенд читает оттуда.
//   - return → если код вернул значение, кладём его в KV.OUTPUT.
//   - throw  → актер падает, exit-code != 0; бэкенд увидит FAILED.
//
// Безопасность:
//   - eval делаем через `new Function`, без доступа к require/import/process.
//   - Сеть только через предоставленные helpers (http / browse) — у них прокси
//     и тайм-ауты.
//   - Hard-cap по времени актера ставится извне (timeoutSecs при run).

import { Actor, log as apifyLog } from 'apify';
import * as cheerio from 'cheerio';
import { gotScraping } from 'got-scraping';

await Actor.init();

const DEFAULT_TIMEOUT_MS = 30_000;

try {
    const input = (await Actor.getInput()) || {};
    const { code, params = {} } = input;

    if (typeof code !== 'string' || !code.trim()) {
        throw new Error('Input.code обязателен (string)');
    }

    // --- Прокси-конфигурация (общая для http и browse) ---
    const proxyDatacenter = await Actor.createProxyConfiguration({ groups: ['AUTO'] }).catch(() => null);
    const proxyResidential = await Actor.createProxyConfiguration({ groups: ['RESIDENTIAL'] }).catch(() => null);

    async function getProxyUrl(kind) {
        if (kind === 'none') return undefined;
        const cfg = kind === 'residential' ? proxyResidential : proxyDatacenter;
        if (!cfg) return undefined;
        return cfg.newUrl();
    }

    // --- Helper SDK (доступен внутри пользовательского кода) ---

    const http = async (opts) => {
        if (!opts || typeof opts !== 'object') throw new Error('http(): ожидается объект options');
        const { url, method = 'GET', headers, body, proxy = 'datacenter', timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
        if (!url) throw new Error('http(): обязателен options.url');

        const proxyUrl = await getProxyUrl(proxy);

        const payload = body == null
            ? undefined
            : typeof body === 'string' ? body : JSON.stringify(body);

        const r = await gotScraping({
            url,
            method,
            headers,
            body: payload,
            proxyUrl,
            timeout: { request: timeoutMs },
            retry: { limit: 1 },
            throwHttpErrors: false,
        });

        if (r.statusCode >= 400) {
            throw new Error(`http(): ${r.statusCode} ${r.statusMessage} for ${url}`);
        }
        return r.body;
    };

    const parse = (html) => {
        if (typeof html !== 'string') throw new Error('parse(): ожидается строка HTML');
        return cheerio.load(html);
    };

    const save = async (item) => {
        if (item == null) return;
        if (Array.isArray(item)) {
            if (item.length === 0) return;
            await Actor.pushData(item);
        } else {
            await Actor.pushData(item);
        }
    };

    const log = (...args) => {
        apifyLog.info('[USER] ' + args.map(formatLogArg).join(' '));
    };

    const llm = async (prompt, opts = {}) => {
        const key = process.env.AIMLAPI_KEY;
        if (!key) throw new Error('llm(): AIMLAPI_KEY не задан в окружении актера');
        if (typeof prompt !== 'string' || !prompt.trim()) {
            throw new Error('llm(): нужен непустой prompt');
        }
        const messages = [];
        if (opts.system) messages.push({ role: 'system', content: opts.system });
        messages.push({ role: 'user', content: prompt });

        const r = await gotScraping({
            url: 'https://api.aimlapi.com/v1/chat/completions',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${key}`,
            },
            body: JSON.stringify({
                model: opts.model || 'claude-sonnet-4-5',
                messages,
                max_tokens: opts.maxTokens || 1000,
                temperature: opts.temperature ?? 0.2,
            }),
            timeout: { request: 60_000 },
            throwHttpErrors: false,
        });
        if (r.statusCode >= 400) {
            throw new Error(`llm(): AIMLAPI ${r.statusCode} ${r.statusMessage}`);
        }
        const data = JSON.parse(r.body);
        return data.choices?.[0]?.message?.content ?? '';
    };

    const browse = async (opts) => {
        if (!opts || !opts.url) throw new Error('browse(): обязателен options.url');
        // Ленивая загрузка playwright — чтобы базовый http-кейс не тянул хром.
        const { chromium } = await import('playwright');
        const proxyUrl = await getProxyUrl(opts.proxy ?? 'datacenter');
        const launchOpts = {};
        if (proxyUrl) launchOpts.proxy = { server: proxyUrl };

        const browser = await chromium.launch({ headless: true, ...launchOpts });
        try {
            const ctx = await browser.newContext();
            const page = await ctx.newPage();
            await page.goto(opts.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
            if (opts.waitFor) {
                await page.waitForSelector(opts.waitFor, { timeout: 15_000 }).catch(() => null);
            }
            const html = await page.content();
            const title = await page.title();
            return { html, title };
        } finally {
            await browser.close().catch(() => null);
        }
    };

    // --- Eval пользовательского кода ---

    apifyLog.info('[runner] Building user function...');
    const userFn = new Function(
        'http', 'parse', 'save', 'log', 'llm', 'browse', 'params',
        `return (async () => { ${code}\n })();`,
    );

    apifyLog.info('[runner] Executing user code...');
    const t0 = Date.now();
    const returnValue = await userFn(http, parse, save, log, llm, browse, params);
    const elapsedMs = Date.now() - t0;

    apifyLog.info(`[runner] Done in ${elapsedMs}ms`);

    // Если код вернул значение и не сохранил через save() — положим в OUTPUT.
    await Actor.setValue('OUTPUT', {
        ok: true,
        returnValue: returnValue === undefined ? null : returnValue,
        elapsedMs,
    });
} catch (err) {
    apifyLog.exception(err, '[runner] User code failed');
    await Actor.setValue('OUTPUT', {
        ok: false,
        error: err?.message ?? String(err),
        stack: err?.stack ?? null,
    });
    // Перебрасываем, чтобы actor завершился со статусом FAILED.
    await Actor.exit({ exitCode: 1, statusMessage: err?.message?.slice(0, 200) ?? 'Failed' });
}

await Actor.exit();

function formatLogArg(a) {
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a); } catch { return String(a); }
}
