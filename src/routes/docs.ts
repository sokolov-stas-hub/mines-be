import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const yamlPath = join(process.cwd(), 'openapi.yaml');
const yamlText = readFileSync(yamlPath, 'utf8');

const swaggerHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Mines API · Swagger UI</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
  <style>body { margin: 0; }</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-standalone-preset.js" crossorigin></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: '/api/openapi.yaml',
        dom_id: '#swagger-ui',
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        layout: 'StandaloneLayout',
      });
    };
  </script>
</body>
</html>
`;

export const docsRouter = Router();

docsRouter.get('/openapi.yaml', (_req, res) => {
  res.type('text/yaml').send(yamlText);
});

docsRouter.get('/docs', (_req, res) => {
  res.type('html').send(swaggerHtml);
});
