import React from 'react';
import { createRoot } from 'react-dom/client';
import { isTauri } from '@tauri-apps/api/core';
import KegelApp, { KegelPreviewApp } from './App';
import '../../../src/styles/tokens.css';
import './Base.css';
import './Kegel.css';
const App = isTauri() ? KegelApp : KegelPreviewApp;
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
