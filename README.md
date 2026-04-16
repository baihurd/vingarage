# 🚗 VinGarage - Каталог и отслеживание запчастей

Приложение для поиска запчастей по VIN и кодам, отслеживания прибыли и управления клиентами.

## 🌐 Приложение работает онлайн:

```
https://vingarage.onrender.com/
```

## 🔄 Как работает:

### 1. Данные хранятся на GitHub
- `earnings.json` - история заработков
- `clients.json` - список клиентов
- Все автоматически синхронизируется

### 2. При добавлении записи:
```
User → API POST → earnings.json → git commit → GitHub
```

### 3. При перезагрузке Render:
```
git pull → load data → Ready!
```

## ✨ Фишки:

- ✅ Поиск по VIN и кодам запчастей
- ✅ Отслеживание заработков
- ✅ Управление клиентами
- ✅ Сохранение в корзину
- ✅ Данные на GitHub (не теряются)
- ✅ Работает на Free Tier Render

## 📱 Функции:

### Поиск
- По коду детали (0265008135, MAG3482)
- По VIN автомобиля
- Выбор сайта поиска

### Заработки
- Добавить заработок
- История заработков
- Автоматическое сохранение на GitHub

### Клиенты
- Добавить клиента
- Сохранить контакты (имя, телефон, VIN)
- История всех клиентов

### Корзина
- Добавлять детали
- Расчет прибыли (цена - оптовая цена)
- Быстрое добавление в заработки

## 🛠️ Стек:

- **Frontend:** HTML, CSS, JavaScript
- **Backend:** Node.js, Express
- **Storage:** JSON файлы + GitHub автосинхронизация
- **Hosting:** Render.com (Free Tier)
- **VCS:** Git, GitHub

## 🚀 Автоматический деплой:

При каждом push на GitHub:
```bash
git push → GitHub → Render auto-deploy → Live!
```

Никакой ручной работы! 🎉

## 📚 Документация:

- `GITHUB_STORAGE.md` - как работает хранение на GitHub
- `GITHUB_STORAGE_READY.md` - статус готовности
- `server.js` - backend код с комментариями
- `index.html` - frontend код

## 🔧 Для разработки (локально):

```bash
cd C:\Users\gerak\Desktop\VINGARAGE
npm install
node server.js
```

Откроется на `http://localhost:3000`

## 📝 Коммиты в GitHub:

Каждое действие автоматически коммитится:

```
✅ Add earning: 1500 ₽
✅ Add client: Иван Петров
✅ Delete earning: xxxxx
```

Все в истории git! 📦

## 🌍 URL:

- **Production:** https://vingarage.onrender.com/
- **GitHub Repo:** https://github.com/baihurd/vingarage
- **API Base:** https://vingarage.onrender.com/api/

## 📊 Статус:

- ✅ Production: LIVE на Render
- ✅ GitHub Storage: ACTIVE
- ✅ Auto-deploy: ENABLED
- ✅ Data Backup: GitHub

---

**Версия:** 2.0 (Render + GitHub Storage)
