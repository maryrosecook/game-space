import { createApp } from './app';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const app = createApp();

app.listen(port, () => {
  console.log(`Game Space listening on http://localhost:${port}`);
});
