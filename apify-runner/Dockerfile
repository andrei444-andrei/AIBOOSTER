# Базовый образ Apify с Node.js + Playwright (Chrome предустановлен).
FROM apify/actor-node-playwright-chrome:20

# Копируем package.json первым, чтобы npm install попадал в кэш Docker-слоя
# и не пересобирался при каждом изменении кода.
COPY --chown=myuser package.json ./

RUN npm install --omit=dev --no-audit --no-fund \
 && npm list --omit=dev || true

# Копируем остальной код.
COPY --chown=myuser . ./

# Дефолтная команда — запуск актера.
CMD ["node", "src/main.js"]
