import { createRoot } from 'react-dom/client';
import { DesignSystemPage } from './DesignSystemPage.js';
const root = document.getElementById('root');
if (!root) throw new Error('Missing root');
createRoot(root).render(<DesignSystemPage />);
