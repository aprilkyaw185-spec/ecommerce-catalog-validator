const http = require("http");
const fs = require("fs");
const path = require("path");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");

// 1. Load & compile schema once at startup (JIT compilation)
const schemaPath = path.join(__dirname, "schemas", "catalog-item.schema.json");
const catalogItemSchema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const validateCatalogItem = ajv.compile(catalogItemSchema);

// In-memory store for valid items
const catalogStore = [];

// 2. Format Ajv errors into clean client-friendly objects
function formatValidationErrors(errors) {
  return errors.map((err) => {
    const cleanPath = err.instancePath.replace(/^\//, "").replace(/\//g, ".");
    const field = cleanPath || err.params.missingProperty || err.params.additionalProperty || "body";
    return {
      field,
      constraint: err.keyword,
      detail: err.message
    };
  });
}

// 3. Helper to send JSON responses
function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload, null, 2));
}

// 4. Create HTTP Server
const server = http.createServer((req, res) => {
  // Health check / list items
  if (req.url === "/api/catalog/items" && req.method === "GET") {
    return sendJson(res, 200, { count: catalogStore.length, items: catalogStore });
  }

  // POST /api/catalog/items validation pipeline
  if (req.url === "/api/catalog/items" && req.method === "POST") {
    const contentType = req.headers["content-type"] || "";
    if (!contentType.includes("application/json")) {
      return sendJson(res, 415, {
        error: "Unsupported Media Type",
        detail: "Content-Type must be application/json"
      });
    }

    const bodyChunks = [];
    req.on("data", (chunk) => bodyChunks.push(chunk));

    req.on("end", () => {
      const rawBody = Buffer.concat(bodyChunks).toString();

      // Step A: Parse raw JSON (400 if syntax is broken)
      let payload;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return sendJson(res, 400, {
          error: "Bad Request",
          detail: "Malformed JSON syntax in request body"
        });
      }

      // Step B: Validate against JSON Schema (422 if contract fails)
      const isValid = validateCatalogItem(payload);
      if (!isValid) {
        return sendJson(res, 422, {
          error: "Unprocessable Entity",
          message: "Payload failed catalog item schema validation",
          details: formatValidationErrors(validateCatalogItem.errors)
        });
      }

      // Step C: Persist valid item and return 201 Created
      const record = {
        ...payload,
        createdAt: new Date().toISOString()
      };
      catalogStore.push(record);

      return sendJson(res, 201, {
        message: "Catalog item validated and created",
        data: record
      });
    });

    return;
  }

  sendJson(res, 404, { error: "Not Found", detail: `Cannot ${req.method} ${req.url}` });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Catalog Validator Service running at http://localhost:${PORT}`);
});