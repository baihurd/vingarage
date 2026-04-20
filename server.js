import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import crypto from "crypto";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// JSON файлы для хранения данных (GitHub как основное хранилище)
const EARNINGS_FILE = path.join(__dirname, 'earnings.json');
const CLIENTS_FILE = path.join(__dirname, 'clients.json');

// ============= GITHUB SYNC FUNCTIONS =============

// Синхронизация данных с GitHub при старте
function syncWithGit() {
  try {
    console.log('🔄 Syncing with GitHub...');
    execSync(`cd "${__dirname}" && git pull`, { stdio: 'pipe', encoding: 'utf-8' });
    console.log('✅ Successfully synced from GitHub');
  } catch (err) {
    console.log('ℹ️ Git sync completed (working with local files)');
  }
}

// Сохранение данных в JSON и коммит в GitHub
function saveAndCommitData(filePath, data, commitMessage) {
  try {
    // Сохраняем локально
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');

    // Коммитим в GitHub
    const fileName = path.basename(filePath);
    const gitCommand = `cd "${__dirname}" && git add "${fileName}" && git commit -m "${commitMessage}" && git push origin main`;
    
    try {
      execSync(gitCommand, { stdio: 'pipe', encoding: 'utf-8', timeout: 10000 });
      console.log(`✅ Data saved to GitHub: ${commitMessage}`);
    } catch (gitError) {
      // Если git не работает (например в локальном режиме) - данные все равно сохранены локально
      console.log(`ℹ️ Local save OK: ${commitMessage} (git push skipped)`);
    }
  } catch (err) {
    console.error(`❌ Error saving data:`, err.message);
  }
}

// ============= DATA LOAD/SAVE FUNCTIONS =============

function loadEarnings() {
  try {
    if (fs.existsSync(EARNINGS_FILE)) {
      const data = fs.readFileSync(EARNINGS_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Error loading earnings:', err.message);
  }
  return [];
}

function loadClients() {
  try {
    if (fs.existsSync(CLIENTS_FILE)) {
      const data = fs.readFileSync(CLIENTS_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Error loading clients:', err.message);
  }
  return [];
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;

const CLIENT_ID = "85379";
const PASSWORD = "1234554321kg";

const BASE_URL = "https://www.mikado-parts.ru/ws1/service.asmx";
const CATALOG_SOURCE = "https://raw.githubusercontent.com/DanielKohut/car-data/main/car_data.json";
let catalogCache = { timestamp: 0, brands: null };

const FALLBACK_BRANDS = {
  "Audi": ["A1", "A3", "A4", "A5", "A6", "A7", "A8", "Q3", "Q5", "Q7", "Q8"],
  "BMW": ["1 Series", "2 Series", "3 Series", "4 Series", "5 Series", "6 Series", "7 Series", "X1", "X3", "X5", "X7"],
  "Chevrolet": ["Aveo", "Cruze", "Malibu", "Silverado", "Suburban", "Tahoe", "Trax", "Equinox"],
  "Daewoo": ["Lanos", "Nexia", "Matiz", "Lacetti"],
  "Ford": ["Focus", "Fiesta", "Fusion", "Mustang", "Explorer", "Edge", "Escape", "Ranger"],
  "Hyundai": ["Accent", "Elantra", "Tucson", "Santa Fe", "Kona", "Venue"],
  "Kia": ["Rio", "Forte", "Sportage", "Sorento", "Niro", "Seltos", "Picanto"],
  "Mercedes-Benz": ["A-Class", "C-Class", "E-Class", "S-Class", "CLA", "GLA", "GLC", "GLE", "GLS"],
  "Nissan": ["Micra", "Qashqai", "X-Trail", "Altima", "Maxima", "Juke"],
  "Toyota": ["Corolla", "Camry", "RAV4", "Highlander", "Prius", "Yaris", "Auris"],
  "Volkswagen": ["Polo", "Golf", "Passat", "Tiguan", "Touareg", "Jetta", "Beetle"]
};

function getTagValue(xml, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = xml.match(re);
  return m ? m[1].trim() : "";
}

function parseCodeSearchXml(xml) {
  const items = [];
  const re = /<(?:Code_List_Row|Row)>([\s\S]*?)<\/(?:Code_List_Row|Row)>/gi;
  let m;
  let idx = 0;

  function parseOnStocks(onStocksXml) {
    const stockLines = [];
    const stockLineRegex = /<StockLine>([\s\S]*?)<\/StockLine>/gi;
    let stockMatch;
    while ((stockMatch = stockLineRegex.exec(onStocksXml))) {
      const stockLineXml = stockMatch[1];
      const stokName = getTagValue(stockLineXml, "StokName");
      const stockQty = parseInt(getTagValue(stockLineXml, "StockQTY"), 10) || 0;
      const deliveryDelay = getTagValue(stockLineXml, "DeliveryDelay");
      if (stokName || stockQty) {
        stockLines.push({ stokName, stockQty, deliveryDelay });
      }
    }
    return stockLines;
  }

  while ((m = re.exec(xml))) {
    const row = m[1];
    const zakazCode = getTagValue(row, "ZakazCode");
    const producerCode = getTagValue(row, "ProducerCode") || zakazCode;
    const priceRUR = parseFloat(getTagValue(row, "PriceRUR") || getTagValue(row, "Cost") || getTagValue(row, "Vartosp") || 0);
    const supplier = getTagValue(row, "Supplier");
    const producerBrand = getTagValue(row, "ProducerBrand");
    const brand = producerBrand || getTagValue(row, "Brand");
    const srock = getTagValue(row, "Srock");
    const onMyStock = getTagValue(row, "OnMyStock");
    const onStocksXml = getTagValue(row, "OnStocks");
    const stockLines = parseOnStocks(onStocksXml);
    const hasStockLines = stockLines.some(line => line.stockQty > 0);
    const sortedStockLines = stockLines.slice().sort((a, b) => {
      const delayA = Number(a.deliveryDelay) || 0;
      const delayB = Number(b.deliveryDelay) || 0;
      if (delayA !== delayB) return delayA - delayB;
      return b.stockQty - a.stockQty;
    });
    const visibleStockLines = sortedStockLines.slice(0, 5);
    const hiddenStockCount = sortedStockLines.length - visibleStockLines.length;
    const stockText = hasStockLines
      ? visibleStockLines.map(line => `${line.stokName} ${line.stockQty}шт${line.deliveryDelay ? ` (${line.deliveryDelay} дн.)` : ``}`).join(', ') + (hiddenStockCount > 0 ? `, и ещё ${hiddenStockCount}` : '')
      : srock || onMyStock || "";
    const warehouse = hasStockLines
      ? ''
      : onMyStock
      ? 'Наш склад'
      : supplier || "";
    const availability = hasStockLines
      ? 'our_stock'
      : onMyStock && !/^(0|\?|—)$/i.test(onMyStock)
      ? 'our_stock'
      : /отл\.?\s*срок|отл\.?\s*спрос|отложен/i.test(srock + " " + supplier)
      ? 'delayed'
      : /контейнер|варианты/i.test(srock + " " + supplier)
      ? 'container'
      : /\d+\s*дн/i.test(srock)
      ? 'partner_stock'
      : /склад\s*№|Склад\s*№|METACO|FAST|Zekkert|JapanParts|ASHIKA|Japan/i.test(supplier)
      ? 'partner_stock'
      : 'unavailable';

    items.push({
      id: `${producerCode || 'item'}_${idx++}`,
      code: producerCode,
      mikadoCode: zakazCode,
      name: getTagValue(row, "Name") || getTagValue(row, "NameOfPart"),
      priceOpt: priceRUR,
      priceRetail: priceRUR,
      stockText,
      availability,
      supplier,
      brand,
      country: getTagValue(row, "Country"),
      warehouse,
      raw: {
        ZakazCode: getTagValue(row, "ZakazCode"),
        Supplier: supplier,
        ProducerBrand: producerBrand,
        ProducerCode: getTagValue(row, "ProducerCode"),
        Brand: getTagValue(row, "Brand"),
        Country: getTagValue(row, "Country"),
        Name: getTagValue(row, "Name"),
        OnStocks: onStocksXml,
        PriceRUR: getTagValue(row, "PriceRUR"),
        Srock: srock,
        CodeType: getTagValue(row, "CodeType"),
        Source: getTagValue(row, "Source"),
        PrefixLength: getTagValue(row, "PrefixLength"),
        OnMyStock: onMyStock,
        MinZakazQTY: getTagValue(row, "MinZakazQTY"),
      }
    });
  }
  return items;
}


// ============= API ENDPOINTS =============

// Модели
app.get("/api/models", async (req, res) => {
  const brand = req.query.brand || "";
  if (!brand) return res.json([]);

  if (catalogCache.brands) {
    if (brand in catalogCache.brands) {
      return res.json(catalogCache.brands[brand]);
    }
  }

  return res.json(FALLBACK_BRANDS[brand] || []);
});

// Поиск по коду
app.get("/api/search", async (req, res) => {
  try {
    const code = req.query.code || "";
    const brand = req.query.brand || "";
    const mode = req.query.mode || "code";

    if (!code && !brand) {
      return res.status(400).json({ ok: false, error: "Code or brand required" });
    }

    let url;
    if (mode === "zakaz") {
      url = new URL(`${BASE_URL}/Code_Info`);
      url.searchParams.set("ZakazCode", code);
      url.searchParams.set("ClientID", CLIENT_ID);
      url.searchParams.set("Password", PASSWORD);
    } else {
      url = new URL(`${BASE_URL}/CodeBrandStockInfo`);
      url.searchParams.set("ProducerBrand", brand || "");
      url.searchParams.set("ProducerCode", code);
      url.searchParams.set("ClientID", CLIENT_ID);
      url.searchParams.set("Password", PASSWORD);
    }

    const response = await fetch(url.toString());
    const xml = await response.text();
    const items = parseCodeSearchXml(xml);

    return res.json({ ok: true, mode, items, rawXml: xml });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error: error.message || "Ошибка прокси" });
  }
});

app.post("/api/mikado/search", async (req, res) => {
  try {
    const code = String(req.body.code || "").trim();
    const mode = String(req.body.mode || "search").trim();

    if (!code) {
      return res.status(400).json({ ok: false, error: "Code required" });
    }

    const url = new URL(`${BASE_URL}/Code_Search`);
    url.searchParams.set("Search_Code", code);
    url.searchParams.set("ClientID", CLIENT_ID);
    url.searchParams.set("Password", PASSWORD);
    url.searchParams.set("FromStockOnly", "FromStockAndByOrder");

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'text/xml',
      },
    });
    const xml = await response.text();
    const items = parseCodeSearchXml(xml);

    return res.json({ ok: true, mode, items, rawXml: xml });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error: error.message || "Ошибка прокси" });
  }
});

// Анализ цены (экспериментальный)
app.post("/api/price-analysis", async (req, res) => {
  try {
    const partName = String(req.body.partName || "").trim();
    const currentPrice = Number(req.body.currentPrice || 0);

    if (!partName) {
      return res.status(400).json({ ok: false, error: "Part name required" });
    }

    const hash = crypto.createHash('md5').update(partName.toLowerCase()).digest('hex');
    const fallbackPrice = parseInt(hash.substring(0, 8), 16) % 5000 + 1000; // от 1000 до 6000
    const basePrice = currentPrice > 0 ? Math.max(500, currentPrice) : fallbackPrice;
    const spread = currentPrice > 0 ? 0.12 : 0.25;

    const sources = [
      { name: "Yandex.Market", price: basePrice * (0.92 + Math.random() * spread) },
      { name: "Avito", price: basePrice * (0.94 + Math.random() * spread * 0.75) },
      { name: "Auto.ru", price: basePrice * (0.9 + Math.random() * spread * 1.1) },
      { name: "Parts.ru", price: basePrice * (0.98 + Math.random() * spread) },
      { name: "Exist.ru", price: basePrice * (0.88 + Math.random() * spread * 1.2) }
    ].map(s => ({ ...s, price: Math.round(s.price) }));

    const validPrices = sources.filter(s => s.price > 0);
    const minPrice = Math.min(...validPrices.map(s => s.price));
    const maxPrice = Math.max(...validPrices.map(s => s.price));
    const avgPrice = Math.round(validPrices.reduce((sum, s) => sum + s.price, 0) / validPrices.length);
    const note = currentPrice > 0
      ? "Оценка построена на текущей цене предложения. Для точного сравнения нужны реальные API данных из маркетплейсов."
      : "Экспериментальные данные. Для точного анализа требуется интеграция с реальными API.";

    return res.json({
      ok: true,
      partName,
      averagePrice: avgPrice,
      minPrice,
      maxPrice,
      sources: validPrices,
      note
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error: error.message || "Ошибка анализа цены" });
  }
});

// ============= EARNINGS ENDPOINTS =============

// Получить все заработки
app.get("/api/earnings", (req, res) => {
  try {
    const earnings = loadEarnings();
    res.json({ ok: true, entries: earnings });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Добавить заработок
app.post("/api/earnings", (req, res) => {
  try {
    const { amount, comment } = req.body;
    const earnings = loadEarnings();
    
    const newEarning = {
      id: crypto.randomUUID(),
      amount: parseFloat(amount) || 0,
      comment: comment || "",
      timestamp: Date.now()
    };
    
    earnings.push(newEarning);
    saveAndCommitData(EARNINGS_FILE, earnings, `Add earning: ${amount} ₽`);
    
    res.json({ ok: true, entry: newEarning });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Удалить заработок
app.delete("/api/earnings/:id", (req, res) => {
  try {
    const { id } = req.params;
    const earnings = loadEarnings();
    const filtered = earnings.filter(e => e.id !== id);
    
    saveAndCommitData(EARNINGS_FILE, filtered, `Delete earning: ${id}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============= CLIENTS ENDPOINTS =============

// Получить всех клиентов
app.get("/api/clients", (req, res) => {
  try {
    const clients = loadClients();
    res.json({ ok: true, entries: clients });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Добавить клиента
app.post("/api/clients", (req, res) => {
  try {
    const { name, phone, vin, note } = req.body;
    const clients = loadClients();
    
    const newClient = {
      id: crypto.randomUUID(),
      name: name || "",
      phone: phone || "",
      vin: vin || "",
      note: note || "",
      timestamp: Date.now()
    };
    
    clients.push(newClient);
    saveAndCommitData(CLIENTS_FILE, clients, `Add client: ${name}`);
    
    res.json({ ok: true, entry: newClient });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Удалить клиента
app.delete("/api/clients/:id", (req, res) => {
  try {
    const { id } = req.params;
    const clients = loadClients();
    const filtered = clients.filter(c => c.id !== id);
    
    saveAndCommitData(CLIENTS_FILE, filtered, `Delete client: ${id}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============= SERVER STARTUP =============

// Синхронизируемся с GitHub при старте
syncWithGit();

// Запуск сервера
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔════════════════════════════════════════╗
║  🎉 VinGarage Server Started!          ║
╠════════════════════════════════════════╣
║  📍 Local: http://localhost:${PORT}         ║
║  🌐 Render: vingarage.onrender.com      ║
║  💾 Storage: GitHub (auto-sync)         ║
║  ✅ Data backup: earnings.json          ║
║  ✅ Clients backup: clients.json        ║
╚════════════════════════════════════════╝
  `);
});

async function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

export default app;
