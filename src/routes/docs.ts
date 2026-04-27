import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import swaggerUi from 'swagger-ui-express';

const yamlPath = join(process.cwd(), 'openapi.yaml');
const yamlText = readFileSync(yamlPath, 'utf8');
const spec = parseYaml(yamlText);

export const docsRouter = Router();

docsRouter.get('/openapi.yaml', (_req, res) => {
  res.type('text/yaml').send(yamlText);
});

docsRouter.use('/docs', swaggerUi.serve, swaggerUi.setup(spec));
