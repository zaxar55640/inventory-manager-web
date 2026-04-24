// Build script: keeps source index.html clean, deploys built assets to root
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, copyFileSync, readdirSync, mkdirSync } from 'fs';

const DEV_TEMPLATE = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Zakup Manager</title>
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;700;800&family=Prata&display=swap" rel="stylesheet">
    <script type="module" src="/src/main.tsx"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;

// Always restore dev template before building
writeFileSync('index.html', DEV_TEMPLATE);

// Run Vite build
execSync('npx vite build', { stdio: 'inherit' });

// Copy built index.html to root (for GitHub Pages)
copyFileSync('dist/index.html', 'index.html');

// Copy all assets to root assets/ folder
mkdirSync('assets', { recursive: true });
for (const f of readdirSync('dist/assets')) {
  copyFileSync(`dist/assets/${f}`, `assets/${f}`);
}

console.log('Build complete: dist/ and root assets/ updated.');
