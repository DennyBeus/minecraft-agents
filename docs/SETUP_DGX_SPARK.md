# Запуск одного AI-компаньона на DGX Spark

Проверенная база: upstream `JesseRWeigel/minecraft-agent-swarm`, коммит `229c4ee3e610569aa9ecbc1e351b331432095ea0`. Локальная машина `spark-d7c4`: ARM64, Node.js 22.22.3, Java 21.0.12, Python 3.12.3. Java-сервер и агент работают на Spark, клиент Minecraft Java Edition — на Windows.

## Установка

```bash
cd /home/denny/Projects/develop/minecraft-agents
npm ci
npm run typecheck
```

Paper **1.21.11 build 132** находится в `server/paper.jar`; его SHA-256: `5ffef465eeeb5f2a3c23a24419d97c51afd7dbb4923ff42df9a3f58bba1ccfba`. Источник — [PaperMC Downloads Service](https://docs.papermc.io/misc/downloads-service/). Для 1.21.11 достаточно Java 21 ([PaperMC](https://docs.papermc.io/paper/getting-started/)). Бинарник Paper не зависит от x86_64; Node-зависимости установлены через `npm ci` на ARM64. Локальные LLM, веса и Python-библиотеки для боя не требуются.

## Конфигурация

Файл `.env` создан, содержит предоставленный вами ключ OpenRouter, имеет права `600` и исключён из Git. Не публикуйте `.env` и логи с полным текстом запросов. Выбраны `OPENAI_MODEL=openai/gpt-4.1-mini` и тот же `OPENAI_FAST_MODEL`. Модель можно заменить в обеих переменных. Нативный tool calling не нужен: приложение запрашивает `response_format={"type":"json_object"}` и разбирает JSON решения. Доступность модели через ваш ключ проверена живыми запросами 22 октября 2026 года.

Для расходов заданы `BOT_IDLE_INTERVAL_MS=60000`, `BOT_CRITIC_ENABLED=false`, `LLM_MAX_REQUESTS_PER_RUN=100`. Лимит останавливает процесс перед 101-м запросом; сбрасывается при новом запуске. Реакции на события и сообщения игрока могут создавать дополнительные запросы между плановыми циклами. Каждый запрос ограничен 30 секундами, автоматических сетевых повторов нет. Для краткого пробного запуска используйте `timeout --signal=INT 15m npm start`. Учёт фактически возвращённых токенов: `node scripts/llm-usage.mjs`; деньги смотрите в [OpenRouter Activity](https://openrouter.ai/activity). В живой проверке 22 октября 2026 года модель вернула корректный JSON; текущие цены и качество модели могут меняться.

`ENABLE_MULTI_BOT=false`, `BOT_COUNT=1` запускают только Atlas. `GENERATED_SKILLS_ENABLED=false` запрещает выполнение генерируемого кода. `ENABLE_TTS=false` и `ENABLE_NEURAL_SERVER=false` отключают необязательные службы. `BOT_COMMAND_WHITELIST=DennyBeus` даёт вашему нику доступ к `!status`, `!come`, `!stay`, `!resume`, `!goal` и `!inventory`; обычный чат остаётся доступен.

## Minecraft-сервер

Сервер настроен на `192.168.217.91:25565` в `server/server.properties` (образец: `docs/server.properties.example`): survival, normal, постоянный мир `ai-world`, offline mode, whitelist. Offline mode подходит только для доверенной частной сети: сервер не должен быть доступен из интернета. Если LAN-адрес Spark изменится, обновите `server-ip` в `server/server.properties`, `MC_HOST` и `WEB_BIND_HOST` в `.env`.

Мир обновлён с 1.21.4 до 1.21.11. Перед обновлением сохранён архив `server/backup-pre-1.21.11-2026-10-22.tar.gz`; прежний JAR лежит в `server/paper-1.21.4-232.jar`. Возврат на 1.21.4 требует восстановления **и** старого мира из архива, и старого JAR: обновлённый мир нельзя открывать старой версией Paper. Фоновый профилировщик Spark отключён в `server/plugins/spark/config.json`, поскольку его нативный семплер вызвал сбой JVM на ARM64 во время теста.

Пользователь принял [Minecraft EULA](https://aka.ms/MinecraftEULA) 22 октября 2026 года; локальный `server/eula.txt` уже содержит `eula=true`. Запустите в отдельном терминале:

```bash
cd /home/denny/Projects/develop/minecraft-agents/server
java -Xms1G -Xmx2G -jar paper.jar --nogui
```

Atlas и `DennyBeus` уже внесены в whitelist сервера. Если игровой ник изменится, добавьте новый ник в консоли Paper командой `whitelist add НОВЫЙ_НИК` и обновите `BOT_COMMAND_WHITELIST` в `.env`. Операторские права Atlas не нужны: командные изменения gamerules при текущем `ALLOW_INTERVENTIONS=false` отключены. Не меняйте `online-mode=false` на `true` без перехода Atlas на Microsoft-аутентификацию и нового whitelist.

## Агент и Windows-клиент

Для голосового управления без клавиши записи настройте Discord по [отдельной инструкции](DISCORD_VOICE.md).

После запуска сервера в другом терминале:

```bash
cd /home/denny/Projects/develop/minecraft-agents
npm start
```

`npm start` включает проверку TLS-сертификата для Node.js, даже если в общем окружении Spark она отключена.

На Windows откройте Minecraft Java Edition **1.21.11** со своими шейдерами, «Сетевая игра» → «Прямое подключение» → `192.168.217.91:25565`. Напишите в чате, например, `Atlas, помоги собрать дерево` или `Atlas, что ты делаешь?`. Команды с `!` работают только для ников в `BOT_COMMAND_WHITELIST`.

Mission Control: `http://192.168.217.91:3010`; 3D viewer: `http://192.168.217.91:3020`; overlay: `http://192.168.217.91:3001`. Они привязаны к LAN-адресу через `WEB_BIND_HOST`. На данной машине порт 3000 уже занят другим процессом, поэтому выбран 3020. Эти интерфейсы не имеют собственной аутентификации — используйте только доверенную LAN.

## Остановка и неполадки

Нажмите `Ctrl+C` в терминале агента: он прекратит LLM-запросы и закроет соединение с игрой. Затем отправьте `stop` в консоль Paper и дождитесь записи мира. Не завершайте Java принудительно, пока сохраняется мир.

- Ошибка `OPENAI_API_KEY is not set`: заполните `.env`; пустой ключ специально блокирует запуск.
- Ошибка 401/404/400 от OpenRouter: проверьте ключ, точный ID модели и поддержку JSON mode.
- Windows не подключается: проверьте LAN-адрес Spark, порт 25565, firewall и whitelist; `server-ip` должен совпадать с `MC_HOST`.
- Нет действий после входа: проверьте логи агента, `node scripts/llm-usage.mjs`, доступность OpenRouter и статус задачи в Mission Control.
- `Port ... in use`: измените `VIEWER_PORT` или освободите порт; для dashboard 3010 понадобится освобождение порта.
- Память Atlas хранится в `memory-atlas.json`, мир — в `server/ai-world`. Делайте резервную копию при остановленном сервере.
