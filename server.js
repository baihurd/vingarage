import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(cors());
app.use(express.json());
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
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = xml.match(re);
  return m ? m[1].trim() : "";
}

function parseCodeSearchXml(xml) {
  const rowRegex = /<Code_List_Row>([\s\S]*?)<\/Code_List_Row>/gi;
  const rows = [];
  let match;

  while ((match = rowRegex.exec(xml)) !== null) {
    const rowXml = match[1];

    const zakazCode = getTagValue(rowXml, "ZakazCode");
    const supplier = getTagValue(rowXml, "Supplier");
    const producerBrand = getTagValue(rowXml, "ProducerBrand");
    const producerCode = getTagValue(rowXml, "ProducerCode");
    const brand = getTagValue(rowXml, "Brand");
    const name = getTagValue(rowXml, "Name");
    const priceRUR = getTagValue(rowXml, "PriceRUR");
    const srock = getTagValue(rowXml, "Srock");
    const codeType = getTagValue(rowXml, "CodeType");
    const onMyStock = getTagValue(rowXml, "OnMyStock");
    const minQty = getTagValue(rowXml, "MinZakazQTY");
    const stockLines = [];
    const onStocksXml = getTagValue(rowXml, "OnStocks");
    const stockLineRegex = /<StockLine>([\s\S]*?)<\/StockLine>/gi;
    let stockMatch;

    while ((stockMatch = stockLineRegex.exec(onStocksXml)) !== null) {
      const stockLineXml = stockMatch[1];
      const stokName = getTagValue(stockLineXml, "StokName");
      const stockQty = Number(getTagValue(stockLineXml, "StockQTY")) || 0;
      const deliveryDelay = getTagValue(stockLineXml, "DeliveryDelay");

      if (stokName || stockQty) {
        stockLines.push({ stokName, stockQty, deliveryDelay });
      }
    }

    const hasStockLines = stockLines.some((line) => line.stockQty > 0);
    const stockText = hasStockLines
      ? stockLines.slice(0, 3).map((line) => `${line.stokName} ${line.stockQty} шт${line.deliveryDelay ? ` (${line.deliveryDelay} дн.)` : ``}`).join(', ') + (stockLines.length > 3 ? ` и ещё ${stockLines.length - 3}` : '')
      : srock || onMyStock || "—";

    const warehouse = hasStockLines
      ? stockLines.slice(0, 3).map((line) => line.stokName).join(', ') + (stockLines.length > 3 ? ` и ещё ${stockLines.length - 3}` : '')
      : onMyStock
      ? 'Наш склад'
      : supplier
      ? supplier
      : 'Под заказ / не уточнено';

    const availability = hasStockLines
      ? 'our_stock'
      : onMyStock && onMyStock !== '0' && onMyStock !== '?' && onMyStock !== '—'
      ? 'our_stock'
      : srock && /\d+\s*дн/i.test(srock)
      ? /склад\s*№|Склад\s*№|METACO|FAST|Zekkert|JapanParts|ASHIKA|Japan/i.test(supplier)
        ? 'partner_stock'
        : 'delayed'
      : /контейнер|варианты/i.test(srock + supplier)
      ? 'container'
      : /склад\s*№|Склад\s*№/.test(supplier)
      ? 'partner_stock'
      : 'unavailable';

    const parsedPrice = Number(String(priceRUR).replace(",", ".")) || 0;

    rows.push({
      id: zakazCode || `${producerBrand}-${producerCode}`,
      mikadoCode: zakazCode,
      supplier,
      brand: producerBrand || brand,
      code: producerCode,
      name,
      priceRetail: null,
      priceOpt: parsedPrice,
      stockText,
      availability,
      warehouse,
      comment: codeType || "",
      minQty: minQty || ""
    });
  }

  return rows;
}

app.post("/api/mikado/search", async (req, res) => {
  try {
    const { code, mode, brand } = req.body || {};

    if (!code) {
      return res.status(400).json({ error: "Не передан code" });
    }

    let url;

    if (mode === "search") {
      url = new URL(`${BASE_URL}/Code_Search`);
      url.searchParams.set("Search_Code", code);
      url.searchParams.set("ClientID", CLIENT_ID);
      url.searchParams.set("Password", PASSWORD);
      url.searchParams.set("FromStockOnly", "FromStockAndByOrder");
    } else if (mode === "info") {
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

    return res.json({
      ok: true,
      mode,
      items,
      rawXml: xml
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      ok: false,
      error: error.message || "Ошибка прокси"
    });
  }
});

async function loadCatalogBrands() {
  const now = Date.now();
  if (catalogCache.brands && now - catalogCache.timestamp < 1000 * 60 * 60) {
    return catalogCache.brands;
  }

  try {
    const response = await fetch(CATALOG_SOURCE, { timeout: 10000 });
    if (!response.ok) {
      throw new Error(`Статус ${response.status}`);
    }

    const text = await response.text();
    if (!text || text.length === 0) {
      throw new Error('Пустой ответ от сервера');
    }

    let json;
    try {
      json = JSON.parse(text);
    } catch (parseErr) {
      console.error('JSON parse error:', parseErr.message);
      throw new Error('Некорректный JSON: ' + parseErr.message);
    }

    const brands = json.brands || json || {};
    if (typeof brands !== 'object' || Object.keys(brands).length === 0) {
      throw new Error('Invalid or empty brands structure');
    }

    catalogCache = { timestamp: now, brands };
    return brands;
  } catch (error) {
    console.error('loadCatalogBrands error:', error.message);
    console.log('Using fallback catalog...');
    
    catalogCache = { timestamp: now, brands: FALLBACK_BRANDS };
    return FALLBACK_BRANDS;
  }
}

app.get("/api/catalog/brands", async (req, res) => {
  try {
    const brands = await loadCatalogBrands();
    return res.json({ ok: true, brands });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error: error.message || "Не удалось загрузить каталог" });
  }
});

app.get("/api/catalog/models", async (req, res) => {
  try {
    const brand = String(req.query.brand || "").trim();
    if (!brand) {
      return res.status(400).json({ ok: false, error: "Не передана марка" });
    }
    const brands = await loadCatalogBrands();
    const models = Array.isArray(brands[brand]) ? brands[brand] : [];
    return res.json({ ok: true, brand, models });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error: error.message || "Не удалось загрузить модели" });
  }
});

app.listen(PORT, () => {
  console.log(`Proxy started: http://localhost:${PORT}`);
});