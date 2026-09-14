import { config } from './config';
import { assertLayoutService } from './services/layout.service';
import { createServer } from './server';

assertLayoutService();

createServer().listen(config.PORT, () => {
  console.log(`OCR service listening on http://localhost:${config.PORT}`);
});