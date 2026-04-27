import { createApp } from './app.ts';

const app = createApp();
const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`Mines API listening on http://localhost:${port}`);
});
