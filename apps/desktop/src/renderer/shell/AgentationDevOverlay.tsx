import { createRoot } from 'react-dom/client';
import { Agentation } from 'agentation';

/** Mount Agentation in its own root so it stays out of the product component tree. */
export function mountAgentation() {
  const host = document.createElement('div');
  host.dataset.syncThinkAgentation = 'true';
  document.body.append(host);

  createRoot(host).render(<Agentation appName="SYNC-THINK development" />);
}
