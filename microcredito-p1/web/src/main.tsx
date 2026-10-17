import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { registrarPwa } from './pwa';
import './index.css';

registrarPwa();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
